# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # nodemon src/server.js
npm start                # node src/server.js
npm run migrate up       # apply pending migrations
npm run migrate create <name>   # new SQL migration in database/migrations/
npm run migrate down     # roll back the last one
npm run migrate -- up --dry-run # print SQL without executing
```

**There is no test, lint, or build script** — no test framework is installed. Don't invent `npm test`; verify changes by running the server or by exercising SQL directly.

## Project state

A working Express 5 API. Implemented domains: `auth`, `feedback`, `uploads`, `routes`, `lessons`, `quizzes`, `progress`, `reviews`, `gamification`, `users`.

The creator side (`routes`/`lessons`/`quizzes`) and the learner side (`progress`/`reviews`) are deliberately separate domains: every function in the former starts with `assertRouteOwner`, every function in the latter with `assertRouteConsumable`.

`route_comments` is the one table still without code — comments were dropped from the product in favour of star ratings only.

`openai` and `@google/genai` are dependencies but **unused** — AI-generated lesson/quiz content is planned, not built. `express-rate-limit` is likewise a dependency that is never wired up, as is `requireRole` in `src/lib/middlewares/roles.js`.

## Architecture

**ES modules** (`"type": "module"` — always `import`/`export`). **Feature folders**: `src/<domain>/` holds one flat file per concern, `<domain>.<concern>.js`, never subfolders:

- `<domain>.route.js` — Express router; `<domain>.controllers.js` — req/res only; `<domain>.services.js` — business logic and transactions; `<domain>.queries.js` — raw SQL; `<domain>.schemas.js` — zod (note `feedback` and `quizzes` use the singular `.schema.js`).

**Raw `pg` only — no ORM or query builder.** This is a deliberate choice by the project owner, not a placeholder to upgrade. `database/connection.js` exports the `Pool` (`dbConnection`) and `withTransaction(fn)`, which BEGIN/COMMIT/ROLLBACKs and hands the callback a `client`.

### Request pipeline

`route → validate(schema[, source]) → asyncHandler(controller) → service → query`

- `validate(schema, 'body'|'params'|'query')` (`src/lib/validate.js`) **overwrites `req[source]`** with the parsed result, so zod `.default()`/`.coerce` values are what the controller sees. Params and query need their own `validate` call — see `routes.route.js`.
  - **It must use `Object.defineProperty`, not plain assignment.** In Express 5 `req.query` is a getter with no setter on the prototype, so `req.query = parsed` throws `Cannot set property query of #<Object> which has only a getter` — and because ES modules are strict mode it does not fail silently, it 500s the whole request. Every `validate(..., 'query')` route was broken by this until it was fixed.
- `asyncHandler` wraps every handler so rejections reach the error middleware. Controllers are plain `async (req, res)`.
- `errorHandler` (`src/lib/errorHandler.js`) is the single exit. **Errors are thrown as plain objects, `throw { code, message }`** — not `Error` subclasses. The `ERROR_STATUS` map in that file turns the `code` into an HTTP status; **a code missing from that map becomes a 500 and gets logged**, so adding a new domain error means adding its code there. `ZodError` → 400 with issue list; Postgres `23505` → 409.
- Services are wrapped in `withServiceError(fn, fallback)`: it logs, re-throws anything that already has a `code`, and replaces everything else with the fallback `{ code, message }`. That is why unexpected DB failures still surface a Spanish user-facing message.
- User-facing messages are in Spanish; code, identifiers and log event names are English (`'upload.presigned'`, `'deletion.drained'`).

### Two query-layer conventions

- **Newer modules** (`routes`, `lessons`, `quizzes`, `uploads`) take the `client`/pool as the **first argument**: `insertRoute(client, {...})`. This is what lets the service compose several queries in one `withTransaction`, and it is the convention to follow for new code.
- **Older modules** (`auth`, `feedback`, `users`) import `dbConnection` internally and take plain arguments; some `auth` queries accept an optional trailing `client`. Don't refactor these unprompted, but don't copy the pattern either.

Queries return snake_case rows; services map them to camelCase in `format*` helpers before responding.

