# BINGO DUEL

A server-authoritative, two-player Telegram Mini App. Uzbek is the default language; complete English and Russian dictionaries are included. One Node service serves the React app, REST API, Socket.IO and grammY bot; PostgreSQL is the durable source of truth.

## Rules

Each player has a secret 5×5 board containing 25 unique numbers from 1–40. Players alternate calling an unused number. Every call marks that number on **both** boards. Complete rows and columns count once, including multiple lines completed by one call. Diagonals are off by default. First to reach the configured target (default five lines) wins; simultaneous wins are a draw. Only the server generates random boards and computes scores, rewards and results. Manual boards are validated and permanently locked on READY. Final boards are available only to match participants after FINISHED.

The starting player is selected securely at random. Accepted rematches create a separate record and alternate the starter. Surrender after at least one call awards normal Elo/rewards; surrender before any call records a forfeit with zero rating/XP/stat changes. Abandoned games are cancelled without competitive rewards. A configured turn timer auto-picks a valid secure-random number when both players are online; it is off by default.

## Repository and architecture

```text
e2e/                Two-mobile-context browser match, refresh and rematch test
client/src/          React mobile UI, routes, translations, preferences, WebApp integration
server/src/
  engine.ts         Pure rules, line calculation, Elo, achievement conditions
  auth.ts           Telegram HMAC validation and signed session tokens
  games.ts          Transactional game, queue, rematch and cleanup services
  sockets.ts        Authenticated realtime transport and per-user state serialization
  app.ts            Validated REST API, authorization, admin, static serving
  bot.ts            grammY commands and secret-protected webhook
  profiles.ts       Statistics, rank and leaderboard
shared/types.ts     Shared game snapshots and typed Socket.IO contracts
prisma/             PostgreSQL schema, versioned SQL migration, optional local seed
scripts/            Bot registration utility
tests/              Unit/auth and real PostgreSQL + HTTP + socket integration suites
render.yaml         Single-instance web service and PostgreSQL blueprint
compose.yaml        Persistent local PostgreSQL
.github/workflows/  Build, typecheck, lint and integration CI
```

Client requests never contain authoritative scores, ratings, turns or winners. UUID internal IDs and random eight-character invite codes are separate. Every mutation acquires the same PostgreSQL transaction advisory lock before reading state: this serializes v1 membership, matchmaking, turns, stats and rematches across concurrent requests. Unique `(gameId, number)` and `(gameId, turnIndex)` constraints provide additional protection. Rewards and final state are committed atomically, once. Serialized snapshots omit the opponent board and completed-line positions during play, including socket updates. Admin live inspection also hides both boards.

Random board generation uses cryptographic Fisher–Yates. Sessions use HS256 with issuer, audience and 12-hour expiry. Raw Telegram `initData` is checked with the official two-stage HMAC, constant-time comparison and a one-hour validity window (30-second future clock tolerance). Duplicate query fields are rejected. `initDataUnsafe` is used only to locate an invite, never as authentication. JWTs are kept in per-tab sessionStorage; development keys stay in form memory. Production fails startup if dev auth is enabled or HTTPS/bot/webhook configuration is incomplete.

Socket presence is ephemeral and handles multiple connections per user. Gameplay is restored by fetching PostgreSQL state after reconnect, not by guessing missing calls. After 60 seconds offline a match is PAUSED, then resumes when both reconnect. After 10 minutes offline it is CANCELLED/ABANDONED. Startup clears stale matchmaking entries; periodic cleanup expires lobbies and queues. Do not scale the web service above **one instance** until adding a Socket.IO Redis adapter, distributed presence and coordinated background jobs. The database lock is intentionally conservative for initial traffic, not a high-volume scaling design.

## Requirements

- Node.js 22.12+ (22 LTS recommended; Node 24 also supported), npm.
- PostgreSQL 16+; Docker/Compose is the easiest local option.
- A Telegram bot and an HTTPS public URL for real Telegram testing.
- Browser profiles/two phones for independent user sessions.

