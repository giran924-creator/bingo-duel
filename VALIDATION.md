# Validation record

Verified in this cloud machine using Node 24, PostgreSQL 16, Prisma 6.19, Vitest 5 and the installed Chromium. This is a development verification record, not a claim of an external Telegram/Render deployment.

- `npm install` and repeatable `npm ci` install the committed npm lockfile.
- `npm run db:migrate` applies the initial SQL migration and passes on rerun with no pending migrations, using the optional cloud development JS/WASM adapter. The local catalog adapter casts PostgreSQL `name` projections to text to work around Prisma 6's JS schema-engine type limitation.
- `npm run typecheck`, `npm run lint` and `npm run build` pass.
- `npm test`: 18 game engine and Telegram/session authentication tests pass, including production rejection of development authentication. PostgreSQL tests are skipped by this command unless explicitly enabled.
- `npm run test:integration` against isolated `bingo_test`: 11 tests pass, exercising actual PostgreSQL, HTTP, authenticated Socket.IO, private snapshots, concurrent submissions, normal win/draw, forfeit rewards, rematch, queue, reconnect and admin.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`: two separate mobile contexts play a complete manual match through the UI, refresh mid-match, reach a draw, reveal boards after completion and accept a rematch. 320px width is checked for horizontal overflow; no browser JavaScript errors. Screenshots are local ignored artifacts.
- `npm audit`: zero known vulnerabilities in the tested lockfile. Patched transitive `deepmerge-ts` and `effect` overrides are explicit in package.json; all Prisma/build/test paths were checked with those overrides.

External checks still required: real bot credentials, Telegram initData from two phones, BotFather Main Mini App configuration, Render deployment, native production migration execution and webhook delivery. Server-side signature verification is covered by unit tests with independently generated HMAC data; no live bot was configured or contacted.

The PostgreSQL driver may emit a pg@8 deprecation notice about concurrent queries inside Prisma interactive transactions; it does not fail the tested workflow. pg@9 is not used. The local WASM schema engine is experimental and is excluded in production by configuration. Production uses the default native Prisma migration engine. The web service supports one instance until a Redis adapter and distributed presence/jobs are implemented.
