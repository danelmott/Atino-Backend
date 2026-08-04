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

A working Express 5 API. Implemented domains: `auth`, `feedback`, `uploads`, `routes`, `lessons`, `quizzes`, `progress`, `reviews`, `gamification`, `users`, `feed`, `follows`.

`src/AtinoIA/`, `src/payment/` and `src/webhooks/` are **empty placeholder directories** — no files, nothing mounted, no dependencies installed for them. Don't infer a payments or AI integration from their names.

The creator side (`routes`/`lessons`/`quizzes`) and the learner side (`progress`/`reviews`) are deliberately separate domains: every function in the former starts with `assertRouteOwner`, every function in the latter with `assertRouteConsumable`.

`route_comments` is the one table still without code — comments were dropped from the product in favour of star ratings only.

`openai` and `@google/genai` are dependencies but **unused** — AI-generated lesson/quiz content is planned, not built. `express-rate-limit` is likewise a dependency that is never wired up. `requireRole` (`src/lib/middlewares/roles.js`) is used on exactly one route, `PATCH /users/:userId/verified`.

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
  - `requireRole` (`src/lib/middlewares/roles.js`) is wired into exactly one route: `PATCH /users/:userId/verified`. It reads `req.user.role` from the JWT payload and throws `ACCESS_DENIED` (403).
- **Only `23505` is mapped — `23503` (foreign key violation) is not.** So a bad FK target surfaces as a 500, not a 404. That is why services validate a referenced row exists *before* the insert/update rather than letting the constraint fire: `createRoute`/`updateRoute` call `findTopicById` first, `setMyTopics` calls `countExistingTopics`. Follow that pattern for any new FK a client can supply.
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

`app.js` mounts `authRouter`, `feedbackRouter`, `uploadsRouter`, `routesRouter`, `usersRouter` under prefixes, but `feedRouter`, `lessonsRouter`, `quizzesRouter`, `progressRouter`, `reviewsRouter` and `gamificationRouter` are mounted at the **root** because they declare full paths in several shapes: `/routes/:routeId/lessons` for creation, `/lessons/:id` for edits, `/quizzes/:id/attempts` and `/routes/:id/progress` for the learner side, `/users/:userId/stats` and `/ranking` for gamification. They must stay after `routesRouter`. Every router except `auth` starts with `router.use(requireAuth)`.

**Consequence of root-mounting: an unknown URL answers `401`, not `404`.** A root-mounted router's `router.use(requireAuth)` has no path to scope it, so it runs for *every* request that reaches that `app.use`. `feedRouter` is mounted before `/routes` and `/users`, so anything not handled by `auth`, `feedback` or `uploads` — including a plain typo like `/zzz` — hits its `requireAuth` first and comes back `{ code: 'UNAUTHORIZED' }`. Verified against the running server. Two things follow: `requireAuth` runs more than once per request on most paths (harmless, it just re-verifies the same JWT), and **a client cannot tell a wrong URL from a dead session** — the front's fetcher will burn a refresh and report `SESSION_EXPIRED` for what is really a 404. Adding a `404` handler before `errorHandler` would not help by itself; the fix would be scoping each root-mounted router's `requireAuth` onto its own paths.

**`feedRouter` is the one exception to "after `routesRouter`" — it is mounted *before* it.** It declares the literal `/routes/feed`, and `routesRouter` has `get('/:id')` guarded by `validate(idParamSchema, 'params')`; mounted afterwards, `/routes/feed` would match `/:id`, fail the uuid check and return `400 Identificador invalido` instead of the feed. It is the same reason `routesRouter` declares `/topics` above its own `/:id`. Any future root-mounted router declaring a literal segment under `/routes` needs the same placement.

Three routers share `/users` without colliding, and the order they are declared in is what keeps them apart:

- `usersRouter` (mounted at `/users`, first) — `/me`, `/me/timezone`, `/me/topics`, then `/:userId` and `/:userId/routes`. **The `/me` routes must stay above `/:userId`**, exactly like `routesRouter` declares `/topics` above `/:id`: reversed, `/users/me` would enter the public-profile handler, fail the uuid check and 400 instead of returning the caller's own profile.
- `gamificationRouter` (root) — `/users/:userId/stats`, `/users/:userId/activity`.
- `followsRouter` (root) — `/users/:userId/follow`, `/users/:userId/followers`, `/users/:userId/following`.