## Local setup

From the existing repository checkout (cloud tasks are isolated; no extra Git worktree is needed):

```bash
cd INVENTAR
npm ci
cp .env.example .env
# Edit .env as described below before starting the server.
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
```

Vite runs on port 5173 and proxies API/WebSockets to port 3000. Use two separate browser profiles/incognito contexts, the same `DEV_AUTH_KEY`, and player IDs 1 and 2. The development sign-in screen is available **only** when `NODE_ENV` is not production AND `DEV_AUTH=true`; knowing an ID alone never grants access. For real Telegram testing use the bot instead of dev login.

Generate independent secrets locally; **do not commit or paste their values into chat**:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run separately for `SESSION_SECRET`, `DEV_AUTH_KEY` and `TELEGRAM_WEBHOOK_SECRET`. Copy the results securely into local `.env`/deployment settings. `.env` is ignored. Never expose any of these as Vite variables. Keep dev database credentials limited to localhost. The included Docker volume retains data when the container restarts; `docker compose down -v` destroys it.

## Environment variables

See [.env.example](.env.example) for the full editable template.

| Variable                             | Purpose / default                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| DATABASE_URL                         | Required PostgreSQL connection string; use Render's internal URL in production     |
| SESSION_SECRET                       | Required independently generated secret, at least 32 characters                    |
| NODE_ENV                             | `development`, `test`, or `production`                                             |
| PORT                                 | API/static server port, default 3000; binds `0.0.0.0`                              |
| BOT_TOKEN                            | BotFather credential, backend only                                                 |
| BOT_USERNAME                         | Bot username without `@`, used for deep links                                      |
| WEBAPP_URL                           | Exact public origin for CORS; HTTPS required for Telegram/production               |
| ADMIN_TELEGRAM_IDS                   | Comma-separated Telegram numeric IDs; empty means no admins                        |
| DEV_AUTH                             | Local fake-user auth switch; MUST be false in production                           |
| DEV_AUTH_KEY                         | Local-only shared test key, at least 24 characters                                 |
| BOT_MODE                             | `off` (browser-only local), `polling` (local), `webhook` (production)              |
| TELEGRAM_WEBHOOK_SECRET              | Independent 32–256 character alphanumeric/underscore/hyphen secret                 |
| BOARD_SIZE / NUMBER_MIN / NUMBER_MAX | v1 enforces 5 / 1 / 40                                                             |
| WIN_LINES                            | Default target, 5; friend creator may choose 1–10                                  |
| RECONNECT_GRACE_SECONDS              | Default 60                                                                         |
| ABANDON_SECONDS                      | Default 600; must exceed grace                                                     |
| LOBBY_TTL_SECONDS                    | Default 1800                                                                       |
| QUEUE_TTL_SECONDS                    | Default 120; search UI renews entries after expiration                             |
| TURN_TIMER_SECONDS                   | Default 0 (off); if enabled, timeout auto-calls a valid number                     |
| TRUST_PROXY                          | Trusted proxy hop count, 0 local / 1 Render; configure for actual topology         |
| PRISMA_JS_SCHEMA_ENGINE              | Optional local cloud-only migration fallback, default false; ignored in production |

Prisma Client uses the supported JavaScript query engine and official `@prisma/adapter-pg`, avoiding runtime native artifacts. CLI migrations use Prisma's native schema engine by default. In restricted cloud development machines, `PRISMA_JS_SCHEMA_ENGINE=true` uses Prisma 6's experimental JS/WASM schema engine to generate/deploy migrations without accessing `binaries.prisma.sh`. **Do not enable it for production**. Production and CI use the stable native migration engine. No signature/checksum/TLS verification is disabled in either path. If your network restricts package downloads, permit `registry.npmjs.org` and `binaries.prisma.sh` for the standard CLI.

## Database and development commands

