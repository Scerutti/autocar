# cron-push-users-and-run-log (#58, E3)

**Base:** issue #58. This file adds the decisions taken on 2026-11-05 and wins over the issue where they conflict. #53 and #55 are already closed, so the cron already uses `carKmForNotifications` and skips completed reminders.

**Branch:** `feat/58-cron-push-users` from `epic/e3-resiliencia-operacion` (new, from `develop` @ `7aae018`). The PR goes to `epic/e3-resiliencia-operacion`.

**E3 order:** #58 → #59 (adds the deleted-car sweep to this same cron) → #60. #60 can be planned while #58/#59 are in review: it shares no files with them.

## Decisions

1. **Who gets processed:**
   - `collectionGroup('pushSubscriptions').select().get()`. The uid comes from `ref.parent.parent.id`, only when the path is `users/{uid}/pushSubscriptions/{id}`. Deduplicated and **sorted by uid** (the shuffle goes away).
   - `users/{uid}` is read inside `processUser`, only for each user that a worker actually processes (we don't pay reads for users left out by the time budget). A uid with subscriptions but no `users/{uid}` doc is counted as processed with 0 messages.
   - A user without push generates **no** reads of cars, rules or odometer.
   - Accepted side effects:
     - Today a user without push still gets `lastNotifiedStatus` reset when a rule goes back to `ok`. After this change that reset happens on the first run after they subscribe again. Worst case, a rule that went ok → overdue while they had no push is not announced again in that cycle.
     - Someone who subscribes between the first and the second run with a uid `<= cursor` gets their first notification the next day.
2. **Parallel reads:**
   - The rules of all the user's cars are read with `Promise.all`, together with the top odometer readings (already parallel).
   - Cap: each car queries `limit(MAX_DOCS_PER_USER)` and the combined array is sliced to `MAX_DOCS_PER_USER`, so a car with many rules can still use the quota unused by the user's other cars.
3. **Run log `cronRuns/{YYYY-MM-DD}`** (UTC date of the run). Written only by the Admin SDK; no `match` in `firestore.rules` (denied by default).

   | Field | Meaning |
   |---|---|
   | `startedAt` | First run of the day (kept on later runs) |
   | `runningSince` | Start of the current run (used for the `RUN_LOCK_MS = 60_000` lock) |
   | `finishedAt` | End of the last run; `null` while a run is in progress |
   | `runs` | How many runs touched the doc (`increment(1)`) |
   | `candidates` | Uids with push in the last run |
   | `processed` | Cumulative users processed (ok or error) |
   | `skipped` | Users left out by the time budget in the last run |
   | `errors` | Cumulative users that threw |
   | `sent` | Cumulative push messages sent |
   | `cursor` | Last uid processed in order when `skipped > 0`; `null` when nothing is left |
   | `failures` | `[{ uid, message }]`, max 20, cumulative |

   - At start (`claimRun` transaction): reads `cronRuns/{today}`; if not done and not busy, writes `{ startedAt (only if new), runningSince: now, finishedAt: null, runs: increment(1) }`.
   - At end (`saveRunSummary`): writes the summary with `finishedAt` and one retry. If both attempts fail, the route responds 500 with `ok: false`.
   - If `skipped > 0` or `errors > 0`: one `console.error` with the summary (replaces the `console.warn`).
4. **Resumable and mutually exclusive:**
   - The run first claims `cronRuns/{today}` in a transaction (before the collection group query):
     - no doc → full run;
     - `finishedAt != null` and `skipped == 0` → nothing to do, returns `{ ok: true, date, alreadyDone: true }`;
     - `finishedAt == null` and `now - runningSince < RUN_LOCK_MS` → another invocation is in flight, returns `{ ok: true, date, busy: true }`;
     - otherwise (skipped users, or a previous run that crashed after `RUN_LOCK_MS`) → processes only uids `> cursor` (`cursor == null` = from the start).
   - Users that threw are **not** retried by the second run (they are before the cursor). They stay in `failures` and in the `console.error`.
   - Since workers take users in order and all started ones finish before the response, after a run the processed users are exactly `queue[0..next)`. So `cursor = queue[next - 1]` when `next < queue.length`, else `null`.
   - Pure module `lib/cron-run.ts`: `candidateUids(paths)`, `runDateOf(now)`, `runIsDone(previous)`, `runIsBusy(previous, now)`, `queueFrom(uids, previous)`, `tally(reports)`, `summarizeRun(input)`. Tests in `lib/cron-run.test.ts`.
5. **Second cron:** `vercel.json` adds `{ "path": "/api/cron/daily", "schedule": "0 14 * * *" }`.
   - Verified in Vercel docs (2026-11-05): all plans allow up to 100 crons per project; Hobby runs each one **once per day** and **anywhere within the scheduled hour**. Two entries with the same `path` and different `schedule` are allowed.
   - The handler does not look at `x-vercel-cron-schedule`: what to do comes from the state of `cronRuns/{today}`, so a manual call behaves the same.
6. **Two runs the same day** (issue point 5): rules already notified are skipped by `lastNotified*`; the km request can repeat but the `tag` replaces it on the device. Documented in `SYSTEM_MAP.md`. With decision 4 this only happens if the first run crashed after `RUN_LOCK_MS`.
7. **Response:** `{ ok, date, candidates, processed, skipped, errors, sent, report }` for the current run (`report` as today).

## Tasks

1. `lib/cron-run.ts` + `lib/cron-run.test.ts` (decision 4).
2. `app/api/cron/daily/route.ts`: `claimRun` transaction, candidates, per-user `users/{uid}` read in `processUser`, parallel rules, `saveRunSummary` with retry, `console.error`; remove `shuffled`, `rulesOf` sequential loop and the `console.warn`.
3. `vercel.json`: second cron.
4. `SYSTEM_MAP.md`: cron section (candidates, parallel reads, `cronRuns`, lock, cursor, second cron, accepted side effects) and the collections tree (`cronRuns/{date}` — Admin only).
5. `CHANGELOG.md` → "Próxima versión": entry for #58. No `lib/novedades.ts` entry (not visible to users).
6. Copy this file to `openspec/changes/cron-push-users-and-run-log/` and add it to the README (IN PROGRESS).

## Out of scope

Members' notifications and `ruleNotices` (#61). Deleted-car sweep (#59). `nextDueDate` + collection group by due date (discarded in the issue until `cronRuns` shows > 50 % of the budget used).

## Conventions

- Commits in English, conventional, no attribution. Small commits per layer (`feat(cron)`, `test(cron)`, `chore(vercel)`, `docs`).
- No inline comments, no new comments unless they are `/** */` docs over declarations that replace existing ones.
- I do not run build, typecheck, tests or lint.
- PR to `epic/e3-resiliencia-operacion`, assignee `Scerutti`, labels `enhancement, cron, notificaciones, api, prioridad: media`, body from `.github/pull_request_template.md`.

## Manual steps (Seba)

- No rules to publish, no migration, no env vars.
- `npm test` (or trust CI) and the local check: `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/daily` twice. The second call must answer `alreadyDone: true`. To repeat a full run the same day, delete `cronRuns/{today}` from the console.
- If the collection group query answers `FAILED_PRECONDITION` (index missing), the error brings the link to create it in the Firebase console. I don't expect it for a query without filters or ordering, but it's the one console step that could show up.
- After deploy: watch `cronRuns/{date}` for a week (that's the E3 close condition).
