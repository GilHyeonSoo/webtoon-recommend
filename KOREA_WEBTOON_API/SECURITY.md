# Crawler security contract

Use Node.js 22.12+ and `npm ci`; package-lock.json is canonical. The previous Yarn lock is retired.
`npm test` uses an isolated temporary SQLite database and never calls platform APIs.
`npm run typecheck` checks the server and tests.

Public GET /webtoons, /webtoons/:id and /health-check read stored metadata only.
GET enrich/persist parameters are rejected. health-check never starts collection.
The default bind address is 127.0.0.1; keep the crawler on a private network.

Management HTTP and Swagger are disabled by default (404). On a private service only,
set ENABLE_ADMIN_HTTP=true and CRAWLER_ADMIN_SECRET to a random secret of at least 32 characters.
Pass it as x-crawler-secret. Missing/incorrect keys return 401. No key => startup fails.
PUT /update/{naver,kakao,kakao-page}?force=true and PUT /enrich/naver?limit=50&delayMs=200
return 202 with a job object; authenticated GET /internal/jobs/:id returns its state.
Only one job can run. Overlap => 409. Job records are bounded and disappear on restart.

Set SQLITE_PATH to the persistent SQLite file. The adjacent .job.lock is an exclusive
cross-process lease. Never delete it while a crawler job is alive. After a crash, verify
that every process using this volume is stopped before removing a stale lock and restarting.
A job deadline aborts HTTP and wait operations but never unlocks while work is still active.
Rollback failure closes the database; restart is required before further jobs.
The enrichment CLI also uses this lease and validates its limit/delay inputs.

Public endpoints have bounded process-local rate limits. Use a single SQLite writer and
an additional trusted network/edge limit for multi-instance or public deployments.
Do not set an arbitrary trust-proxy configuration or publish admin credentials in the frontend.
