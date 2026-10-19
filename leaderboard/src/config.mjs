import { resolve } from 'node:path';

function integerSetting(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function booleanSetting(value, fallback, name) {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

export function readConfig(env = process.env) {
  const allowedOrigins = (env.LEADERBOARD_ALLOWED_ORIGINS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || origin.includes('*')) {
      throw new Error('LEADERBOARD_ALLOWED_ORIGINS must contain exact HTTP(S) origins');
    }
  }

  return Object.freeze({
    databasePath: resolve(env.LEADERBOARD_DB_PATH ?? './leaderboard.sqlite'),
    host: env.HOST ?? '0.0.0.0',
    port: integerSetting(env.PORT, 8080, 1, 65535, 'PORT'),
    allowedOrigins,
    trustFlyClientIp: booleanSetting(env.LEADERBOARD_TRUST_FLY_CLIENT_IP, false, 'LEADERBOARD_TRUST_FLY_CLIENT_IP'),
    networkToleranceMs: integerSetting(env.LEADERBOARD_NETWORK_TOLERANCE_MS, 1000, 0, 5000, 'LEADERBOARD_NETWORK_TOLERANCE_MS'),
    maxRunAgeMs: integerSetting(env.LEADERBOARD_MAX_RUN_AGE_HOURS, 72, 1, 168, 'LEADERBOARD_MAX_RUN_AGE_HOURS') * 60 * 60 * 1000,
    requestLimitBytes: integerSetting(env.LEADERBOARD_REQUEST_LIMIT_BYTES, 1024, 64, 65536, 'LEADERBOARD_REQUEST_LIMIT_BYTES'),
    rateLimitPerMinute: integerSetting(env.LEADERBOARD_RATE_LIMIT_PER_MINUTE, 120, 1, 10000, 'LEADERBOARD_RATE_LIMIT_PER_MINUTE'),
    profileRateLimitPerMinute: integerSetting(env.LEADERBOARD_PROFILE_RATE_LIMIT_PER_MINUTE, 10, 1, 1000, 'LEADERBOARD_PROFILE_RATE_LIMIT_PER_MINUTE'),
  });
}
