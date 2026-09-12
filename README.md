# User Mapping Service

A small REST API that maps an `(id1, id2)` pair to a stable `userID`.

* **Framework / language:** NestJS 11 on Node.js + TypeScript
* **Database:** MySQL 8 (the single source of truth), accessed with TypeORM
* **Cache / lock:** Redis (optional; the service is fully correct without it)

The API is idempotent: the first request for a pair generates a UUID v4, stores it and returns
it; every later request for the same pair returns the very same `userID`.

---

## Table of contents

1. [Quick start with Docker Compose](#quick-start-with-docker-compose)
2. [Local development](#local-development)
3. [Configuration](#configuration)
4. [Database setup (migrations)](#database-setup-migrations)
5. [API](#api)
6. [Tests](#tests)
7. [How Redis is used](#how-redis-is-used)
8. [Concurrency handling](#concurrency-handling)
9. [Error handling](#error-handling)
10. [Assumptions and technical decisions](#assumptions-and-technical-decisions)
11. [Project structure](#project-structure)

---

## Quick start with Docker Compose

Everything (API + MySQL 8 + Redis) starts with one command:

```bash
cp .env.example .env      # adjust the passwords if you like
docker compose up --build
```

The API is then available on <http://localhost:3000>:

```bash
curl -X POST http://localhost:3000/api/v1/user-mappings \
  -H 'Content-Type: application/json' \
  -d '{"id1":"ABC123","id2":"XYZ456"}'
# {"userID":"550e8400-e29b-41d4-a716-446655440000"}

# the same pair always returns the same userID
curl -X POST http://localhost:3000/api/v1/user-mappings \
  -H 'Content-Type: application/json' \
  -d '{"id1":"ABC123","id2":"XYZ456"}'
# {"userID":"550e8400-e29b-41d4-a716-446655440000"}
```

* Swagger UI: <http://localhost:3000/api/docs>
* Health probe: <http://localhost:3000/api/v1/health>

The API container runs the TypeORM migrations before it starts serving traffic, so no manual
database step is required.

## Local development

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 20 or newer (22 LTS recommended) |
| npm | 10 or newer |
| MySQL | 8.x |
| Redis | 6 or newer (optional, see [How Redis is used](#how-redis-is-used)) |
| Docker + Compose | optional, for the one-command setup |

### Install and run

```bash
npm install
cp .env.example .env          # then fill in your local credentials - .env is git-ignored
npm run migration:run         # create the schema
npm run start:dev             # watch mode, http://localhost:3000
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | start with file watching |
| `npm run start:prod` | run the compiled output (`npm run build` first) |
| `npm run build` | compile TypeScript to `dist/` |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm test` | unit tests |
| `npm run test:e2e` | integration tests |
| `npm run test:cov` | unit tests with coverage |
| `npm run migration:run` / `migration:revert` / `migration:show` | TypeORM migrations |

## Configuration

All configuration comes from environment variables (loaded from `.env` in local development,
and from the environment in Docker). No secret is hard-coded anywhere in the repository; the
schema is validated by Joi at boot, so the application refuses to start with an invalid setup.

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | HTTP port |
| `API_GLOBAL_PREFIX` | `api` | Prefix of every route (versioning adds `/v1`) |
| `DB_TYPE` | `mysql` | `mysql` everywhere; `better-sqlite3` is used by the tests only |
| `DB_HOST` / `DB_PORT` | `localhost` / `3306` | MySQL endpoint |
| `DB_USERNAME` / `DB_PASSWORD` | – | MySQL credentials (required for MySQL) |
| `DB_DATABASE` | – | Database name (required for MySQL) |
| `DB_SYNCHRONIZE` | `false` | Must stay `false`: the migrations own the schema |
| `DB_LOGGING` | `false` | Log executed SQL |
| `DB_POOL_SIZE` | `10` | MySQL connection pool size |
| `REDIS_URL` | `''` | `redis://[:password@]host:port`. **Empty disables Redis** |
| `REDIS_KEY_PREFIX` | `user-mapping:` | Prefix of every Redis key |
| `REDIS_CACHE_TTL_SECONDS` | `900` | TTL of cached `userID` values |
| `REDIS_LOCK_TTL_MS` | `5000` | TTL of the short-lived distributed lock |

## Database setup (migrations)

The schema is created by a TypeORM migration, which is the single source of truth for the
MySQL schema (the application never synchronises the schema itself).

```bash
npm run migration:run     # apply
npm run migration:show    # list
npm run migration:revert  # roll back the last migration
```

The migration creates:

```sql
CREATE TABLE user_mappings (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id1        VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  id2        VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  user_id    VARCHAR(36) COLLATE ascii_general_ci NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE INDEX uq_user_mappings_id1_id2 (id1, id2),
  INDEX idx_user_mappings_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

| Column | Why |
| --- | --- |
| `id` | Surrogate primary key; keeps InnoDB inserts sequential |
| `id1`, `id2` | The identifying pair. `utf8mb4_bin` keeps identifiers case-sensitive, so `ABC` and `abc` stay different pairs |
| `user_id` | The generated UUID v4, stored as its canonical 36-character text form |
| `created_at` / `updated_at` | Operational visibility |
| `uq_user_mappings_id1_id2` | **The guarantee** that one pair maps to exactly one `userID`, including under concurrency |
| `idx_user_mappings_user_id` | Supports lookups by `userID` |

## API

Interactive documentation (Swagger UI): `GET /api/docs`, OpenAPI JSON: `GET /api/docs-json`.

### `POST /api/v1/user-mappings`

Resolves the `userID` of an `(id1, id2)` pair, creating it on first sight.

**Request**

```json
{
  "id1": "ABC123",
  "id2": "XYZ456"
}
```

`id1` and `id2` are both required, must be strings of 1-64 characters, and are trimmed.
Unknown properties are rejected.

**Response `200 OK`**

```json
{
  "userID": "550e8400-e29b-41d4-a716-446655440000"
}
```

The same status and the same body are returned whether the mapping already existed or was just
created, which makes retries safe for clients.

**Error responses**

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["id2 must be a string", "id2 should not be empty"],
  "path": "/api/v1/user-mappings",
  "timestamp": "2024-05-01T10:00:00.000Z"
}
```

| Status | When |
| --- | --- |
| `400` | Missing, empty, non-string or oversized identifiers, malformed JSON, unknown properties |
| `404` | Unknown route |
| `503` | MySQL is unreachable (the request can be retried) |
| `500` | Unexpected server error - the response never exposes internals; details are logged server-side |

### `GET /api/v1/health`

```json
{ "status": "ok", "database": "up", "redis": "up" }
```

`redis` is `disabled` when `REDIS_URL` is empty and `down` when the configured Redis cannot be
reached. Redis being down does **not** make the service unhealthy, because the API stays correct
without it.

## Tests

```bash
npm test           # unit tests - no external services required
npm run test:e2e   # integration tests - no external services required
npm run test:cov   # unit tests with coverage
```

**Unit tests** (`src/**/*.spec.ts`) cover the decision logic with mocked collaborators:

* a new pair generates and stores a UUID v4,
* an existing pair returns the stored `userID`,
* a cache hit answers without touching MySQL,
* the loser of a concurrent insert returns the winner's `userID`,
* unexpected database errors propagate instead of being swallowed,
* the whole flow still works when Redis is unavailable,
* payload validation (missing / blank / non-string / oversized identifiers),
* error mapping (400 / 404 / 500 / 503) and the fact that internal messages never leak,
* Redis key prefixing, lock acquisition/release and fail-open behaviour.

**Integration tests** (`test/*.e2e-spec.ts`) boot the real application through the same HTTP
pipeline used in production (`configureApp`), against an in-memory SQLite database with Redis
disabled, and assert the full behaviour including eight simultaneous identical requests
producing one row and one `userID`. They need no services and are safe to run anywhere.

To run the same integration suite against the real MySQL 8 and Redis (this is what CI should
use, and it exercises MySQL's own duplicate-key error):

```bash
docker compose up -d mysql redis

# a dedicated database, so the tests never touch application data
docker compose exec mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-local_root_password}" \
  -e "CREATE DATABASE IF NOT EXISTS user_mapping_test; GRANT ALL ON user_mapping_test.* TO 'app'@'%';"

DB_TYPE=mysql DB_HOST=127.0.0.1 DB_PORT=3306 DB_USERNAME=app DB_PASSWORD=local_app_password \
DB_DATABASE=user_mapping_test DB_SYNCHRONIZE=true REDIS_URL=redis://127.0.0.1:6379 \
npm run test:e2e
```

(`DB_SYNCHRONIZE=true` lets TypeORM create the test schema from the entity; the application
itself always uses migrations.) Each test works on its own `id1`/`id2` pair so that a running
Redis cache cannot leak state between tests.

## How Redis is used

Redis is used for two things, both of them optimisations rather than sources of truth:

1. **Read cache.** After a `userID` is read from or written to MySQL it is cached under
   `user-mapping:id:<sha256(id1, id2)>` for `REDIS_CACHE_TTL_SECONDS`. A cache hit answers the
   request without querying MySQL. The key is hashed so that arbitrary identifiers cannot
   collide in the key space. Entries never need invalidation because the table is append-only:
   a row is written once and never updated or deleted.
2. **Distributed lock.** Before inserting, the service tries
   `SET user-mapping:lock:<sha256(id1, id2)> <token> NX PX REDIS_LOCK_TTL_MS`. The lock keeps
   simultaneous identical requests from racing towards the same insert. It is released with a
   Lua script that deletes the key only when the stored token is still ours, and the TTL makes
   sure a crashed process cannot block the pair forever.

**MySQL stays the source of truth.** Every Redis call is wrapped so that a timeout, an outage or
an empty `REDIS_URL` degrades to "no cache, no lock" and the request still succeeds through
MySQL. Redis is never asked for data that is not already in MySQL, and nothing is ever lost if
Redis is flushed. This is why `REDIS_URL` is optional in the configuration.

## Concurrency handling

Two requests carrying the same brand-new pair can arrive at the same moment. The design handles
that in three layers:

1. **The unique index is the guarantee.** The insert is a single statement
   (`INSERT INTO user_mappings ...`) and MySQL rejects the second one with a duplicate-key
   error. The losing request catches that error, reads the row that won, and returns its
   `userID`. Both callers therefore receive the same value and exactly one row exists. This
   works with or without Redis.
2. **The Redis lock makes the race rare.** Identical concurrent requests are serialised per
   pair; the second one finds the row on its re-check and never reaches the insert.
3. **The re-check inside the lock** absorbs the window between the first `SELECT` and the lock
   acquisition.

No transaction is needed: a single-row insert plus a unique constraint is already atomic, and no
other write path exists. The lock is deliberately best-effort - if Redis is unavailable the
service keeps working and simply falls back to layer 1.

## Error handling

* A global `ValidationPipe` rejects malformed payloads before any business logic runs, with
  `whitelist` (unknown properties are stripped) and `forbidNonWhitelisted` (unknown properties
  are reported as a 400).
* A single global exception filter turns every failure into the same JSON shape, keeps the
  correct status code, logs the details (including the stack) server-side, and answers
  unexpected errors with a generic message so that SQL, connection strings and stack traces are
  never exposed to clients.
* Database connectivity problems are reported as `503` so clients know the request is
  retryable, while genuine application errors stay `500`.
* Unhandled promise rejections and database errors cannot crash the process: TypeORM errors
  surface as exceptions that the filter catches.

## Assumptions and technical decisions

* **`id1` / `id2` are opaque identifiers** of at most 64 characters. They are trimmed of
  surrounding whitespace and compared case-sensitively (the columns use a binary collation).
  No format is imposed because the brief does not specify one.
* **The pair is ordered**: `(ABC123, XYZ456)` and `(XYZ456, ABC123)` are two different pairs.
* **`200 OK` for both "found" and "created".** The endpoint resolves a mapping; it is
  idempotent, and returning a different status for the two cases would make clients treat
  retries as errors. The creation is logged, so the event is still observable.
* **The mapping table is append-only**, which is what makes caching without invalidation safe.
* **`userID` is a UUID v4** generated with `crypto.randomUUID()` and stored as 36 characters.
* **Migrations own the schema.** `DB_SYNCHRONIZE` is `false` everywhere except the tests, and
  the production image applies migrations before starting.
* **`better-sqlite3` support exists only for the test suite** so that `npm run test:e2e` runs
  without Docker; MySQL remains the only supported production database.
* **No authentication** is implemented: the brief does not mention callers or credentials, and
  inventing an auth scheme would add unrequested surface area. In a real deployment this
  endpoint would sit behind the platform's authentication and rate limiting.
* **Node.js 20+** is required (`crypto.randomUUID`, TypeScript 5 output).

## Project structure

```
src/
├── app.module.ts                     # composition root
├── app.setup.ts                      # HTTP pipeline shared by main.ts and the e2e tests
├── main.ts                           # bootstrap
├── config/                           # environment schema (Joi) + typed configuration factories
├── database/
│   ├── database.module.ts            # TypeORM connection options
│   ├── data-source.ts                # DataSource used by the migration CLI
│   └── migrations/                   # schema history (source of truth for MySQL)
├── redis/
│   ├── redis.module.ts
│   └── redis.service.ts              # failure-tolerant cache and lock primitives
├── common/
│   ├── dto/api-error.dto.ts          # documented error shape
│   ├── errors/database-error.util.ts # duplicate-key and connectivity classification
│   └── filters/all-exceptions.filter.ts
├── health/                           # readiness probe
└── user-mapping/
    ├── dto/                          # request validation + response contract
    ├── entities/user-mapping.entity.ts
    ├── user-mapping.controller.ts    # HTTP layer
    ├── user-mapping.service.ts       # resolve-or-create logic
    └── user-mapping.module.ts
test/
├── setup-env.ts                      # test environment defaults
├── user-mapping.e2e-spec.ts
└── health.e2e-spec.ts
docs/sequence-diagram.md              # sequence diagram of the main flow
```

See [docs/sequence-diagram.md](docs/sequence-diagram.md) for the sequence diagram.
