# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a very early-stage scaffold, not a working application yet:

- `package.json` declares `"main": "index.js"`, but no `index.js` exists anywhere in the repo. `src/app.js` and `src/server.js` exist but are both **empty** — there is no Express app or listening server yet.
- `npm test` is still the default placeholder (`echo "Error: no test specified" && exit 1`). There is no build, lint, dev, or start script — `migrate` (see "Database migrations" below) is currently the only real script.
- `src/users/` contains one file per concern, empty except `users.strategys.js`: `users.controllers.js`, `users.queries.js`, `users.route.js`, `users.services.js` are all empty stubs.
- The initial schema migration has been applied to the Supabase database (see "Database migrations").

When adding functionality, treat this as greenfield work: you will likely be creating the entry point, wiring up Express, and filling in the first real files rather than modifying established patterns.

## Environment

- Config is loaded via `dotenv` from a `.env` file at the repo root (`.env` is gitignored).
- `database/connection.js` creates a `pg` `Pool` using `process.env.DATABASE_URL`, with `ssl: { rejectUnauthorized: false }` (required for Supabase).
- **Database is Supabase — use the Session pooler connection string, not "Direct connection".** Supabase's direct-connection host (`db.<ref>.supabase.co`) resolves to an IPv6-only address; on networks without IPv6 routing this fails with `ENOTFOUND`. The Session pooler host (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<project-ref>`) is IPv4-compatible and behaves like a normal session, so it works for both the app's `Pool` and for `node-pg-migrate` (which needs session-level advisory locks — the Transaction pooler on port 6543 does not reliably support those, so avoid it for migrations).
- **Gotcha:** if the DB password contains an `@`, it must be percent-encoded (`%40`) inside the connection string, or URL parsing will break at the wrong `@` and misidentify the host.
- `src/users/users.strategys.js` reads `process.env.JWT_ACCESS_SIGNATURE` and `process.env.JWT_REFRESH_SIGNATURE` for the JWT strategies, and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` for the Google strategy. The Google vars are set in `.env`; the JWT signature vars are not defined yet.

## Architecture direction

- **Module system:** `package.json` sets `"type": "module"` — all `.js` files are ES modules (`import`/`export`), matching the existing code in `database/connection.js` and `src/users/users.strategys.js`.
- **Feature-folder structure:** `src/<domain>/` holds one flat file per concern, named `<domain>.<concern>.js`, not subfolders:
  - `<domain>.route.js` — Express route definitions
  - `<domain>.controllers.js` — request handlers
  - `<domain>.services.js` — business logic
  - `<domain>.queries.js` — raw DB access via `pg`
  - `<domain>.strategys.js` — passport strategies, where relevant (seen in `users`)
  Follow this naming/layout when building out new domains.
- **Database access:** raw `pg` (`Pool`) via `database/connection.js`, no ORM/query builder — this is a deliberate, low-level choice by the project owner, not a placeholder to "upgrade" later. Migrations are plain SQL files under `database/migrations/`.
- **Auth stack:** `passport` with `passport-local`, `passport-jwt`, and `passport-google-oauth20` strategies, plus `jsonwebtoken` and `bcrypt`. `src/users/users.strategys.js` already scaffolds all four passport strategies (`jwt`, `jwt-refresh`, local, Google) but every DB lookup inside them is stubbed out (`null /*crear querie*/`) pending real queries in `users.queries.js`. This matches the `accounts` table (provider + provider_account_id) and `refresh_tokens` table in the schema.
- **Logging:** `pino` + `pino-http` (with `pino-pretty` as a dev dependency for formatted local output) are dependencies but not yet wired into `app.js`/`server.js`.
- **AI integrations:** both `openai` and `@google/genai` SDKs are dependencies, suggesting AI-generated content (e.g. for the `lessons`/`quizess` tables) is planned.
- **Validation:** `zod` is a dependency for schema validation; use it for request payload validation in controllers.
- Standard Express middleware present as dependencies: `cors`, `cookie-parser`, `express-rate-limit`.

## Database schema

Defined in `database/migrations/1785436594889_initial-schema.sql`, applied to Supabase:

- `users` — id (UUID), email, email_verified, name, password (nullable — supports OAuth-only accounts), image, role (`USER`/`ADMIN` enum), created_at.
- `accounts` — links a user to an auth provider (`LOCAL`/`GOOGLE` enum) + provider account id; unique per (provider, provider_account_id) and per (user_id, provider).
- `refresh_tokens` — JWT refresh tokens per user with expiry.
- `verification_codes` — one-time codes per user with expiry/used_at (email verification / password reset).
- `feedback_messages` / `feedback_answers` / `feedback_message_likes` / `feedback_answer_likes` — a feedback/forum-style feature: messages, threaded answers, and likes on both, each with `updated_at` maintained by the shared `set_updated_at()` trigger function.
- `routes`, `lessons`, `quizess` — stub tables for a learning-path/lesson/quiz feature (name has a typo: "quizess").

## Database migrations

`node-pg-migrate` is wired up via the `migrate` npm script, configured to use `database/migrations` and plain SQL files (`--migration-file-language sql`):

- **Create a new migration:** `npm run migrate create <name>` → generates `database/migrations/<timestamp>_<name>.sql` with empty `-- Up Migration` / `-- Down Migration` sections. Write the forward SQL under Up and its reverse (e.g. `DROP TABLE`/`DROP COLUMN`) under Down.
- **Apply pending migrations:** `npm run migrate up`
- **Roll back the most recent migration:** `npm run migrate down`
- **Preview without executing:** pass flags through with `--`, e.g. `npm run migrate -- up --dry-run`
- Applied migrations are tracked in the `pgmigrations` table inside the Supabase database itself — that's the source of truth for what has/hasn't run, not any local state.
- `DATABASE_URL` in `.env` must be the Supabase **Session pooler** string (see "Environment" above) for both the app and the migration CLI to connect successfully.
