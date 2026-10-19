import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.mjs';

test('configuration requires exact browser origins and bounded timing policy', () => {
  const config = readConfig({
    LEADERBOARD_DB_PATH: './board.sqlite',
    LEADERBOARD_ALLOWED_ORIGINS: 'https://game.example,http://localhost:3000',
    LEADERBOARD_NETWORK_TOLERANCE_MS: '750',
    LEADERBOARD_MAX_RUN_AGE_HOURS: '72',
    LEADERBOARD_TRUST_FLY_CLIENT_IP: 'true',
  });
  assert.deepEqual(config.allowedOrigins, ['https://game.example', 'http://localhost:3000']);
  assert.equal(config.networkToleranceMs, 750);
  assert.equal(config.maxRunAgeMs, 72 * 60 * 60 * 1000);
  assert.equal(config.trustFlyClientIp, true);
  assert.equal(readConfig({}).trustFlyClientIp, false);
  assert.throws(() => readConfig({ LEADERBOARD_ALLOWED_ORIGINS: 'https://*.example' }));
  assert.throws(() => readConfig({ LEADERBOARD_ALLOWED_ORIGINS: 'https://game.example/path' }));
  assert.throws(() => readConfig({ LEADERBOARD_NETWORK_TOLERANCE_MS: '6000' }));
  assert.throws(() => readConfig({ LEADERBOARD_MAX_RUN_AGE_HOURS: '0' }));
  assert.throws(() => readConfig({ LEADERBOARD_TRUST_FLY_CLIENT_IP: 'yes' }));
});