### Auth

Passport with four strategies registered by `passportInit()` in `src/auth/auth.strategys.js` (called from `app.js`): `jwt`, `jwt-refresh`, `local`, `google`.

- **Tokens live in cookies, not the `Authorization` header.** Both JWT strategies extract from `req.cookies['access-token']` / `['refresh-token']`. `setTokenCookies` sets them `httpOnly`, `sameSite: 'lax'`, `secure` only in production. A client therefore needs `credentials: 'include'`, which is why CORS is `{ origin: process.env.CLIENT_URL, credentials: true }` — the `*` wildcard cannot work here.
- `requireAuth` / `requireRefresh` (`src/lib/middlewares/auth.js`) set `req.user` to the **JWT payload**, not a DB row: `{ userId, email, role }`. Services read `user.userId`, never `user.id`.
- Refresh tokens rotate on every `/auth/refresh` and are stored in `refresh_tokens`. `rotateRefreshToken` keeps a **60 s grace window** (`REFRESH_ROTATION_GRACE_MS`): a second tab refreshing with a just-rotated token gets the current token back instead of having its session killed. A token belonging to another user triggers deletion of all that user's tokens.
- Local registration is two-step: `POST /auth/register` returns `{ requiresVerification: true }` and emails a 6-digit bcrypt-hashed code (15 min TTL, `src/lib/mailer.js` over SMTP); `POST /auth/verify` marks the email verified, invalidates the codes and issues tokens — all three in one transaction.
- Registering with an email that already has a Google-only account **attaches local credentials to it** rather than erroring; login requires `email_verified`.

### Router mounting quirk

`app.js` mounts `authRouter`, `feedbackRouter`, `uploadsRouter`, `routesRouter`, `usersRouter` under prefixes, but `lessonsRouter`, `quizzesRouter`, `progressRouter`, `reviewsRouter` and `gamificationRouter` are mounted at the **root** because they declare full paths in several shapes: `/routes/:routeId/lessons` for creation, `/lessons/:id` for edits, `/quizzes/:id/attempts` and `/routes/:id/progress` for the learner side, `/users/:userId/stats` and `/ranking` for gamification. They must stay after `routesRouter`. Every router except `auth` starts with `router.use(requireAuth)`.

`usersRouter` (`/users/me`, `/users/me/timezone`) and `gamificationRouter` (`/users/:userId/stats`, `/users/:userId/activity`) both live under `/users` without colliding — the paths differ in depth. `gamificationRouter` accepts the literal `me` in place of a uuid, resolved to `req.user.userId` in the controller, because the tokens are `httpOnly` cookies and a client cannot read its own id.

## The creator flow (routes → lessons → quizzes)

A route is authored in two steps: the route itself (title, description, cover, topics), then its content. These modules implement **authoring only**.

**`routes.is_published` is an enum** (`routes_published_status`: `'PUBLIC'`/`'PRIVATE'`), not a boolean, defaulting to `PRIVATE` — routes are born private. `setRouteVisibility` refuses to publish a route with zero lessons (`ROUTE_EMPTY`), and `getRoute` hides a non-`PUBLIC` route from anyone but its author or an admin by returning `ROUTE_NOT_FOUND`.

**Ordering is the non-obvious part.** `lessons.position` orders lessons within a route; a quiz has no route-level sequence — it hangs off a lesson via `quizzes.after_lesson_id` and appears right after it. `after_lesson_id IS NULL` means "at the end of the route" (final exam). `getRouteOutline()` in `routes.queries.js` produces the interleaved list with a `UNION ALL`, using `sub_pos = 0` for lessons so a lesson always precedes its own quizzes. Consequence: **a quiz cannot be placed before the first lesson.**

`uq_quizzes_slot` is deliberately `UNIQUE (route_id, after_lesson_id, position)` with default NULL semantics, *not* `NULLS NOT DISTINCT`. With NULLs treated as equal, the `ON DELETE SET NULL` on `after_lesson_id` could collide with an existing end-of-route quiz and make **deleting a lesson fail**. Ordering among several final quizzes is tie-broken by `created_at`. `updateQuiz` recomputes `position` via `nextQuizPosition` whenever the slot changes, for the same reason.