```bash
npm run db:generate       # regenerate typed client
npm run db:migrate        # apply committed migrations, safe deployment workflow
npm run db:dev -- --name your_change  # create a NEW migration when changing schema
npm run db:seed           # optional local-only users and achievement definitions
npm run typecheck
npm run lint
npm test
npm run build            # Prisma generation, backend compilation, frontend build
npm start                # serve the built application and API
```

The initial migration is versioned under `prisma/migrations`; never use `db push` as a production deployment replacement. `db:seed` refuses production and is never run automatically. Runtime config is read at server startup; keep `DATABASE_URL` and secrets available for `npm start`.

## Tests

`npm test` runs engine and authentication suites. Database integration tests are explicitly skipped unless `RUN_DB_TESTS=1`, rather than pretending a missing database was tested. To run them, use an **isolated** test database. The suite creates and removes three reserved local test users (`900001`–`900003`) and their games; never point it at real user data.

```bash
docker compose exec -T db createdb -U bingo bingo_test
DATABASE_URL=postgresql://bingo:bingo@localhost:5432/bingo_test npm run db:migrate
TEST_DATABASE_URL=postgresql://bingo:bingo@localhost:5432/bingo_test npm run test:integration
```

The integration suite exercises HTTP auth, game privacy, unauthorized calls, manual validation/locking, capacity, socket sanitization, a real socket call, simultaneous request races, draw completion, rewards/history, rematch records, forfeit, queue pairing, reconnection and admin banning. GitHub CI runs both suites against PostgreSQL.

Optional mobile browser verification (uses development accounts 910001/910002 in the local development database):

```bash
npx playwright install chromium
npm run build
npm run test:e2e
# If Chromium is already installed:
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

The test starts the built server, plays a complete manual-board draw through two independent mobile browser contexts, refreshes mid-game, verifies width 320px and accepts a rematch. Screenshots are written to ignored `e2e-artifacts/`. Supply a local `.env` with `DEV_AUTH_KEY`. Do not point this development test at production.

## Telegram / BotFather

1. Message **@BotFather**, run `/newbot`, choose a bot name and username. Store its token securely as `BOT_TOKEN`; set `BOT_USERNAME` without `@`.
2. Set a reachable HTTPS `WEBAPP_URL`. In BotFather configure your bot's **Main Mini App** and its launch URL to that same application. The main Mini App setting is required for `https://t.me/<bot>?startapp=game_<code>` invites. A menu button alone does not activate this deep-link format.
3. Configure the bot menu via BotFather `/setmenubutton` (or the utility below). The `/start` and `/play` buttons also open the app.
4. Set `BOT_MODE=webhook` and a fresh `TELEGRAM_WEBHOOK_SECRET` on the production service.
5. Once the service is healthy, run `npm run bot:setup` in a secure shell with the production environment variables. It registers commands/menu and the `/telegram/webhook` URL with Telegram's secret header. Run this again if the public URL or secret changes. It is explicit, not executed automatically on every deployment.
6. Open the app from the bot on two Telegram accounts. Create a friend lobby, share its invite, join, click READY on both phones, then call numbers and test minimizing/reconnecting.

The command registration utility performs real Telegram writes and requires your bot credentials. No bot was contacted during development without supplied credentials. Production webhook requests validate `X-Telegram-Bot-Api-Secret-Token`; local polling deletes the webhook intentionally, so do not run a local poller with your production bot token. Use a separate development bot.

## Local Telegram testing over HTTPS

Deploy to a staging Render service or expose **port 3000** of the built app with a trusted HTTPS tunnel (for example a tunnel tool you already use). Build then `npm start`; set `WEBAPP_URL` to the tunnel origin, restart, and point the development bot's Mini App to it. This same-origin approach carries Socket.IO correctly and avoids Vite HMR exposure. A mobile phone cannot reach your computer's loopback interface. Telegram production WebApps require HTTPS. If using polling locally, set `BOT_MODE=polling`, `NODE_ENV=development`; use `bot:setup` for commands/menu without setting a webhook.

