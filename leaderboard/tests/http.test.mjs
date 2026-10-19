import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLeaderboardServer } from '../src/http.mjs';
import { openStore } from '../src/store.mjs';

async function fixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'airshift-http-'));
  let now = 1_000_000;
  const config = {
    allowedOrigins: ['https://airshift.example'],
    requestLimitBytes: 1024,
    rateLimitPerMinute: 1000,
    profileRateLimitPerMinute: 1000,
    ...overrides,
  };
  const store = openStore({ databasePath: join(directory, 'leaderboard.sqlite'), clock: () => now, networkToleranceMs: 0 });
  const server = createLeaderboardServer({ store, config, clock: () => now });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', profileToken, body, origin, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(profileToken ? { authorization: `Bearer ${profileToken}` } : {}),
        ...(origin ? { origin } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  return { request, advance: (ms) => { now += ms; }, base };
}

test('health, profile, run, submit, leaderboard and personal rank endpoints', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/health')).body, { ok: true });
  const created = await f.request('/v1/profiles', { method: 'POST', body: {} });
  assert.equal(created.status, 201);
  const profileToken = created.body.profileToken;
  assert.equal(profileToken.length, 43);
  const started = await f.request('/v1/runs', { method: 'POST', profileToken, body: {} });
  assert.equal(started.status, 201);
  f.advance(60_000);
  const submitted = await f.request('/v1/runs/submit', {
    method: 'POST', profileToken,
    body: { runToken: started.body.runToken, initials: 'A01', distance: 1000 },
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.personalBestUpdated, true);
  assert.equal(submitted.body.rank, 1);
  assert.equal(submitted.body.percentile, 100);
  const board = await f.request('/v1/leaderboard');
  assert.equal(board.body.entries[0].distance, 1000);
  assert.equal((await f.request('/v1/leaderboard?limit=100')).body.limit, 100);
  assert.equal((await f.request('/v1/me', { profileToken })).body.best.initials, 'A01');
  assert.equal((await f.request('/v1/leaderboard?limit=50')).status, 400);
});

test('concurrent submissions consume a run once', async (t) => {
  const f = await fixture(t);
  const profileToken = (await f.request('/v1/profiles', { method: 'POST', body: {} })).body.profileToken;
  const runToken = (await f.request('/v1/runs', { method: 'POST', profileToken, body: {} })).body.runToken;
  f.advance(30_000);
  const options = { method: 'POST', profileToken, body: { runToken, initials: 'XYZ', distance: 100 } };
  const results = await Promise.all([f.request('/v1/runs/submit', options), f.request('/v1/runs/submit', options)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await f.request('/v1/leaderboard')).body.totalRanked, 1);
});

test('CORS, body limit, JSON validation and rate limits', async (t) => {
  const f = await fixture(t, { profileRateLimitPerMinute: 3, requestLimitBytes: 128 });
  const denied = await f.request('/v1/leaderboard', { origin: 'https://attacker.example' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const preflight = await f.request('/v1/profiles', { method: 'OPTIONS', origin: 'https://airshift.example' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://airshift.example');
  assert.equal((await f.request('/v1/profiles', { method: 'POST', body: { unexpected: true } })).status, 400);
  assert.equal((await f.request('/v1/profiles', { method: 'POST', body: '{bad' })).status, 400);
  assert.equal((await f.request('/v1/profiles', { method: 'POST', body: {} })).status, 429);
  f.advance(60_000);
  const oversized = await f.request('/v1/profiles', { method: 'POST', body: { filler: 'x'.repeat(200) } });
  assert.equal(oversized.status, 413);
  const allowed = await f.request('/v1/profiles', { method: 'POST', body: {}, origin: 'https://airshift.example' });
  assert.equal(allowed.status, 201);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://airshift.example');
});

test('chunked bodies above the byte limit receive 413', async (t) => {
  const f = await fixture(t, { requestLimitBytes: 128 });
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(f.base + '/v1/profiles', {
      method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.write('x'.repeat(200));
    request.end();
  });
  assert.equal(status, 413);
});

test('Fly client IP separates proxy-shared players only when explicitly trusted', async (t) => {
  const trusted = await fixture(t, { trustFlyClientIp: true, profileRateLimitPerMinute: 1 });
  const from = (ip) => ({ method: 'POST', body: {}, headers: { 'Fly-Client-IP': ip } });
  assert.equal((await trusted.request('/v1/profiles', from('203.0.113.10'))).status, 201);
  assert.equal((await trusted.request('/v1/profiles', from('203.0.113.11'))).status, 201);
  assert.equal((await trusted.request('/v1/profiles', from('203.0.113.10'))).status, 429);
  assert.equal((await trusted.request('/v1/profiles', from('invalid'))).status, 201);
  assert.equal((await trusted.request('/v1/profiles', from('still-invalid'))).status, 429);

  const untrusted = await fixture(t, { trustFlyClientIp: false, profileRateLimitPerMinute: 1 });
  assert.equal((await untrusted.request('/v1/profiles', from('203.0.113.10'))).status, 201);
  assert.equal((await untrusted.request('/v1/profiles', from('203.0.113.11'))).status, 429);
});
