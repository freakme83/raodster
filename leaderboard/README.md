# AIRSHIFT leaderboard service

This directory is an independent Node.js service. It imports AIRSHIFT's pure `speedAt` and fixed-step constants from `src/physics.js`; it does not change the browser game. Node.js 24.15+ provides its built-in `node:sqlite` module, so the service has no package dependencies. The browser game keeps its existing Node requirement.

## Run locally

From `leaderboard/`:

```sh
LEADERBOARD_DB_PATH=./leaderboard.sqlite npm run db:init
LEADERBOARD_DB_PATH=./leaderboard.sqlite LEADERBOARD_ALLOWED_ORIGINS=http://localhost:3000 npm start
npm test
```

`db:init` applies the current SQLite migration. Startup also applies it automatically. The database parent directory must already exist; in Fly.io, `/data` must be an attached persistent volume. The service fails to start if it cannot open the configured path.

| Setting | Default | Purpose |
| --- | --- | --- |
| `LEADERBOARD_DB_PATH` | `./leaderboard.sqlite` | SQLite file path. Set to `/data/leaderboard.sqlite` on Fly.io. |
| `HOST`, `PORT` | `0.0.0.0`, `8080` | HTTP listener. |
| `LEADERBOARD_ALLOWED_ORIGINS` | Empty | Comma-separated exact HTTP(S) browser origins. No wildcard or reflection. Set the production and approved preview origins explicitly before browser integration. |
| `LEADERBOARD_NETWORK_TOLERANCE_MS` | `1000` | Extra time in the score plausibility envelope; permitted range 0–5000 ms. |
| `LEADERBOARD_MAX_RUN_AGE_HOURS` | `72` | Long-run expiration, permitted range 1–168 hours. |
| `LEADERBOARD_REQUEST_LIMIT_BYTES` | `1024` | Maximum JSON body size, permitted range 64–65536 bytes. |
| `LEADERBOARD_RATE_LIMIT_PER_MINUTE` | `120` | Per-connection-IP fixed-minute limit for general endpoints. |
| `LEADERBOARD_PROFILE_RATE_LIMIT_PER_MINUTE` | `10` | Separate per-connection-IP fixed-minute limit for profile creation. |
| `LEADERBOARD_TRUST_FLY_CLIENT_IP` | `false` | Use the validated `Fly-Client-IP` header for rate limits only when requests are guaranteed to arrive through Fly Proxy. Fly configuration enables it. |

## API

All API bodies are JSON. Distances are raw metres. Initials must match `^[A-Z0-9]{3}$`; different profiles can share initials. The browser should retain `profileToken` in its own persistent profile storage. Secrets belong in authorization headers or a POST body, never in URLs.

| Method | Path | Input | Output |
| --- | --- | --- | --- |
| `GET` | `/health` | None | `{ "ok": true }` if SQLite is reachable. |
| `POST` | `/v1/profiles` | Empty body or `{}` | `201 { "profileToken": "..." }`. Server generates 256 random bits. |
| `POST` | `/v1/runs` | `Authorization: Bearer <profileToken>` and empty body or `{}` | `201 { "runToken", "issuedAtMs", "expiresAtMs" }`. Starting another run invalidates the prior active run for that profile. |
| `POST` | `/v1/runs/submit` | Profile bearer credential; `{ "runToken", "initials", "distance" }` | `200` accepted result, or `422` for expired/impossible score. A processed run is consumed in either case. |
| `GET` | `/v1/leaderboard` | Optional `?limit=100`; default 20 | `{ "entries", "totalRanked", "limit" }`. Each entry has initials, distance, rank. |
| `GET` | `/v1/me` | Profile bearer credential | `{ "best", "rank", "totalRanked", "percentile" }`; unranked profiles have null best/rank/percentile. |

An accepted submission includes `personalBestUpdated` and the same personal ranking fields as `/v1/me`. A lower verified distance consumes its run and returns `personalBestUpdated: false`; it does not replace the best score or initials. Missing/malformed credentials return `401`, unavailable or previously consumed runs return `409`, malformed input returns `400`, oversized bodies return `413`, and disallowed browser origins return `403`.

Ranks use competition ranking: one plus the number of profiles with a strictly higher best distance. Tied scores share a rank. The board orders ties by earliest best update, then profile ID. Percentile is `100 × (totalRanked − rank) / (totalRanked − 1)`, rounded to two decimals; a sole ranked profile has 100%. Top means 100%, bottom means 0%. The database keeps one best score per profile, with no initials uniqueness rule.

## Server-time score bound

AIRSHIFT advances by `h = 1/120` simulated second per physics step. Each step advances simulation time, calculates `speedAt(time)`, then adds `speed × h` to distance. For `n` steps, the maximum distance is `h × Σ[k=1..n] speedAt(kh)`. The server computes `n = ceil((elapsed server milliseconds + configured network tolerance) / (1000h)) + 1`; the extra step covers a fixed-step timestamp boundary. It adds 0.5 metre for accumulated floating-point variation.

The first 600 simulated seconds use the exact speed curve. At 600 seconds `speedAt` reaches its 80 m/s floating-point ceiling; a constant 80 m/s tail makes checks for 72-hour runs constant time. The server records its own issue and submission timestamps. It ignores client timestamps and pause durations. A run is accepted through its exact expiry timestamp and rejected afterward. The default 72-hour policy accommodates long runs without heartbeats; starting another run invalidates an abandoned one.

Server wall time includes pauses, hidden tabs, rendering stalls, and network delay while the game can be frozen or slower. Waiting enlarges the bound, so a modified client can submit a fabricated but plausible distance. This check rejects impossible speed, replay of consumed tokens, and stale sessions; it does not prove gameplay, collisions, controls, or human identity. A player can clear browser storage and obtain another anonymous profile. Host clock movement and distributed requests can also weaken timing and rate limits; staging should monitor these risks.

## Storage and deployment preparation

SQLite schema version 1 has `profiles` and `runs` tables. Profile and run bearer tokens are 256-bit random values; the database stores only SHA-256 hashes. A unique partial index allows at most one unconsumed, non-invalidated run per profile. `BEGIN IMMEDIATE` transactions atomically invalidate old runs or consume a submitted run and update a higher personal best. Expired and consumed run metadata is retained for audit and replay rejection; add an operational retention job if its size becomes material.

Rate limits normally use the direct socket address. On Fly.io, many players can share a proxy socket address, so the Fly deployment enables trusted `Fly-Client-IP` for rate limits. The header must contain a valid IP address; malformed or missing values fall back to the socket address. Never enable this setting on a directly reachable service or through a proxy that forwards client-supplied values unchanged, because clients could then spoof their rate-limit identity.

`fly.toml` and `Dockerfile` prepare a separate Fly.io app with a `/data` SQLite volume and one continuously running Machine. Do not deploy before setting exact allowed origins, creating a volume, confirming backups/restore, and ensuring Machine count is one. SQLite is not set up for simultaneous writes from multiple Fly Machines. Volume snapshots need an additional tested backup and restore procedure before production use.
