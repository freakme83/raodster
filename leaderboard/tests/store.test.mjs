import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { CONFIG, speedAt } from '../../src/physics.js';
import { maximumDistance } from '../src/distance.mjs';
import { openStore } from '../src/store.mjs';

function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'airshift-leaderboard-'));
  const databasePath = join(directory, 'leaderboard.sqlite');
  let now = 1_000_000;
  const store = openStore({ databasePath, clock: () => now, ...options });
  return {
    store,
    databasePath,
    setTime: (value) => { now = value; },
    advance: (value) => { now += value; },
    close: () => { store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

function submit(f, profileToken, initials, distance, elapsedMs = 60_000) {
  const { runToken } = f.store.startRun(profileToken);
  f.advance(elapsedMs);
  return f.store.submitRun(profileToken, { runToken, initials, distance });
}

test('fixed-step ceiling matches speedAt update order and stays bounded for long runs', () => {
  const h = CONFIG.step;
  const expected = h * speedAt(h) + h * speedAt(2 * h);
  assert.ok(Math.abs(maximumDistance(1000 * h, 0) - expected - 0.5) < 1e-9);
  assert.ok(Math.abs(maximumDistance(0, 0) - h * speedAt(h) - 0.5) < 1e-9);
  assert.equal(speedAt(600), 80);
  assert.ok(Math.abs(maximumDistance(601_000, 0) - maximumDistance(600_000, 0) - 80) < 1e-7);
  const started = performance.now();
  const longRun = maximumDistance(70 * 60 * 60 * 1000, 1000);
  assert.ok(longRun > 20_000_000);
  assert.ok(performance.now() - started < 1000, 'long-run bound must not loop over millions of steps');
});

test('normal score is accepted; impossible score consumes the token', (t) => {
  const f = fixture({ networkToleranceMs: 0 });
  t.after(f.close);
  const { profileToken } = f.store.createProfile();
  const normal = submit(f, profileToken, 'A01', 1000);
  assert.equal(normal.accepted, true);
  assert.equal(normal.personalBestUpdated, true);
  const { runToken } = f.store.startRun(profileToken);
  f.advance(1000);
  const impossible = f.store.submitRun(profileToken, { runToken, initials: 'A01', distance: 1_000_000 });
  assert.deepEqual(impossible, { accepted: false, reason: 'impossible_distance' });
  assert.throws(() => f.store.submitRun(profileToken, { runToken, initials: 'A01', distance: 1 }), /run_unavailable/);
  assert.equal(f.store.getPersonal(profileToken).best.distance, 1000);
});

test('boundary timing, pause-like wait, and configured tolerance are conservative', (t) => {
  const f = fixture({ networkToleranceMs: 250 });
  t.after(f.close);
  const { profileToken } = f.store.createProfile();
  const { runToken } = f.store.startRun(profileToken);
  f.advance(1000);
  const limit = maximumDistance(1000, 250);
  assert.equal(f.store.submitRun(profileToken, { runToken, initials: 'AAA', distance: limit }).accepted, true);
  const paused = submit(f, profileToken, 'AAA', 1500, 120_000);
  assert.equal(paused.accepted, true, 'wall time must not reject a paused or stalled run');
  assert.equal(maximumDistance(1000, 0) < maximumDistance(1000, 250), true);
});

test('one active run, abandoned long sessions, and retry policy', (t) => {
  const maxRunAgeMs = 72 * 60 * 60 * 1000;
  const f = fixture({ maxRunAgeMs });
  t.after(f.close);
  const { profileToken } = f.store.createProfile();
  const oldRun = f.store.startRun(profileToken).runToken;
  const newRun = f.store.startRun(profileToken).runToken;
  assert.throws(() => f.store.submitRun(profileToken, { runToken: oldRun, initials: 'AAA', distance: 1 }), /run_unavailable/);
  f.advance(maxRunAgeMs);
  assert.equal(f.store.submitRun(profileToken, { runToken: newRun, initials: 'AAA', distance: 100 }).accepted, true);
  const abandoned = f.store.startRun(profileToken).runToken;
  f.advance(maxRunAgeMs + 1);
  assert.deepEqual(f.store.submitRun(profileToken, { runToken: abandoned, initials: 'AAA', distance: 1 }), { accepted: false, reason: 'run_expired' });
  assert.equal(submit(f, profileToken, 'AAA', 200).accepted, true, 'retry uses a new run');
});

test('personal best, lower scores, shared initials, stable ties, rank and percentile', (t) => {
  const f = fixture();
  t.after(f.close);
  const first = f.store.createProfile().profileToken;
  const second = f.store.createProfile().profileToken;
  const third = f.store.createProfile().profileToken;
  assert.deepEqual(f.store.getPersonal(first), { best: null, rank: null, totalRanked: 0, percentile: null });
  assert.equal(submit(f, first, 'ABC', 300).personalBestUpdated, true);
  assert.equal(submit(f, second, 'ABC', 300).personalBestUpdated, true);
  assert.equal(submit(f, third, 'ZZ9', 100).personalBestUpdated, true);
  assert.equal(submit(f, first, 'NEW', 50).personalBestUpdated, false);
  assert.equal(f.store.getPersonal(first).best.initials, 'ABC');
  assert.equal(f.store.getPersonal(first).rank, 1);
  assert.equal(f.store.getPersonal(second).rank, 1);
  assert.equal(f.store.getPersonal(third).rank, 3);
  assert.equal(f.store.getPersonal(first).percentile, 100);
  assert.equal(f.store.getPersonal(third).percentile, 0);
  assert.deepEqual(f.store.getLeaderboard().entries.map((row) => [row.initials, row.distance, row.rank]), [
    ['ABC', 300, 1], ['ABC', 300, 1], ['ZZ9', 100, 3],
  ]);
  assert.equal(submit(f, third, 'ZZ9', 400).personalBestUpdated, true);
  assert.equal(f.store.getPersonal(third).rank, 1);
});

test('top 20 and top 100 retain deterministic ordering', (t) => {
  const f = fixture();
  t.after(f.close);
  for (let score = 1; score <= 105; score += 1) {
    const { profileToken } = f.store.createProfile();
    submit(f, profileToken, 'A01', score, 10_000);
  }
  const top20 = f.store.getLeaderboard();
  const top100 = f.store.getLeaderboard(100);
  assert.equal(top20.entries.length, 20);
  assert.equal(top100.entries.length, 100);
  assert.equal(top20.totalRanked, 105);
  assert.equal(top20.entries[0].distance, 105);
  assert.equal(top20.entries.at(-1).distance, 86);
  assert.equal(top100.entries.at(-1).distance, 6);
  assert.throws(() => f.store.getLeaderboard(50), /invalid_limit/);
});

test('malformed initials and score, profile binding, and hashed credentials', (t) => {
  const f = fixture();
  t.after(f.close);
  const first = f.store.createProfile().profileToken;
  const second = f.store.createProfile().profileToken;
  const runToken = f.store.startRun(first).runToken;
  for (const initials of ['ab1', 'AB', 'ABCD', 'A_B', 'é12']) {
    assert.throws(() => f.store.submitRun(first, { runToken, initials, distance: 1 }), /invalid_initials/);
  }
  for (const distance of [-1, NaN, Infinity, '12']) {
    assert.throws(() => f.store.submitRun(first, { runToken, initials: 'ABC', distance }), /invalid_distance/);
  }
  assert.throws(() => f.store.submitRun(second, { runToken, initials: 'ABC', distance: 1 }), /run_unavailable/);
  const db = new DatabaseSync(f.databasePath);
  const profileHash = db.prepare('SELECT credential_hash FROM profiles LIMIT 1').get().credential_hash;
  const runHash = db.prepare('SELECT token_hash FROM runs LIMIT 1').get().token_hash;
  db.close();
  assert.equal(profileHash.length, 64);
  assert.equal(runHash.length, 64);
  assert.notEqual(profileHash, first);
  assert.notEqual(runHash, runToken);
  assert.equal(f.store.submitRun(first, { runToken, initials: 'ABC', distance: 1 }).accepted, true);
});

test('database migration and personal best survive restart', (t) => {
  const f = fixture();
  t.after(() => rmSync(join(f.databasePath, '..'), { recursive: true, force: true }));
  const token = f.store.createProfile().profileToken;
  assert.equal(submit(f, token, 'R01', 500).accepted, true);
  f.store.close();
  const reopened = openStore({ databasePath: f.databasePath });
  assert.equal(reopened.getPersonal(token).best.distance, 500);
  assert.equal(reopened.getLeaderboard().totalRanked, 1);
  assert.equal(reopened.healthy(), true);
  reopened.close();
});