**Nested payloads.** A lesson arrives with its `blocks`, a quiz with its `questions` and `options`, each in one request and one transaction. Editing is a `PUT` that replaces the children wholesale. Child `position` comes from array order, so a client can never send duplicate or gapped positions.

**Authorization always starts from `findRouteForOwner()`** in `routes.queries.js` — lessons and quizzes both import it rather than re-implementing the `(user_id = $2 OR $3 = TRUE)` check, via their local `assertRouteOwner`. A quiz's `afterLessonId` is additionally validated to belong to the same route (`assertLessonSlot`), or it could be attached to another user's lesson.

`reorderLessons` requires the id list to be an exact permutation of the route's lessons, then uses `SET CONSTRAINTS uq_lessons_route_position DEFERRED` inside the transaction — that is what the `DEFERRABLE` declaration in the schema is for. Without it a bulk position swap aborts mid-statement.

## The learner flow and gamification

`src/progress/` is the consumer side: `POST /lessons/:id/complete` (idempotent, `ON CONFLICT DO NOTHING` — a double tap must not become a 409 via the global `23505` mapping), `POST /quizzes/:id/attempts`, `GET /routes/:id/progress`. `src/reviews/` holds the 1–5 star rating of a route, on top of the pre-existing `route_ratings` table and its `refresh_route_rating()` trigger.

**Authorization on the learner side goes through `findRouteForConsumer()`** in `routes.queries.js` — the mirror of `findRouteForOwner`: `WHERE id = $1 AND (is_published = 'PUBLIC' OR user_id = $2 OR $3 = TRUE)`. It returns `user_id` so callers get the "no XP for your own content" check for free. `findLessonWithRoute` and `findQuizWithRoute` also select `r.is_published`, so lesson→route resolution and authorization happen in one query.

**`getQuiz` serves two different question shapes.** `getQuizQuestions` includes `is_correct`; `getQuizQuestionsForTaking` omits it and is what any non-owner receives. It is a separate query rather than a JS filter so the answer key never leaves the database for a learner — it cannot leak through a log line or a forgotten field.

### XP, streaks and leagues (`src/gamification/`)

**`recordActivity(client, {...})` is the single entry point, and it takes a `client`** so XP is atomic with the action that earned it — a deliberate exception to "only the query layer takes a client". Two rules that are load-bearing:

- **It must be the last statement of the transaction.** Then every path takes `routes` before `user_stats`, and the creator path cannot deadlock with the learner path.
- **It is not wrapped in `withServiceError`.** That helper re-throws anything with a `code`, so the transaction aborts either way, but the client would be told "error registering activity" when what actually failed was creating the route.

**Only completions grant XP** (`LESSON_COMPLETED`, `QUIZ_COMPLETED`, `ROUTE_COMPLETED`); creation events are recorded with `xp = 0` so they still paint the heatmap and keep the streak alive. That is what makes a daily XP cap unnecessary — a cap would punish a new user trying to catch up in a weekend. XP is additionally zeroed when the subject was already paid for (`uq_activity_events_xp_once`) or when the content belongs to the user.

**League comes from lifetime XP and its multiplier decreases** (Bronce ×1.00 → Diamante ×0.40), so each league costs more than the last without any artificial ceiling. It is derived in the service, never stored, so rebalancing `LEAGUES` needs no migration. There is no relegation: lifetime XP only goes up.

**Cohorts are assigned lazily, never by a cron.** On the first XP-earning event of the month the user joins an open cohort of their league (`member_count < 30`, `FOR UPDATE SKIP LOCKED`) or opens a new one. Cohort size is adaptive by construction: with 12 users in Bronce there is one cohort of 12, with 400 there are 14. The season key is `'YYYY-MM'` **in UTC** — a competition has to start and end at the same instant for everyone — while `activity_date` is computed in `users.timezone`, so the heatmap and the season boundary can disagree by a day at the edges. That is intentional.

