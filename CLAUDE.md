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
- **Logging:** `pino` + `pino-http` (with `pino-pretty` for formatted local output), wired in `app.js` via `app.use(pinoHttp({ logger }))`. The shared instance lives in `src/lib/logger.js` and redacts cookie/authorization headers. Per-module loggers use `logger.child({ module: '<name>' })` — see `src/uploads/uploads.services.js`.
- **AI integrations:** both `openai` and `@google/genai` SDKs are dependencies, suggesting AI-generated content (e.g. for the `lessons`/`quizzes` tables) is planned.
- **Validation:** `zod` is a dependency for schema validation; use it for request payload validation in controllers.
- Standard Express middleware present as dependencies: `cors`, `cookie-parser`, `express-rate-limit`.

## The creator flow (routes → lessons → quizzes)

A route is authored in two steps: first the route itself (title, description, cover, topics), then its content. `src/routes/`, `src/lessons/` and `src/quizzes/` implement **authoring only** — taking a quiz and grading it (`quiz_attempts`) is not built yet.

**Ordering is the non-obvious part.** `lessons.position` orders lessons within a route; a quiz does *not* have its own route-level sequence — it hangs off a lesson via `quizzes.after_lesson_id` and appears right after it. `after_lesson_id IS NULL` means "at the end of the route" (final exam). `getRouteOutline()` in `routes.queries.js` produces the interleaved list with a `UNION ALL`, using `sub_pos = 0` for lessons so a lesson always precedes its own quizzes. Consequence of this model: **a quiz cannot be placed before the first lesson.**

`uq_quizzes_slot` is deliberately `UNIQUE (route_id, after_lesson_id, position)` with default NULL semantics, *not* `NULLS NOT DISTINCT`. With NULLs treated as equal, the `ON DELETE SET NULL` on `after_lesson_id` can collide with an existing end-of-route quiz and make **deleting a lesson fail**. Ordering among several final quizzes is tie-broken by `created_at` instead.

**Nested payloads.** A lesson arrives with its `blocks`, a quiz with its `questions` and `options`, each in one request and one transaction. Editing is a `PUT` that replaces the children wholesale. Child `position` comes from array order, so a client can never send duplicate or gapped positions.

**Authorization** always starts from `findRouteForOwner()` in `routes.queries.js` — lessons and quizzes both import it rather than re-implementing the `(user_id = $2 OR $3 = TRUE)` check. A quiz's `afterLessonId` is additionally validated to belong to the same route, or it could be attached to another user's lesson.

`reorderLessons` uses `SET CONSTRAINTS uq_lessons_route_position DEFERRED` inside the transaction — that is what the `DEFERRABLE` declaration in the schema is for. Without it a bulk position swap aborts mid-statement.

## Uploads / S3

`src/uploads/` handles all binary content (route covers, lesson slide images/videos, quiz question images). The file never passes through Express — the client uploads straight to S3 with a presigned URL.

**The three-step flow:**

1. `POST /uploads/sign` with `{ scope, contentType, size }` → returns `{ url, key, expiresIn }`.
2. Client does a plain `PUT` to `url` with the exact bytes it declared.
3. The domain service (`routes`, `lessons`, `quizzes`) calls `verifyUpload(user, key, scope)` **before** the `INSERT`, then stores the `key`.

**The DB stores the key, never the URL.** A URL embeds bucket, region and domain — infra config duplicated across every row of `routes.image`, `lesson_blocks.url` and `quiz_questions.image`. The key (`uploads/<scope>/<userId>/<uuid>.<ext>`) is the canonical id and never changes; URLs are derived at read time with `urlOfReading(key, kind)`. Moving to CloudFront later means editing one function, not migrating three tables.

**`UPLOAD_SCOPES`** in `uploads.services.js` is the policy table — each destination declares which content kinds it accepts. Adding a new upload destination is one line there (`uploads.schemas.js` derives its `z.enum` from it, so the two cannot drift). Limits: images 10 MB (`jpeg`/`png`/`webp`), video 200 MB (`mp4`/`webm`/`quicktime`).

### Deleting attachments (the cascade problem)

Nothing deletes S3 objects directly. **Everything goes through the `pending_deletions` queue.** S3 and Postgres cannot share a transaction, so "delete the row and delete the object" is never atomic — the DB is always the source of truth and S3 cleanup happens after.

The keys are enqueued **inside the same transaction** as the `DELETE`, which is what makes it safe: either the route is deleted and its keys are queued, or neither happens. A crash between commit and S3 can no longer orphan an object. `drainPendingDeletions()` (in `uploads.services.js`) empties the queue with `DeleteObjectsCommand`; `startDeletionWorker()` in `server.js` retries whatever failed every 5 minutes.

