import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { LeaderboardError } from './store.mjs';

function json(response, status, value, extraHeaders = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
  if (!match) throw new LeaderboardError(401, 'invalid_credential');
  return match[1];
}

function assertOnlyKeys(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some((key) => !keys.includes(key)) ||
      keys.some((key) => !Object.hasOwn(body, key))) {
    throw new LeaderboardError(400, 'invalid_body');
  }
}

async function readJson(request, maxBytes) {
  const type = request.headers['content-type'];
  if (type && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)) {
    throw new LeaderboardError(415, 'unsupported_media_type');
  }
  const declared = request.headers['content-length'];
  if (declared && Number(declared) > maxBytes) throw new LeaderboardError(413, 'request_too_large');

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new LeaderboardError(413, 'request_too_large');
    chunks.push(chunk);
  }
  if (length === 0) return {};
  if (!type) throw new LeaderboardError(415, 'unsupported_media_type');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new LeaderboardError(400, 'invalid_json');
  }
}

export function createLeaderboardServer({ store, config, clock = Date.now }) {
  const allowed = new Set(config.allowedOrigins);
  const rateBuckets = new Map();

  function rateAllowed(request, path) {
    const now = clock();
    const window = Math.floor(now / 60000);
    const forwardedIp = request.headers['fly-client-ip'];
    const clientIp = config.trustFlyClientIp && typeof forwardedIp === 'string' && isIP(forwardedIp)
      ? forwardedIp
      : request.socket.remoteAddress ?? 'unknown';
    const key = `${clientIp}:${path === '/v1/profiles' ? 'profiles' : 'other'}`;
    const limit = path === '/v1/profiles' ? config.profileRateLimitPerMinute : config.rateLimitPerMinute;
    const bucket = rateBuckets.get(key);
    const count = bucket?.window === window ? bucket.count + 1 : 1;
    rateBuckets.set(key, { window, count });
    if (rateBuckets.size > 10000) {
      for (const [candidate, value] of rateBuckets) {
        if (value.window < window) rateBuckets.delete(candidate);
      }
      if (rateBuckets.size > 10000) rateBuckets.clear();
    }
    return count <= limit;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://leaderboard.local');
      const path = url.pathname;
      if (!rateAllowed(request, path)) throw new LeaderboardError(429, 'rate_limited');

      const origin = request.headers.origin;
      if (origin) {
        if (!allowed.has(origin)) throw new LeaderboardError(403, 'origin_not_allowed');
        response.setHeader('vary', 'Origin');
        response.setHeader('access-control-allow-origin', origin);
      }

      if (path !== '/v1/leaderboard' && url.search) throw new LeaderboardError(400, 'invalid_query');

      if (request.method === 'OPTIONS') {
        if (!origin) throw new LeaderboardError(400, 'origin_required');
        response.writeHead(204, {
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-max-age': '600',
          'cache-control': 'no-store',
        });
        response.end();
        return;
      }

      if (request.method === 'GET' && path === '/health') {
        const ok = store.healthy();
        json(response, ok ? 200 : 503, { ok });
      } else if (request.method === 'POST' && path === '/v1/profiles') {
        assertOnlyKeys(await readJson(request, config.requestLimitBytes), []);
        json(response, 201, store.createProfile());
      } else if (request.method === 'POST' && path === '/v1/runs') {
        const credential = bearer(request);
        assertOnlyKeys(await readJson(request, config.requestLimitBytes), []);
        json(response, 201, store.startRun(credential));
      } else if (request.method === 'POST' && path === '/v1/runs/submit') {
        const credential = bearer(request);
        const body = await readJson(request, config.requestLimitBytes);
        assertOnlyKeys(body, ['runToken', 'initials', 'distance']);
        const result = store.submitRun(credential, body);
        json(response, result.accepted ? 200 : 422, result);
      } else if (request.method === 'GET' && path === '/v1/leaderboard') {
        if ([...url.searchParams.keys()].some((key) => key !== 'limit') || url.searchParams.getAll('limit').length > 1) {
          throw new LeaderboardError(400, 'invalid_limit');
        }
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 20;
        json(response, 200, store.getLeaderboard(limit));
      } else if (request.method === 'GET' && path === '/v1/me') {
        json(response, 200, store.getPersonal(bearer(request)));
      } else {
        throw new LeaderboardError(404, 'not_found');
      }
    } catch (error) {
      if (response.headersSent) return;
      const status = error instanceof LeaderboardError ? error.status : 500;
      const code = error instanceof LeaderboardError ? error.code : 'internal_error';
      if (status === 500) console.error(error);
      json(response, status, { error: code }, status === 413 ? { connection: 'close' } : {});
    }
  });

  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}