**Every `DATE` is read as TEXT via `to_char(..., 'YYYY-MM-DD')`.** `pg` parses `DATE` into a JS `Date` at server-local midnight, which `JSON.stringify` then shifts a day backwards for negative-offset timezones — the classic "the heatmap is off by one" bug.

## Uploads / S3

`src/uploads/` handles all binary content (route covers, lesson slide images/videos, quiz question images). The file never passes through Express — the client uploads straight to S3 with a presigned URL.

1. `POST /uploads/sign` with `{ scope, contentType, size }` → `{ url, key, expiresIn }` (5 min).
2. Client `PUT`s the exact bytes it declared to `url`.
3. The domain service calls `verifyUpload(user, key, scope)` **before** the `INSERT`, then stores the `key`. `verifyUpload` hits S3 (`HeadObject`), so services call it **outside** `withTransaction` to keep the lock short.

**The DB stores the key, never the URL.** A URL embeds bucket, region and domain — infra config duplicated across every row of `routes.image`, `lesson_blocks.url` and `quiz_questions.image`. The key (`uploads/<scope>/<userId>/<uuid>.<ext>`) is the canonical id; URLs are derived at read time with `urlOfReading(key, kind)`. Moving to CloudFront later means editing one function, not migrating three tables. Authorization is the key prefix itself (`assertOwnedKey`).

**`UPLOAD_SCOPES`** in `uploads.services.js` is the policy table — each destination declares which kinds it accepts (`route-cover`, `lesson-block`, `quiz-question`, `avatar`). Adding a destination is one line there; `uploads.schemas.js` derives its `z.enum` from it so the two cannot drift. Limits: images 10 MB (`jpeg`/`png`/`webp`), video 200 MB (`mp4`/`webm`/`quicktime`). Read TTLs differ: 1 h for images, 6 h for video, because a 200 MB download on a slow line can outlive a short URL and break playback mid-stream.

### Deleting attachments (the cascade problem)

Nothing deletes S3 objects directly. **Everything goes through the `pending_deletions` queue.** S3 and Postgres cannot share a transaction, so "delete the row and delete the object" is never atomic — the DB is the source of truth and S3 cleanup happens after.

Keys are enqueued **inside the same transaction** as the `DELETE`, which is what makes it safe: either the row is deleted and its keys are queued, or neither happens. After committing, services call a fire-and-forget `drainInBackground()`; whatever fails stays queued.

**The trap this exists to solve:** `routes → lessons → lesson_blocks` and `routes → quizzes → quiz_questions` all cascade. A `DELETE FROM routes` silently removes every row holding a key. **`collectRouteAttachmentKeys()` must run *before* the `DELETE`** — afterwards those keys are unrecoverable. Any new domain that stores keys must follow: collect → delete → enqueue, all in one `withTransaction`.

`drainPendingDeletions()` claims a batch with `FOR UPDATE SKIP LOCKED` (so several server instances can drain concurrently) and deletes via `DeleteObjectsCommand`. Failures increment `attempts` and record `last_error`; rows are abandoned after 5 tries. `DeleteObject` is idempotent in S3, so retrying an already-gone key succeeds rather than jamming the queue. `startDeletionWorker()` in `uploads.worker.js` re-drains on an interval (`timer.unref()` so it never keeps the process alive), started from `server.js`.

**Replacing an attachment: use `orphanKeys(previous, next)`**, never "enqueue all the old ones". In a `PUT` the user typically keeps some attachments; enqueueing those would delete an object the row still points at. It also strips external links.

**Gotchas:**