## Render deployment

The blueprint uses paid Starter web and Basic PostgreSQL plans to provide an always-running process, persistent database and pre-deploy migrations. Review current Render prices before provisioning.

1. Push this repository to GitHub (no secrets; include `package-lock.json` and migrations). For this initially empty repository:

   ```bash
   git add .
   git commit -m "Implement BINGO DUEL"
   git branch -M main
   git push -u origin main
   ```

2. Create a Render Blueprint from `render.yaml`, or create a PostgreSQL database and one Node Web Service manually.
3. Set `DATABASE_URL` to the database's internal connection string.
4. Set `NODE_ENV=production`, `DEV_AUTH=false`, `BOT_MODE=webhook`, `TRUST_PROXY=1` and Node 22.
5. Set `BOT_TOKEN`, `BOT_USERNAME`, and `WEBAPP_URL=https://<your-service>.onrender.com` (or your custom domain).
6. Set a generated `SESSION_SECRET` and independent `TELEGRAM_WEBHOOK_SECRET`. Set your `ADMIN_TELEGRAM_IDS` if desired.
7. Build command: **`npm ci --include=dev && npm run build`**.
8. Pre-deploy command: **`npm run db:migrate`**. On a plan without pre-deploy support, run this once in a secure deploy shell before starting the new version. Do not let parallel web workers race migrations.
9. Start command: **`npm start`**. Health path: **`/health`**, which verifies the database, not merely the process.
10. Deploy, verify health, then run **`npm run bot:setup`** in Render Shell. The token never needs to be inserted into a URL in browser history.
11. Configure BotFather Main Mini App and menu URLs, then verify with two separate mobile Telegram accounts.
12. Test a full match, a draw/manual game, rematch, reconnect after temporary network loss, and match history. Check logs for unexpected errors.

Keep the service at **one instance** in v1. Use PostgreSQL backups and restore drills appropriate to your service. No game state depends on the Render filesystem. Live socket connections restart after deployments; players resync persisted state automatically. This repository does not provision external infrastructure or publish itself.

## API and realtime

JSON endpoints return `{data: ...}` on success and `{error: CODE}` on failure. Except `/api/auth`, `/api/config` and `/health`, API routes require `Authorization: Bearer <session>`. Routes are listed in `server/src/app.ts`. Mutations are available over REST; typed socket mutations are also implemented for join, ready, call and rematch. Every mutation uses the same domain services. Each client joins an authenticated user room, while explicit `game:join` authorizes membership before joining `game:<uuid>`. Game snapshots are emitted separately per user, never by broadcasting a common payload containing both boards. Rate limits apply to auth, API by IP/user, and socket mutation traffic.

Leaderboard returns top 100 using indexed database ordering, plus the caller's rank outside that list. History is paginated (20 per page). Public profiles exclude Telegram IDs, last names, language and auth metadata. Admin APIs require configured Telegram IDs, expose operational counts and recent users/matches, and support live inspection/cancellation and ban/unban. Daily activity is persisted; daily games/mode/duration metrics derive from indexed game records. Newly unlocked achievements animate after finishing, and XP/levels are computed server-side (`level = 1 + floor(xp / 100)`).

## Manual changes and verification limits

You must supply bot credentials, production secrets, your domain, database URL and optional admin IDs; configure BotFather; provision/deploy on Render; register the webhook; and perform the two-account phone test. These cannot be validated without your external accounts. Local dev auth never simulates successful Telegram verification in production.

V1 limitations: one service instance, conservative global mutation serialization, optional turn timer uses auto-pick only, fixed 5×5 / 1–40 rules, no spectators, no Redis, no external cron/admin analytics export. Local cloud WASM migration fallback is experimental and deliberately excluded from production. Sound uses small generated tones after interaction. A production release still requires real Telegram/Render smoke tests, operational monitoring and database backups; local build/tests alone are not proof of production operation.