The two root-mounted ones never reach `usersRouter`'s `/:userId` because that pattern matches a single segment. `gamificationRouter` accepts the literal `me` in place of a uuid, resolved to `req.user.userId` in the controller, because the tokens are `httpOnly` cookies and a client cannot read its own id; `followsRouter` does the same. `usersRouter`'s `/:userId` deliberately does **not** accept `me` — the literal route above already handles it, and it returns the full private profile rather than the public one. `gamificationRouter` accepts the literal `me` in place of a uuid, resolved to `req.user.userId` in the controller, because the tokens are `httpOnly` cookies and a client cannot read its own id.

## The creator flow (routes → lessons → quizzes)

A route is authored in two steps: the route itself (title, description, cover, subject), then its content. These modules implement **authoring only**.

**A route has exactly one subject, not a list of topics.** The `route_topics` join table was dropped; `routes.topic_id` is `NOT NULL` with `ON DELETE RESTRICT` — deleting a catalog topic that routes use must fail rather than orphan them. `createRouteSchema.topicId` is required (a route with no subject could never enter the feed), `updateRouteSchema.topicId` is optional. Responses carry a single `topic: { id, slug, name }` object, never a `topics` array. `INSERT`/`UPDATE` can't `JOIN`, so their `RETURNING` yields only `topic_id` and the service fills the rest via `withTopicColumns`; list queries join `topics` directly.

**The catalog is exactly fourteen subjects, flat** (migration 16): `matematicas`, `biologia`, `quimica`, `fisica`, `historia`, `ciencias-sociales`, `lengua-literatura`, `idiomas`, `filosofia`, `arte`, `musica`, `programacion`, `ingenieria`, `economia`. It used to be ~95 rows grouped by a `discipline` column; both the extra rows and the column are gone — the fourteen are distinct subjects and none is a sub-subject of another. **The slug is the contract**, because the frontend resolves a subject's banner, icon and card tint from it (`CATEGORY_LABELS`/`CATEGORY_ICONS`/`--subject-<key>`), and an unknown slug renders with none of the three and no error. Adding a subject means adding it on both sides.

`topics.name` carries accents (`Matemáticas`, `Biología`) so a client can paint it directly; the slug never does. The wildcard `otros` was deleted with the rest: `createRouteSchema.topicId` is required, so nothing needs a fallback. **Migration 11 still depends on `otros` existing** for its backfill — it runs before 16, so a rebuild from scratch is fine, but do not remove it from migration 10.

`listTopics` orders by `name`. The curated order `/explore` uses for its grid (sciences → humanities → applied) lives in the frontend, not here.

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

## The feed and onboarding

`GET /routes/feed` (`src/feed/`) is the recommendation list — the consumer counterpart to `routesRouter`, which is authoring only.

**The scoring is one SQL query, not several queries merged in JS.** The result has to be paginated *after* ordering, so scoring in Node would mean pulling every public route on every request just to apply `LIMIT/OFFSET` at the end. The weights are passed as bind parameters (`$4`+) rather than inlined, so rebalancing the feed means editing `FEED_WEIGHTS` in `feed.services.js` and nothing else — no SQL edit, no migration. `FEED_WEIGHTS` is a policy table in the same spirit as `XP_RULES` and `UPLOAD_SCOPES`.