**The trap this exists to solve:** `routes → lessons → lesson_blocks` and `routes → quizzes → quiz_questions` all cascade. A `DELETE FROM routes` silently removes every row holding a key, so you never see them. **`collectRouteAttachmentKeys()` must run *before* the `DELETE`** — afterwards those keys are unrecoverable. Any new domain that stores keys must follow the same order: collect → delete → enqueue, all in one `withTransaction`.

Rows survive failures (`attempts` is incremented, `last_error` recorded) and are abandoned after 5 tries. `DeleteObject` is idempotent in S3, so retrying a key that is already gone succeeds rather than jamming the queue.

**Replacing an attachment: use `orphanKeys(previous, next)`** from `uploads.services.js`, never "enqueue all the old ones". In a `PUT` the user typically keeps some attachments; enqueueing those would delete an object the row still points at. It also strips external links.

**Gotchas:**

- **`ContentLength` is passed to `PutObjectCommand` on purpose.** It makes `content-length` a *signed* header, so S3 itself rejects a PUT whose byte count differs from what was declared. Remove it and the size limit becomes an honour system.
- **`requestChecksumCalculation: 'WHEN_REQUIRED'` on the S3 client is load-bearing.** By default the SDK appends `x-amz-checksum-crc32` to the presigned URL, computed over an empty body (`AAAAAA==`) because at signing time there is no content. S3 then validates that checksum against what the client actually uploads, so **every non-empty upload fails**. Drop that option and all uploads break in a way that looks like a signature bug.
- **`urlOfReading` rounds `signingDate`** to half the TTL. Without it every call returns a different query string and the browser re-downloads the file on every page load. With it, the same key yields a byte-identical URL inside the window, so caching works.
- **Never log the signed URL.** It contains `X-Amz-Signature`, which is a write capability on the bucket — anyone reading it in the logs can upload. Log the `key` instead.
- **`users.image` is a mixed column:** a full Google URL for OAuth accounts (set in `auth.strategys.js`), or an S3 key. `urlOfReading` returns anything starting with `http` untouched.
- **`lib/s3.js` passes credentials explicitly** via `requireEnv`, so a missing var fails at boot rather than on a user's first upload. It does *not* import `dotenv/config` — `server.js` loads it first. Any standalone script that imports `s3.js` directly must run with `node --env-file=.env`.
- **The IAM user needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject`** on `arn:aws:s3:::<bucket>/*`. Without them every operation returns a `403 AccessDenied` that looks identical to a signature problem — check the `<Code>` in the XML body to tell them apart. Note `DeleteObjects` reports this *per key* inside `result.Errors` rather than throwing, so the queue records it as a failed attempt instead of blowing up.
- **Filter keys with `isStorageKey()` before enqueueing a delete.** `lesson_blocks.url` and `users.image` are mixed columns that may hold an external link (a pasted YouTube URL, a Google avatar); those must never reach `DeleteObjects`.

## Database schema

Defined in `database/migrations/1785436594889_initial-schema.sql`, applied to Supabase:

- `users` — id (UUID), email, email_verified, name, password (nullable — supports OAuth-only accounts), image, role (`USER`/`ADMIN` enum), created_at.
- `accounts` — links a user to an auth provider (`LOCAL`/`GOOGLE` enum) + provider account id; unique per (provider, provider_account_id) and per (user_id, provider).
- `refresh_tokens` — JWT refresh tokens per user with expiry.
- `verification_codes` — one-time codes per user with expiry/used_at (email verification / password reset).
- `topics` — seeded with 8 starter categories (`database/migrations/1785612189392_seed-initial-topics.sql`); adjust the list to the product.
- `quizzes.after_lesson_id` — added in `1785612187262_quizzes-after-lesson-order.sql`; see "The creator flow" above for why it replaced the route-level position sequence.
- `pending_deletions` — queue of S3 keys awaiting deletion (`database/migrations/1785602157806_pending-deletions-queue.sql`). Filled inside the same transaction that deletes the referencing rows; see "Deleting attachments" above.
- `feedback_messages` / `feedback_answers` / `feedback_message_likes` / `feedback_answer_likes` — a feedback/forum-style feature: messages, threaded answers, and likes on both, each with `updated_at` maintained by the shared `set_updated_at()` trigger function.
- `routes`, `lessons`, `quizess` — stub tables for a learning-path/lesson/quiz feature (name has a typo: "quizess"). **Superseded by the pending migration below — do not build on these.**

The learning-path model is fully defined in `database/migrations/1785451973139_routes-lessons-quizzes-schema.sql`, which is **written but NOT yet applied** (`pgmigrations` still shows only the two migrations above). It drops the three empty stubs and rebuilds them — renaming `quizess` → `quizzes` and replacing `routes.rankend` with `rating_avg`/`rating_count`:

- `routes` — created by a user (`user_id` → `users`), with title, description, image (defaults to a placeholder URL), `is_published`, plus denormalized `rating_avg`/`rating_count`/`enrollment_count`/`completion_count`.
- `lessons` — belong to a route, ordered by `position`, with `content_type` (`PARAGRAPH`/`SLIDES` enum). A `PARAGRAPH` lesson stores its text in `content` (enforced by a CHECK); a `SLIDES` lesson stores rows in `lesson_blocks` (`block_type` = `TEXT`/`IMAGE`/`VIDEO`, with a CHECK requiring `text` for TEXT and `url` for IMAGE/VIDEO).
- `quizzes` / `quiz_questions` / `quiz_options` — several quizzes per route, questions with an optional `image` URL, options with `is_correct`. A partial unique index (`WHERE is_correct`) guarantees at most one correct option per question.
- `route_ratings` (1–5, one per user per route) / `route_comments` — rating and flat comments on a route.
- `route_enrollments` / `lesson_completions` / `quiz_attempts` — raw progress events, the basis for personalized recommendations.
- `topics` / `route_topics` / `user_topic_preferences` — topic tagging plus the interests captured at onboarding, for the recommendation algorithm.
- Two trigger functions, `refresh_route_rating()` and `refresh_route_enrollment_stats()`, keep the `routes` counters in sync from `route_ratings` and `route_enrollments`.
- All `UNIQUE (parent, position)` constraints are `DEFERRABLE INITIALLY IMMEDIATE` so bulk reordering can `SET CONSTRAINTS ... DEFERRED` inside a transaction.

## Database migrations

`node-pg-migrate` is wired up via the `migrate` npm script, configured to use `database/migrations` and plain SQL files (`--migration-file-language sql`):

- **Create a new migration:** `npm run migrate create <name>` → generates `database/migrations/<timestamp>_<name>.sql` with empty `-- Up Migration` / `-- Down Migration` sections. Write the forward SQL under Up and its reverse (e.g. `DROP TABLE`/`DROP COLUMN`) under Down.
- **Apply pending migrations:** `npm run migrate up`
- **Roll back the most recent migration:** `npm run migrate down`
- **Preview without executing:** pass flags through with `--`, e.g. `npm run migrate -- up --dry-run`
- Applied migrations are tracked in the `pgmigrations` table inside the Supabase database itself — that's the source of truth for what has/hasn't run, not any local state.
- `DATABASE_URL` in `.env` must be the Supabase **Session pooler** string (see "Environment" above) for both the app and the migration CLI to connect successfully.

### Migration file gotchas

- **Every file needs a numeric prefix.** A file without one (e.g. `_my-migration.sql`) makes `node-pg-migrate` abort with `Cannot determine numeric prefix` on *every* command, not just that migration. Always generate with `npm run migrate create`.
- **The `-- Up Migration` marker is mandatory.** The CLI splits the file with `/^\s*--[\s-]*(up|down)\s+migration/im`. If the Up marker is missing, `upSql` silently becomes the **entire file** — so `migrate up` would run the Up *and then the Down*, wiping everything it just created and still recording the migration as applied. Anything written above the Up marker is discarded.
- `--dry-run` only prints the SQL; it does not execute it, so it catches neither syntax errors nor FK-ordering problems. To really validate a migration without applying it, run its Up/Down inside a transaction that ends in `ROLLBACK` (Postgres has transactional DDL).

### `updated_at` triggers

`set_updated_at()` is defined once in the initial schema, but Postgres triggers attach to a single table each. Instead of writing one `CREATE TRIGGER` per table, paste this at the end of the Up section of any migration that adds tables with an `updated_at` column — it is idempotent, so re-running it is safe:

```sql
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = 'public'
           AND c.relkind  = 'r'
           AND a.attname  = 'updated_at'
           AND NOT a.attisdropped
           AND NOT EXISTS (
               SELECT 1 FROM pg_trigger tg
                WHERE tg.tgrelid = c.oid
                  AND tg.tgname  = 'trg_' || c.relname || '_updated_at'
                  AND NOT tg.tgisinternal)
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    END LOOP;
END $$;
```

It attaches the trigger to *every* public table with an `updated_at` column, so a table that should not be auto-touched must not have that column.