- **`ContentLength` is passed to `PutObjectCommand` on purpose.** It makes `content-length` a *signed* header, so S3 itself rejects a PUT whose byte count differs from what was declared. Remove it and the size limit becomes an honour system.
- **`requestChecksumCalculation: 'WHEN_REQUIRED'` on the S3 client is load-bearing.** By default the SDK appends `x-amz-checksum-crc32` to the presigned URL, computed over an empty body (`AAAAAA==`) because at signing time there is no content. S3 validates it against what is actually uploaded, so **every non-empty upload fails** — in a way that looks like a signature bug.
- **`urlOfReading` rounds `signingDate`** to half the TTL. Without it every call returns a different query string and the browser re-downloads the file on every page load.
- **Never log the signed URL.** It contains `X-Amz-Signature`, a write capability on the bucket. Log the `key`.
- **`users.image` and `lesson_blocks.url` are mixed columns:** a Google avatar URL or a pasted YouTube link, or an S3 key. **Filter with `isStorageKey()` before enqueueing a delete**; `urlOfReading` returns anything starting with `http` untouched.
- **`lib/s3.js` passes credentials explicitly** via `requireEnv`, so a missing var fails at boot rather than on a user's first upload. It does *not* import `dotenv/config` — `server.js` loads it first. Any standalone script importing `s3.js` directly must run with `node --env-file=.env`.
- **The IAM user needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject`** on `arn:aws:s3:::<bucket>/*`. Without them every operation returns a `403 AccessDenied` indistinguishable from a signature problem — check the `<Code>` in the XML body. `DeleteObjects` reports this *per key* inside `result.Errors` rather than throwing, so the queue records a failed attempt instead of blowing up.

## Environment

Config comes from a gitignored `.env` at the repo root, loaded by `dotenv` in `server.js` / `connection.js` / `auth.strategys.js`. `requireEnv(name)` (`src/lib/env.js`) throws at boot for anything mandatory.

`DATABASE_URL`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, `CLIENT_URL`, `JWT_ACCESS_SIGNATURE`, `JWT_REFRESH_SIGNATURE`, `JWT_ACCESS_EXPIRES` (default `15m`), `JWT_REFRESH_EXPIRES` (default `7d`), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`, `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_BUCKET`.

JWT expiry strings are parsed by a local `durationToMs` regex accepting only `<number><s|m|h|d>` — anything else silently falls back to the default cookie `maxAge` while `jsonwebtoken` still honours the raw value, so keep the format.

**Database is Supabase — use the Session pooler connection string, not "Direct connection".** The direct host (`db.<ref>.supabase.co`) is IPv6-only and fails with `ENOTFOUND` on networks without IPv6 routing. The Session pooler (`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<project-ref>`) is IPv4-compatible and behaves like a normal session, which both the app `Pool` and `node-pg-migrate` need — the latter takes session-level advisory locks, which the Transaction pooler on port 6543 does not reliably support. **If the password contains `@` it must be percent-encoded (`%40`)** or URL parsing breaks at the wrong `@`.

## Deployment

`Dockerfile` (node:24-alpine, `npm start`) + `docker-compose.yml` (single `api` service, host `3001` → container `3000`, `env_file: .env`). `.github/workflows/deploy.yml` triggers on push to **`main`** and SSHes into the VPS to `git reset --hard origin/main`, `docker compose build`, **`docker compose run --rm api npm run migrate up`**, then `up -d` — so **a merged migration is applied automatically on deploy**. Concurrency group `deploy-vps` with `cancel-in-progress: false` so a deploy is never aborted mid-migration. `app.set('trust proxy', 1)` is set for the reverse proxy in front of the container.

## Database schema and migrations

`node-pg-migrate` with plain SQL files in `database/migrations/`. **Applied migrations are tracked in the `pgmigrations` table in Supabase — that is the source of truth, not local files.** Check it before assuming a migration ran.

Migrations in order:

1. `1785436594889_initial-schema.sql` — `users` (id UUID, email, email_verified, name, password nullable for OAuth-only, image, `role` `USER`/`ADMIN`), `accounts` (provider `LOCAL`/`GOOGLE`), `refresh_tokens`, `verification_codes`, `feedback_messages`/`feedback_answers` + their `_likes` tables, the shared `set_updated_at()` trigger function, and three stub tables (`routes`, `lessons`, `quizess` — sic) later dropped.
2. `1785441967815_drop-accounts-provider-account-id.sql` — **`accounts` no longer has `provider_account_id`**; a user has at most one account per provider.
3. `1785451973139_routes-lessons-quizzes-schema.sql` — drops the stubs and builds the real model: `routes` (with denormalized `rating_avg`/`rating_count`/`enrollment_count`/`completion_count`), `lessons` (`content_type` `PARAGRAPH`/`SLIDES`; a CHECK forces `content` for PARAGRAPH), `lesson_blocks` (`TEXT`/`IMAGE`/`VIDEO`, CHECK requiring `text` or `url` accordingly), `quizzes`/`quiz_questions`/`quiz_options` (a partial unique index `WHERE is_correct` allows at most one correct option per question), `route_ratings`/`route_comments`, `route_enrollments`/`lesson_completions`/`quiz_attempts`, `topics`/`route_topics`/`user_topic_preferences`, plus `refresh_route_rating()` and `refresh_route_enrollment_stats()` triggers that keep the `routes` counters in sync. All `UNIQUE (parent, position)` constraints are `DEFERRABLE INITIALLY IMMEDIATE` for bulk reordering.
4. `1785455401465_routes-image-optional-and-private-default.sql` — `is_published` defaults to `PRIVATE`; `image` becomes nullable and loses its placeholder default (the front decides what to show).
5. `1785602157806_pending-deletions-queue.sql` — the S3 deletion queue.
6. `1785612187262_quizzes-after-lesson-order.sql` — `quizzes.after_lesson_id` replaces the route-level quiz sequence (see "The creator flow").
7. `1785612189392_seed-initial-topics.sql` — 8 starter categories.
8. `1785642892476_gamification-xp-streaks-leagues.sql` — `users.timezone`; `activity_events` (the append-only ledger behind the heatmap, XP and ranking); `user_stats`; `ranking_cohorts`/`ranking_members`; the `next_streak()` SQL function. `activity_events.event_type` is **`TEXT`, not an enum**, because `ALTER TYPE ... ADD VALUE` cannot be *used* in the same transaction and node-pg-migrate wraps each migration in one — the valid list is `XP_RULES` in the service. `activity_events.subject_id` has **no FK** so deleting a route does not rewrite anyone's history, and is `NOT NULL` because a nullable one would make the dedupe predicate `NULL = NULL` and grant infinite XP.
9. `1785643500000_quiz-attempt-answers.sql` — the per-question detail of an attempt. **No FK to `quiz_questions`/`quiz_options`, and the text is copied in**, because `updateQuiz` deletes and reinserts the whole question tree on every `PUT`: with FKs, the first typo fix would silently wipe the answers of every past attempt.

### Migration file gotchas

- **Every file needs a numeric prefix.** A file without one (e.g. `_my-migration.sql`) makes `node-pg-migrate` abort with `Cannot determine numeric prefix` on *every* command. Always generate with `npm run migrate create`.
- **The `-- Up Migration` marker is mandatory.** The CLI splits on `/^\s*--[\s-]*(up|down)\s+migration/im`. Without the Up marker, `upSql` silently becomes the **entire file** — `migrate up` runs the Up *and then the Down*, wiping what it just created while still recording the migration as applied. Anything above the Up marker is discarded.
- Write a real Down section; the deploy pipeline gives no chance to fix a migration by hand.
- `--dry-run` only prints SQL — it catches neither syntax errors nor FK-ordering problems. To really validate, run Up/Down inside a transaction ending in `ROLLBACK` (Postgres has transactional DDL).

### `updated_at` triggers

`set_updated_at()` is defined once in the initial schema, but Postgres triggers attach to a single table each. Paste this at the end of the Up section of any migration adding tables with an `updated_at` column — it is idempotent:

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

## Logging

`pino` via `src/lib/logger.js`, wired as `app.use(pinoHttp({ logger }))` — first middleware, so it also covers CORS rejections. It redacts `req.headers.cookie`, `req.headers.authorization` and `res.headers['set-cookie']`, which matters because the auth tokens live in cookies. `pino-pretty` transport outside production. Per-module loggers use `logger.child({ module: '<name>' })`.