Six terms: `preference` (5.0, the route's subject is one the user picked at onboarding) > `following` (4.0, the user follows the author) > `affinity` (3.0, the user has already enrolled in routes of that subject) > `quality` (1.5) > `freshness` (1.0) > `enrolled` (**-2.0**, negative). Relative magnitude matters more than the exact values: declared preference outranks following, which outranks inferred affinity. `following` sits below `preference` because the whole catalog is organized by subject, but above `affinity` because following someone is a *declared* signal rather than an inferred one. There was a seventh, `discipline` (2.0, same discipline different subject); it went with the column in migration 16. **The weights are positional bind parameters, so removing or adding one means renumbering every `$n` after it** — a mistake there produces a silently wrong ranking, not an error.

- **Quality is bayesian-damped** by `rating_count / (rating_count + 5)`. Without it a single 5-star route outranks one with fifty 4.5s.
- **Affinity is normalized against 5 and clamped to 1.0**, so a user with 40 routes in one subject can't flatten every other signal and get shown the same thing forever.
- **Freshness is exponential decay** with a ~30-day half-life (`exp(-age_seconds / 2592000)`).
- **Already-enrolled routes score lower but are not excluded** — they still appear, and `started` is returned so the client can render "continuar" instead of "empezar". *Completed* routes are excluded outright, as are the user's own (same principle as "no XP for your own content").
- **Cold start needs no special branch.** A user with no preferences, no history and no follows simply zeroes the first four terms, leaving quality + freshness — which is exactly the right thing to show someone you know nothing about.

The `followed` CTE does double duty: it feeds the scoring term *and* produces `author.isFollowing` on the card, so the client can render a follow button on a feed item without a second request. Feed cards carry `author: { id, name, isFollowing }` — the `id` is what lets the front link to the author's profile.

### Onboarding (`users`)

`user_topic_preferences` is what feeds the `preference` term. `PUT /users/me/topics` — **`PUT`, not `POST`**, because it is a full idempotent replacement, so the same endpoint serves both the initial onboarding screen and later edits from settings. Limits live in `TOPIC_SELECTION` (`{ min: 1, max: 5 }`) in `users.services.js`, and `users.schemas.js` imports it so the two cannot drift.

- **Ids are deduplicated before being counted** against `countExistingTopics`. `[a, a, b]` has three elements but two topics; comparing 2 against 3 would reject a valid request.
- **`users.onboarding_completed_at` is a nullable timestamp, not a boolean.** NULL means "hasn't done it"; the timestamp also answers how many users complete onboarding without another migration. `markOnboardingCompleted` uses `COALESCE(onboarding_completed_at, now())` so re-editing interests from settings never rewrites the original date.
- `GET /users/me` returns `topics`, `onboardingCompleted` and `onboardingCompletedAt` alongside the gamification stats. `PATCH /users/me` updates the display name only.

**`PUT /users/me/onboarding` (`{ name, topicIds }`) is the sign-up step, and the only thing that ever sets `onboarding_completed_at`.** It exists because `POST /auth/register` takes email and password only, so `createLocalUser` inserts a row with **`name` NULL** — and the client draws its avatar from the initials of the name, so those users had neither name nor avatar. Name and interests go in one transaction because the modal collects them together and half of it is useless. `PUT /users/me/topics` deliberately **no longer marks onboarding**: if editing interests from settings still marked it, a user with no name would complete onboarding through the back door.

### Follows (`src/follows/`)

The social graph: `POST`/`DELETE`/`GET /users/:userId/follow`, plus paginated `/users/:userId/followers` and `/users/:userId/following`.

- **Both writes are idempotent.** `insertFollow` uses `ON CONFLICT DO NOTHING` — without it a double tap becomes a 409 through the global `23505` mapping, the same trap `lesson_completions` already had. `unfollowUser` returns 200 with the current state when there was nothing to delete; this deliberately departs from `removeRouteRating`, which throws `RATING_NOT_FOUND`, because unfollow is an easy button to double-click and a 404 there is just an error the client has to learn to ignore.
- **Self-follow is checked twice**: `CANNOT_FOLLOW_SELF` (403) in the service for a readable message, and `chk_user_follows_not_self` in the database as the backstop. A raw `23514` would be a 500.
- **The target user's existence is checked before inserting**, because `23503` is not in `ERROR_STATUS` and an FK violation would surface as a 500 instead of a 404.
- **Following grants nothing.** It does not call `recordActivity`, so it never reaches `activity_events`, never paints the heatmap and never keeps a streak alive. The 0-XP events exist for actions that are real work (authoring, publishing); following is one click, and if it counted, anyone could keep a streak alive by following strangers and the streak would stop meaning "I learned something".
- The list queries carry a `LEFT JOIN user_follows` against the *viewer* so every row knows whether the viewer already follows that person — the follow button in a list renders without N extra requests.
- Counters are never written from JS: `users.followers_count`/`following_count` belong to the trigger, and the services read them back after the write. The trigger keeps them **by delta, not by recount** — see migration 15; changing it back to `COUNT(*)` reintroduces a lost update under concurrent follows.

**`verified` travels with every rendered user.** `users.is_verified` surfaces as `verified` in `/users/me`, the public profile, follower/following rows, gamification stats and ranking, feed cards (`author.verified`) and route cards/detail. Adding a new response that renders a user means selecting `is_verified` too, or the badge silently disappears in that one screen. `PATCH /users/:userId/verified` takes `{ verified: boolean }` — a state, not a toggle, so the same endpoint grants and revokes and an admin panel never has to know the current value.

`GET /users/:userId` is the public profile (`users` module, not `follows` — it is a user, not a relationship). It has its **own formatter, `formatPublicProfile`, rather than `formatProfile` with fields deleted**: the list of what is exposed has to be readable at a glance, so that adding a sensitive column to `findUserProfile` later cannot leak through here. It returns `followersCount`, `followingCount`, `isFollowing`, `followsYou` and the gamification stats, and never `email`, `role`, `timezone` or `onboardingCompletedAt`. The author's public routes are a separate paginated endpoint, `GET /users/:userId/routes`, backed by `listPublicRoutesByUser` — `listRoutesByUser` is the author's own "my routes" and returns `PRIVATE` ones too.

## Shapes the client depends on

Reconciling the API against the frontend contract left four rules that are easy to undo by accident:

- **`total` always travels with `done`.** `GET /users/me/progress` (`src/progress/`) emits `done`, `total`, `percent` and `completed` per enrolled route. The client used to derive the denominator from the route's quiz count, but **`done` counts completed lessons *plus* passed quizzes** — `listUserProgress` and `getRouteProgress` share the same two `EXISTS` predicates, which is what keeps the list and the per-route detail from disagreeing. A route of ten lessons and two quizzes was rendering as finished on the second lesson.
- **`completed` comes from `route_enrollments.completed_at`, never from `done === total`.** They diverge as soon as an author adds a lesson to a route somebody already finished: the enrollment stays completed and the XP is already paid, while items remain undone.
- **XP is two different currencies.** `/ranking/global` and `/users/:userId/stats` emit `xp` (lifetime, the number that decides the league); the cohort listing at `/ranking` emits **`seasonXp`** and takes its league from the frozen `ranking_members.league`, *not* from `formatLeague(seasonXp)` — with the month's XP, everyone would read as Bronce on the 1st.
- **Everything that opens a session returns the `/users/me` shape.** `login`, `verify` and the no-verification branch of `register` all go through `sessionUser` in `auth.controllers.js`. Login used to return the raw JWT payload (`userId`, `email`, `role`), which carries neither the name nor the image — the only two fields the client paints on entry.

`GET /users/:userId` is also the one route that deliberately **skips `validate(..., 'params')`**: a malformed id is a profile that does not exist, so `getPublicProfile` checks the uuid shape itself and throws `USER_NOT_FOUND` (404). Zod would answer 400 and the client's `notFound()` would never fire.

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
3. `1785451973139_routes-lessons-quizzes-schema.sql` — drops the stubs and builds the real model: `routes` (with denormalized `rating_avg`/`rating_count`/`enrollment_count`/`completion_count`), `lessons` (`content_type` `PARAGRAPH`/`SLIDES`; a CHECK forces `content` for PARAGRAPH), `lesson_blocks` (`TEXT`/`IMAGE`/`VIDEO`, CHECK requiring `text` or `url` accordingly), `quizzes`/`quiz_questions`/`quiz_options` (a partial unique index `WHERE is_correct` allows at most one correct option per question), `route_ratings`/`route_comments`, `route_enrollments`/`lesson_completions`/`quiz_attempts`, `topics`/`route_topics` (dropped in 11)/`user_topic_preferences`, plus `refresh_route_rating()` and `refresh_route_enrollment_stats()` triggers that keep the `routes` counters in sync. All `UNIQUE (parent, position)` constraints are `DEFERRABLE INITIALLY IMMEDIATE` for bulk reordering.
4. `1785455401465_routes-image-optional-and-private-default.sql` — `is_published` defaults to `PRIVATE`; `image` becomes nullable and loses its placeholder default (the front decides what to show).
5. `1785602157806_pending-deletions-queue.sql` — the S3 deletion queue.
6. `1785612187262_quizzes-after-lesson-order.sql` — `quizzes.after_lesson_id` replaces the route-level quiz sequence (see "The creator flow").
7. `1785612189392_seed-initial-topics.sql` — 8 starter categories.
8. `1785642892476_gamification-xp-streaks-leagues.sql` — `users.timezone`; `activity_events` (the append-only ledger behind the heatmap, XP and ranking); `user_stats`; `ranking_cohorts`/`ranking_members`; the `next_streak()` SQL function. `activity_events.event_type` is **`TEXT`, not an enum**, because `ALTER TYPE ... ADD VALUE` cannot be *used* in the same transaction and node-pg-migrate wraps each migration in one — the valid list is `XP_RULES` in the service. `activity_events.subject_id` has **no FK** so deleting a route does not rewrite anyone's history, and is `NOT NULL` because a nullable one would make the dedupe predicate `NULL = NULL` and grant infinite XP.
9. `1785643500000_quiz-attempt-answers.sql` — the per-question detail of an attempt. **No FK to `quiz_questions`/`quiz_options`, and the text is copied in**, because `updateQuiz` deletes and reinserts the whole question tree on every `PUT`: with FKs, the first typo fix would silently wipe the answers of every past attempt.
10. `1785687942404_topics-disciplines-and-catalog.sql` — `topics.discipline` (added nullable, backfilled, *then* `SET NOT NULL`) and the ~90-topic catalog, inserted `ON CONFLICT (slug) DO NOTHING`. Its Down deletes every topic outside the original 8 — including any added by hand afterwards. **Migration 16 undoes most of this**, but do not edit it: 11 still backfills against the `otros` it creates.
11. `1785687944534_routes-single-subject.sql` — `routes.topic_id` replaces `route_topics`. **Step order is the whole migration:** add nullable → collapse multi-topic routes via `DISTINCT ON (route_id) ... ORDER BY route_id, t.name` (ordered by name, not physical row order, so re-running it on another copy of the DB picks the same one) → backfill the rest to `otros` → `SET NOT NULL` → add the FK → only then `DROP TABLE route_topics`. The Down recreates the table but **cannot recover a route's additional topics** — that information is destroyed by the Up.
12. `1785687947112_users-onboarding.sql` — `users.onboarding_completed_at TIMESTAMPTZ` (nullable).
13. `1785804639631_users-follows.sql` — `user_follows` (grafo dirigido, PK compuesta, `CHECK (follower_id <> following_id)`, sin `updated_at` porque la fila nunca se edita) + `users.followers_count`/`following_count` y el trigger `refresh_user_follow_counts()`. **Ese trigger es el único que toca dos filas de `users` por evento**, así que ordena sus dos `UPDATE` por uuid (`LEAST`/`GREATEST`) — sin eso, A siguiendo a B mientras B sigue a A toma los locks en orden contrario y produce un deadlock. Por lo demás copia el patrón de `refresh_route_rating()`: `AFTER INSERT OR UPDATE OR DELETE`, `FOR EACH ROW`, sin `TG_OP`, y recálculo total con `COUNT(*)` en lugar de deltas.
14. `1785805558046_users-verified-badge.sql` — `users.is_verified BOOLEAN NOT NULL DEFAULT FALSE`, the Instagram-style badge. **Unrelated to `users.email_verified`**, which is email confirmation and is what `auth.strategys.js` checks before allowing login; `is_verified` is editorial, granted by an admin, and gates nothing.
15. `1785808700071_fix-follow-counts-race.sql` — sustituye `refresh_user_follow_counts()` por **deltas (`+ 1` / `- 1`) en lugar del recuento total**, y resincroniza los contadores. El recuento con `COUNT(*)` tenía un lost update: esa subconsulta se evalúa con el snapshot del `INSERT` que dispara el trigger, así que la transacción que llega segunda cuenta sin la fila que la primera acaba de confirmar y pisa el valor bueno — con A siguiendo a B mientras B sigue a A, un contador se quedaba en 0. **Tomar los locks antes de contar no lo arregla**: el problema es el snapshot, no el orden de bloqueo. Es el único trigger del repo que usa `TG_OP`, porque un delta necesita saber si suma o resta. `refresh_route_rating()` y `refresh_route_enrollment_stats()` comparten el patrón del recuento y el mismo fallo teórico, sin corregir.
16. `1785861030129_trim-topics-to-core-subjects.sql` — recorta el catálogo a las **catorce materias que el front sabe pintar**, añade `ciencias-sociales` y `lengua-literatura` (que sustituyen a `sociologia` y `literatura`), pone tildes en los nombres y **elimina `topics.discipline`** junto con su índice. Se hizo con la base a 0 rutas y 0 preferencias, que es lo que la vuelve trivial: con datos, el `ON DELETE RESTRICT` de `routes.topic_id` habría abortado el borrado y el `CASCADE` de `user_topic_preferences` habría vaciado en silencio los intereses de la gente. Su Down repone el catálogo entero de la 10 y la columna, pero **deja las dos materias nuevas** en lugar de borrarlas: si para entonces alguna ruta las usa, el `RESTRICT` tumbaría el rollback completo.

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
