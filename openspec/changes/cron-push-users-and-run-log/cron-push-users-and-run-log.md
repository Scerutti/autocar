# cron-push-users-and-run-log (#58, E3)

**Base:** issue #58. This file adds the decisions taken on 2026-11-05 and wins over the issue where they conflict. #53 and #55 are already closed, so the cron already uses `carKmForNotifications` and skips completed reminders.

**Branch:** `feat/58-cron-push-users` from `epic/e3-resiliencia-operacion` (new, from `develop` @ `7aae018`). The PR goes to `epic/e3-resiliencia-operacion`.

**E3 order:** #58 → #59 (adds the deleted-car sweep to this same cron) → #60. #60 can be planned while #58/#59 are in review: it shares no files with them.

## Decisions

1. **Who gets processed:**
   - `collectionGroup('pushSubscriptions').select().get()`. The uid comes from `ref.parent.parent.id`, only when the path is `users/{uid}/pushSubscriptions/{id}`. Deduplicated and **sorted by uid** (the shuffle goes away).
   - Then `db.getAll()` of the `users/{uid}` docs in the queue. A uid with subscriptions but no `users/{uid}` doc is counted as processed with 0 messages (today it is not visited either, because `collection('users').get()` does not return it).
   - A user without push generates **no** reads of cars, rules or odometer.
   - Accepted side effect: today a user without push still gets `lastNotifiedStatus` reset when a rule goes back to `ok`. After this change that reset happens on the first run after they subscribe again. Worst case, a rule that went ok → overdue while they had no push is not announced again in that cycle.
2. **Parallel reads:**
   - The rules of all the user's cars are read with `Promise.all`, together with the top odometer readings (already parallel).
   - Cap: each car gets `floor(MAX_DOCS_PER_USER / cars)` rules (min 1), so the total read stays ≤ `MAX_DOCS_PER_USER`. Pure helper `perCarLimit(carCount)`.
3. **Run log `cronRuns/{YYYY-MM-DD}`** (UTC date of the run). Written only by the Admin SDK; no `match` in `firestore.rules` (denied by default).

   | Field | Meaning |
   |---|---|
   | `startedAt` | First run of the day (kept on later runs) |
   | `finishedAt` | End of the last run; `null` while a run is in progress |
   | `runs` | How many runs touched the doc (`increment(1)`) |
   | `candidates` | Uids with push in the last run |
   | `processed` | Cumulative users processed (ok or error) |
   | `skipped` | Users left out by the time budget in the last run |
   | `errors` | Cumulative users that threw |
   | `sent` | Cumulative push messages sent |
   | `cursor` | Last uid processed in order when `skipped > 0`; `null` when nothing is left |
   | `failures` | `[{ uid, message }]`, max 20, cumulative |

   - At start: `set({ startedAt (only if new), finishedAt: null, runs: increment(1) }, { merge: true })`. At end: the rest, merged.
   - If `skipped > 0` or `errors > 0`: one `console.error` with the summary (replaces the `console.warn`).
4. **Resumable:**
   - The run first reads `cronRuns/{today}` (before the collection group query):
     - no doc → full run;
     - `finishedAt != null` and `skipped == 0` → nothing to do, returns `{ ok: true, alreadyDone: true }` (1 read);
     - otherwise (skipped users, or a previous run that crashed with `finishedAt == null`) → processes only uids `> cursor` (`cursor == null` = from the start).
   - Users that threw are **not** retried by the second run (they are before the cursor). They stay in `failures` and in the `console.error`.
   - Since workers take users in order and all started ones finish before the response, after a run the processed users are exactly `queue[0..next)`. So `cursor = queue[next - 1]` when `next < queue.length`, else `null`.
   - Pure module `lib/cron-run.ts`: `candidateUids(paths)`, `planRun(uids, previous)`, `summarizeRun(queue, next, reports, previous)`, `perCarLimit(n)`. Tests in `lib/cron-run.test.ts`: empty list, cut in the middle, cursor at the end, already done, crashed previous run, duplicates and foreign paths in `candidateUids`, failures cap.
5. **Second cron:** `vercel.json` adds `{ "path": "/api/cron/daily", "schedule": "0 14 * * *" }`.
   - Verified in Vercel docs (2026-11-05): all plans allow up to 100 crons per project; Hobby runs each one **once per day** and **anywhere within the scheduled hour**. Two entries with the same `path` and different `schedule` are allowed.
   - The handler does not look at `x-vercel-cron-schedule`: what to do comes from the state of `cronRuns/{today}`, so a manual call behaves the same.
6. **Two runs the same day** (issue point 5): rules already notified are skipped by `lastNotified*`; the km request can repeat but the `tag` replaces it on the device. Documented in `SYSTEM_MAP.md`. With decision 4 this only happens if the first run crashed.
7. **Response:** `{ ok, date, candidates, processed, skipped, errors, sent, report }` for the current run (`report` as today).

## Tasks

1. `lib/cron-run.ts` + `lib/cron-run.test.ts` (decisions 2 and 4).
2. `app/api/cron/daily/route.ts`: candidates, `getAll`, parallel rules, `cronRuns`, cursor, `console.error`; remove `shuffled`, `rulesOf` sequential loop and the `console.warn`. `processUser` receives the user snapshot from `getAll`.
3. `vercel.json`: second cron.
4. `SYSTEM_MAP.md`: cron section (candidates, parallel reads, `cronRuns`, cursor, second cron, accepted side effects) and the collections tree (`cronRuns/{date}` — Admin only).
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
