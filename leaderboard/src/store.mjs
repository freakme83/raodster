import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { maximumDistance } from './distance.mjs';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const initialsPattern = /^[A-Z0-9]{3}$/;

export class LeaderboardError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function tokenHash(token) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) {
    throw new LeaderboardError(401, 'invalid_credential');
  }
  return createHash('sha256').update(token).digest('hex');
}

function newToken() {
  return randomBytes(32).toString('base64url');
}

function percentile(rank, total) {
  return total === 1 ? 100 : Math.round(10000 * (total - rank) / (total - 1)) / 100;
}

export function openStore({ databasePath, clock = Date.now, networkToleranceMs = 1000, maxRunAgeMs = 72 * 60 * 60 * 1000 }) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) {
    db.close();
    throw new Error(`Unsupported leaderboard schema version: ${version}`);
  }
  if (version === 0) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY,
        credential_hash TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        best_distance REAL CHECK (best_distance >= 0),
        best_initials TEXT,
        best_updated_at_ms INTEGER,
        CHECK ((best_distance IS NULL AND best_initials IS NULL AND best_updated_at_ms IS NULL)
          OR (best_distance IS NOT NULL AND best_initials IS NOT NULL AND best_updated_at_ms IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        profile_id INTEGER NOT NULL REFERENCES profiles(id),
        token_hash TEXT NOT NULL UNIQUE,
        issued_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        consumed_at_ms INTEGER,
        invalidated_at_ms INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_run_per_profile
        ON runs(profile_id) WHERE consumed_at_ms IS NULL AND invalidated_at_ms IS NULL;
      CREATE INDEX IF NOT EXISTS ranked_profiles
        ON profiles(best_distance DESC, best_updated_at_ms ASC, id ASC)
        WHERE best_distance IS NOT NULL;
      CREATE INDEX IF NOT EXISTS runs_profile ON runs(profile_id);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  const insertProfile = db.prepare('INSERT INTO profiles(credential_hash, created_at_ms) VALUES (?, ?)');
  const findProfile = db.prepare('SELECT id, best_distance, best_initials FROM profiles WHERE credential_hash = ?');
  const invalidateRuns = db.prepare('UPDATE runs SET invalidated_at_ms = ? WHERE profile_id = ? AND consumed_at_ms IS NULL AND invalidated_at_ms IS NULL');
  const insertRun = db.prepare('INSERT INTO runs(profile_id, token_hash, issued_at_ms, expires_at_ms) VALUES (?, ?, ?, ?)');
  const findRun = db.prepare('SELECT id, issued_at_ms, expires_at_ms, consumed_at_ms, invalidated_at_ms FROM runs WHERE profile_id = ? AND token_hash = ?');
  const consumeRun = db.prepare('UPDATE runs SET consumed_at_ms = ? WHERE id = ? AND consumed_at_ms IS NULL AND invalidated_at_ms IS NULL');
  const replaceBest = db.prepare(`UPDATE profiles SET best_distance = ?, best_initials = ?, best_updated_at_ms = ?
    WHERE id = ? AND (best_distance IS NULL OR best_distance < ?)`);
  const totalRanked = db.prepare('SELECT COUNT(*) AS total FROM profiles WHERE best_distance IS NOT NULL');
  const higherRanked = db.prepare('SELECT COUNT(*) AS higher FROM profiles WHERE best_distance > ?');
  const topProfiles = db.prepare(`SELECT id, best_initials AS initials, best_distance AS distance
    FROM profiles WHERE best_distance IS NOT NULL
    ORDER BY best_distance DESC, best_updated_at_ms ASC, id ASC LIMIT ?`);

  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = action();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function requireProfile(credential) {
    const profile = findProfile.get(tokenHash(credential));
    if (!profile) throw new LeaderboardError(401, 'invalid_credential');
    return profile;
  }

  function createProfile() {
    const credential = newToken();
    insertProfile.run(tokenHash(credential), clock());
    return { profileToken: credential };
  }

  function startRun(credential) {
    const profile = requireProfile(credential);
    const runToken = newToken();
    const issuedAtMs = clock();
    transaction(() => {
      invalidateRuns.run(issuedAtMs, profile.id);
      insertRun.run(profile.id, tokenHash(runToken), issuedAtMs, issuedAtMs + maxRunAgeMs);
    });
    return { runToken, issuedAtMs, expiresAtMs: issuedAtMs + maxRunAgeMs };
  }

  function submitRun(credential, { runToken, initials, distance }) {
    if (typeof initials !== 'string' || !initialsPattern.test(initials)) {
      throw new LeaderboardError(400, 'invalid_initials');
    }
    if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) {
      throw new LeaderboardError(400, 'invalid_distance');
    }
    const profile = requireProfile(credential);
    const submittedAtMs = clock();
    const runHash = tokenHash(runToken);

    return transaction(() => {
      const run = findRun.get(profile.id, runHash);
      if (!run || run.consumed_at_ms !== null || run.invalidated_at_ms !== null) {
        throw new LeaderboardError(409, 'run_unavailable');
      }
      const consumed = consumeRun.run(submittedAtMs, run.id);
      if (consumed.changes !== 1) throw new LeaderboardError(409, 'run_unavailable');

      if (submittedAtMs > run.expires_at_ms) return { accepted: false, reason: 'run_expired' };
      const maximum = maximumDistance(Math.max(0, submittedAtMs - run.issued_at_ms), networkToleranceMs);
      if (distance > maximum) return { accepted: false, reason: 'impossible_distance' };

      const updated = replaceBest.run(distance, initials, submittedAtMs, profile.id, distance).changes === 1;
      return { accepted: true, personalBestUpdated: updated, ...personalResult(profile.id) };
    });
  }

  function personalResult(profileId) {
    const row = db.prepare('SELECT best_distance, best_initials FROM profiles WHERE id = ?').get(profileId);
    const total = totalRanked.get().total;
    if (row.best_distance === null) return { best: null, rank: null, totalRanked: total, percentile: null };
    const rank = higherRanked.get(row.best_distance).higher + 1;
    return {
      best: { initials: row.best_initials, distance: row.best_distance },
      rank,
      totalRanked: total,
      percentile: percentile(rank, total),
    };
  }

  function getPersonal(credential) {
    return personalResult(requireProfile(credential).id);
  }

  function getLeaderboard(limit = 20) {
    if (limit !== 20 && limit !== 100) throw new LeaderboardError(400, 'invalid_limit');
    const total = totalRanked.get().total;
    const entries = topProfiles.all(limit).map((row) => ({
      initials: row.initials,
      distance: row.distance,
      rank: higherRanked.get(row.distance).higher + 1,
    }));
    return { entries, totalRanked: total, limit };
  }

  return {
    createProfile,
    startRun,
    submitRun,
    getPersonal,
    getLeaderboard,
    healthy: () => db.prepare('SELECT COUNT(*) AS total FROM profiles').get().total >= 0,
    close: () => db.close(),
  };
}
