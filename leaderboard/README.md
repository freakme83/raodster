# AIRSHIFT leaderboard service

This directory is a separate Node.js service. It does not change the browser game. The service will use SQLite at a configurable path on a Fly.io persistent volume. Node.js 24.15 or newer is required for its built-in `node:sqlite` module; the browser game keeps its existing Node requirement.

## Planned API

All request and response bodies are JSON. The service stores distances in raw metres. Initials must match `^[A-Z0-9]{3}$`; different profiles may share initials.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process and database readiness. |
| `POST` | `/v1/profiles` | Issue an unpredictable anonymous profile bearer credential. Store only its hash server-side; the browser retains the credential in its profile. |
| `POST` | `/v1/runs` | Start one server-timed run for the authenticated profile. Creating a new run invalidates its previous active run. Return an unpredictable, single-use run token. |
| `POST` | `/v1/runs/submit` | Validate `initials`, raw `distance`, and the run token. Consume the run and update the profile's personal best in one SQLite transaction. |
| `GET` | `/v1/leaderboard?limit=20` | Public top 20 by default, or top 100 with `limit=100`; return total ranked profiles. |
| `GET` | `/v1/me` | With the profile credential, return personal best, global rank, total ranked profiles, and percentile. |

Profile and run tokens will be sent in authorization headers, not query parameters. The browser must not send authoritative timestamps or pause durations. The service records start, submission, and expiry times using its own clock. All write routes will enforce JSON types, request-size limits, rate limits, and restrictive CORS. The configured origin must be explicit. No credentials are required to read public rankings.

## Score plausibility

AIRSHIFT advances `1/120` simulated second per physics step. Within a step it advances simulation time, calculates `speedAt(time)`, then adds `speed × step` to distance. For `n` permitted steps, the distance ceiling is the deterministic sum `sum(speedAt(k / 120) / 120)` for `k = 1..n`. The server derives `n` from its elapsed wall time plus a small configured network tolerance and one fixed-step boundary allowance. It never trusts client-reported elapsed time.

Wall time includes pauses, hidden tabs, stalled frames, and network delay. The bound therefore rejects impossible speed while permitting fabricated scores that fit the elapsed-time envelope. It does not establish that the game was played legitimately. The run policy will allow long sessions and expire abandoned sessions after a documented long maximum age; no heartbeat or pause accounting is planned.

## SQLite design

- `profiles`: primary key, SHA-256 hash of the profile bearer credential (unique), best raw distance, best initials, and server timestamps. One row per browser profile; only higher verified distances replace its best.
- `runs`: primary key, profile foreign key, SHA-256 hash of the one-time run token (unique), server-issued timestamp, expiry, and consumed/invalidated state. At most one active run per profile.

SQLite migrations run at service startup. Submission and personal-best replacement happen under one transaction so concurrent requests cannot both consume the same run. A single Fly.io Machine with one attached SQLite volume is the intended initial topology; backups and volume replacement must be planned before staging.

## Status

The first scaffold currently exposes only `GET /health`. The remaining routes, migration, security checks, deployment configuration, and tests will be added in this PR.
