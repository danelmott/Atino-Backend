# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a very early-stage scaffold, not a working application yet:

- `package.json` declares `"main": "index.js"`, but no `index.js` exists anywhere in the repo. There is no server entry point yet.
- The only npm script is the default placeholder: `npm test` just runs `echo "Error: no test specified" && exit 1`. There is no build, lint, dev, or start script configured.
- `src/users/{controllers,queries,services}` exist as empty feature folders (one file, `src/users/queries/createUser.js`, is present but empty).
- The DB migration file has not been run/verified — see "Known issues" below, it currently contains SQL that will fail.

When adding functionality, treat this as greenfield work: you will likely be creating the entry point, wiring up Express, and filling in the first real files rather than modifying established patterns.

## Environment

- Config is loaded via `dotenv` from a `.env` file at the repo root.
- `database/connection.js` creates a `pg` `Pool` using `process.env.CONNECTION_STRING`.
- **Known mismatch:** `.env` currently defines the key as `CONECTION_STRING` (missing an "N"), but the code reads `CONNECTION_STRING`. As written, `dbConnection` receives `undefined` for its connection string. Fix by aligning the `.env` key with the code (or vice versa) before the DB pool will work.

## Architecture direction

- **Module system:** `package.json` sets `"type": "commonjs"`, but existing code (`database/connection.js`) uses ES module `import`/`export` syntax. This is inconsistent — be aware any new file follows whichever convention actually runs (check for a transpiler/loader before assuming ESM works, or align on CommonJS).
- **Feature-folder structure:** the `src/users` folder establishes the intended pattern for domains: `src/<domain>/{controllers,queries,services}`. Follow this layout (`controllers` = request handlers, `queries` = raw DB access via `pg`, `services` = business logic) when building out new domains.
- **Database access:** raw `pg` (`Pool`) via `database/connection.js`, no ORM. Migrations are plain SQL files under `database/migrations/`.
- **Auth stack (from dependencies, not yet implemented in `src/`):** `passport` with `passport-local`, `passport-jwt`, and `passport-google-oauth` strategies, plus `jsonwebtoken` — the schema's `accounts` table (provider + provider_account_id) and `refresh_tokens` table confirm a local-credentials + Google OAuth + JWT refresh-token design.
- **AI integrations:** both `openai` and `@google/genai` SDKs are dependencies, suggesting AI-generated content (e.g. for the `lessons`/`quizess` tables) is planned.
- **Validation:** `zod` is a dependency for schema validation; use it for request payload validation in controllers.
- Standard Express middleware present as dependencies: `cors`, `cookie-parser`, `express-rate-limit`.

## Database schema

Defined in `database/migrations/inital_schema.sql` (filename has a typo: "inital"):

- `users` — id (UUID), email, email_verified, name, password (nullable — supports OAuth-only accounts), image, role (`USER`/`ADMIN` enum), created_at.
- `accounts` — links a user to an auth provider (`LOCAL`/`GOOGLE` enum) + provider account id; unique per (provider, provider_account_id) and per (user_id, provider).
- `refresh_tokens` — JWT refresh tokens per user with expiry.
- `verification_codes` — one-time codes per user with expiry/used_at (email verification / password reset).
- `feedback_messages` / `feedback_answers` / `feedback_message_likes` / `feedback_answer_likes` — a feedback/forum-style feature: messages, threaded answers, and likes on both, each with `updated_at` maintained by the shared `set_updated_at()` trigger function.
- `routes`, `lessons`, `quizess` — stub tables for a learning-path/lesson/quiz feature (name has a typo: "quizess"). **These currently have invalid SQL** (trailing commas before the closing `)` on the last column of each table), so the migration file will fail to run as-is until fixed.

There is no migration runner configured — apply SQL files manually against Postgres for now.
