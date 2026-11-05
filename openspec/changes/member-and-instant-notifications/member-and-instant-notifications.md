# member-and-instant-notifications (#61, E2 on E3)

**Base:** issue #61. This file adds the decisions taken on 2026-11-05 and wins over the issue where they conflict. It builds on #54 (`memberUids`, `memberProfiles`), #71 (`memberRole`, `canWrite`), #56 (`job.revision`) and #58 (`cronRuns`, per-user cron).

**Branch:** `feat/61-member-notifications` from `epic/e3-resiliencia-operacion` @ `6372489` (per Seba's instruction to start #61 on the E3 branch). The PR goes to `epic/e3-resiliencia-operacion`.

## Decisions

1. **Per-user "notified" state (`users/{uid}/ruleNotices/{ruleId}`):**
   - Shape: `{ status: 'soon' | 'overdue' | null, at: Timestamp | null }`. `RuleNotice = { status: 'soon' | 'overdue' | null; at: Date | null }`.
   - Written **only** by the Admin SDK (cron and `/api/notify/rules`).
   - `firestore.rules`: inside `match /users/{uid}`, add `match /ruleNotices/{ruleId} { allow read: if isOwner(uid); }` (no client create/update/delete).
   - Fallback for the car owner (`effectiveRuleNotice(rule, isOwner, notice)`): if the owner has a `ruleNotices/{ruleId}` doc (even with `status: null`, which means it was cleared after returning to `ok`), use it; if the doc does not exist yet (`undefined`), fall back to `{ status: rule.lastNotifiedStatus, at: rule.lastNotifiedAt }`. For members (`!isOwner`), a missing doc means `{ status: null, at: null }`.
   - The cron stops writing `rule.lastNotified*` on `cars/{carId}/rules/{ruleId}` and writes `users/{uid}/ruleNotices/{ruleId}` instead. (`rule.lastNotified*` stays in `MaintenanceRule`, `validRule` and `projectionPatch` for backward compatibility and as the initial owner seed.)

2. **Settings (`sharedCars: boolean`):**
   - `UserSettings` adds `sharedCars?: boolean` (`DEFAULT_SETTINGS.sharedCars = true`). Missing in Firestore = `true` (`x?.sharedCars !== false` in `subscribeUserData`, the cron and `/api/notify/rules`).
   - `validSettings(d)` in `firestore.rules` adds `'sharedCars'` to `hasOnly` and `optBool(d, 'sharedCars')` (optional, so older PWA clients without `sharedCars` still pass).
   - **What `sharedCars: false` turns off for a member** (`!isCarOwner(car, uid)`):
     - Daily cron: skips shared cars (`memberUids`) when `settings.sharedCars === false` (neither rule alerts nor weekly km reminders for those cars).
     - Instant `/api/notify/rules`: skips a member recipient whose `users/{uid}.sharedCars === false`.
     - Note: `/api/notify/job` (`approved` / `rejected` of a job the member submitted themselves) is **always** sent if the member has push — it is a direct reply to their own action.
   - **UI (`app/(app)/ajustes/page.tsx`):** a `Checkbox` in the "Notificaciones" section: label `"Avisos de autos compartidos"`, description `"Vencimientos y recordatorios de los autos que otra persona compartió con vos."`, with `useConfirm()` before toggling (same pattern as `toggleReminder`).

3. **Daily cron (`app/api/cron/daily/route.ts` + `lib/notifications.ts`):**
   - For each candidate `uid`:
     - Own cars: `cars where ownerUid == uid` (up to `MAX_DOCS_PER_USER`).
     - Shared cars (only if `settings.sharedCars !== false`): `cars where memberUids array-contains uid`, capped to the remaining `MAX_DOCS_PER_USER`. (Legacy email-only `members` are not queried here; #54/#66 move everyone to `memberUids`.)
     - In parallel across all `cars`: `rulesOf(carDocs)`, `topReadingOf(carDoc)`, `userDoc.ref.collection('ruleNotices').limit(MAX_DOCS_PER_USER).get()`, and — for own cars that are shared (`(car.memberUids?.length ?? 0) > 0 || (car.members?.length ?? 0) > 0`) — `carDoc.ref.collection('jobs').where('status', '==', 'pending').limit(MAX_DOCS_PER_USER).get()` to count `pendingReviewCount` and know which car(s) have pending jobs.
   - `planDailyNotifications` receives:
     - `uid?: string` (optional so existing callers/tests keep working; when omitted, all cars are treated as own and non-viewer),
     - `notices?: ReadonlyMap<string, RuleNotice>` (when omitted, falls back to `rule.lastNotified*`),
     - `pendingReview?: { count: number; carId: string | null }` (`carId` is the car id when all pending jobs belong to a single car, else `null`).
   - Inside `planDailyNotifications`:
     - If `uid` is provided and `!settings.sharedCars`, shared cars (`car.ownerUid && car.ownerUid !== uid`) are filtered out.
     - Weekly km reminder only includes cars where `!uid || canWrite(car, uid)` (a `viewer` is not asked for km, matching `pendingItems`).
     - If `pendingReview.count > 0`, builds a review message:
       - `title: pendingReview.count === 1 ? 'Tenés 1 trabajo para revisar' : \`Tenés \${pendingReview.count} trabajos para revisar\``,
       - `body: 'Tocá para aprobarlo o rechazarlo.'` (or `'Tocá para revisarlos.'` when > 1),
       - `url: pendingReview.carId ? \`/autos/\${pendingReview.carId}?tab=trabajos\` : '/'`,
       - `tag: REVIEW_TAG` (`'review'`).
       - Reserved slot just like `km`: never dropped by rule alerts (`ruleSlots = MAX_MESSAGES_PER_RUN - km.length - (reviewMessage ? 1 : 0)`).
   - Persisting updates: `bulkWriter` writes `db.collection('users').doc(uid).collection('ruleNotices').doc(u.ruleId).set({ status: u.lastNotifiedStatus, at: u.notified ? Timestamp.fromDate(now) : null })` and, when `settings.sharedCars !== false` and neither cars nor rules reached `MAX_DOCS_PER_USER`, deletes orphan `ruleNotices` (`orphanNoticeIds(notices, rules)`).

4. **Instant job notifications (`POST /api/notify/job`):**
   - Body: `{ carId: string, jobId: string, event: 'submitted' | 'approved' | 'rejected' }`.
   - `authorize(request)` → reads `cars/{carId}` and `cars/{carId}/jobs/{jobId}` in parallel.
   - Validation (pure helper `planJobNotification({ uid, car, job, event })`):
     - Missing car or job → 404.
     - `event === 'submitted'`: caller must be a member (`(car.memberUids ?? []).includes(uid)`) and the job's author (`job.createdBy === uid`), and `job.status === 'pending'`. Recipient is `car.ownerUid`.
       - Message: `title: \`Trabajo para revisar en \${nameOf(car)}\``, `body: \`\${job.createdByName || 'Un miembro'}: \${job.title}\``, `url: \`/autos/\${car.id}/trabajos/\${job.id}\``, `tag: \`job-review-\${job.id}\``.
     - `event === 'approved' | 'rejected'`: caller must be the owner (`car.ownerUid === uid`), `job.status === event`, and `job.createdBy` must exist and not be the owner. Recipient is `job.createdBy`.
       - Message (`approved`): `title: \`Aprobaron tu trabajo en \${nameOf(car)}\``, `body: job.title`, `url: \`/autos/\${car.id}/trabajos/\${job.id}\``, `tag: \`job-\${job.id}\``.
       - Message (`rejected`): `title: \`Rechazaron tu trabajo en \${nameOf(car)}\``, `body: \`\${job.title} — tocá para corregirlo.\``, `url: \`/autos/\${car.id}/trabajos/\${job.id}\``, `tag: \`job-\${job.id}\``.
     - Any authorization/state mismatch → 403.
   - **Idempotency:** `db.collection('notices').doc(\`${job.id}_${event}_${job.revision ?? 0}\`).create({ carId, jobId: job.id, event, revision: job.revision ?? 0, createdAt: Timestamp.now() })`. If `create` throws code `6` (`ALREADY_EXISTS`), return `200 { sent: 0, duplicate: true }`. (`notices` has no `match` in `firestore.rules`: Admin SDK only.)
   - Calls `sendToUser(recipientUid, [message])` and returns `200 { sent }`.

5. **Instant rule-escalation notifications (`POST /api/notify/rules`):**
   - Body: `{ carId: string, ruleIds?: string[] }`.
   - `authorize(request)` → reads `cars/{carId}`, its `rules`, `jobs` and `odometer` (`limit(MAX_DOCS_PER_USER)`) in parallel, projects the rules in memory (`projectRules(rawRules, jobs, readings)` filtered by `ruleIds` when provided) and computes the car km with `carKmFrom(readings)`.
   - Authorization: caller `uid` must be `car.ownerUid === uid` or `(car.memberUids ?? []).includes(uid)` (else 403; missing car → 404).
   - Effective car km: `carKmForNotifications(car, top)`.
   - Recipients: `[car.ownerUid, ...(car.memberUids ?? [])].filter(u => u && u !== uid)`.
   - For each recipient, reads `users/{recipientUid}` (to check `sharedCars !== false` when recipient is a member, and `timezone`) and, inside `db.runTransaction` per escalated rule (`claimRuleNotice`), reads `users/{recipientUid}/ruleNotices/{ruleId}`, checks `didRuleEscalate(prev.status, alert.status)` and writes `{ status: alert.status, at: Timestamp.fromDate(now) }`.
   - Calls `sendToUser(recipientUid, messages)`.
   - **Caller toast on the client:**
     - Pure helper `escalatedRules({ carBefore, carAfter, rulesBefore, rulesAfter, today })`: returns the active rules of the car whose status went `ok`/`unknown` → `soon`/`overdue` or `soon` → `overdue`.
     - After `settle` returns `'saved'` (or on Undo/Delete), if any rule escalated (`escalations.length > 0`), the client shows a `toast.warning` (`announceRuleEscalations`) and, if the car has members (`memberUids.length > 0`), fires `notifyRulesInBackground(car.id, escalations.map(e => e.rule.id), getToken)`. `notifyJobInBackground` is attached to `.then` of the write promise so offline saves that sync while the app is open still send the push; if the app closes before syncing, `submitted` is covered by the daily cron's review summary and `approved`/`rejected` are seen in the app.
     - Wired in: `km-form.tsx` (`recordKm`), `autos/[carId]/page.tsx` (`deleteReading`, `restoreReading`), `fuel-form.tsx` (`saveFuel`, `deleteFuel`, `restoreFuel`), `job-form.tsx` (`saveJob`, `approveJob`, `rejectJob`, `deleteJob`, `restoreJob`).

## Tasks

1. `lib/types.ts`: add `RuleNotice` and `sharedCars?: boolean` on `UserSettings` (`DEFAULT_SETTINGS.sharedCars = true`).
2. `lib/notifications.ts` + `lib/notifications.test.ts`:
   - `REVIEW_TAG = 'review'`, `effectiveRuleNotice`, `didRuleEscalate`, `ruleAlertMessage`, `planRuleAlerts`, `escalatedRules`, `planJobNotification`;
   - update `planDailyNotifications` to accept `uid`, `notices` and `pendingReview`.
   - Unit tests for per-person notices (owner fallback vs member fresh state), review summary message, `planRuleAlerts`, `escalatedRules` and `planJobNotification` (author/owner checks, 403 cases).
3. `lib/notify-client.ts`: client helpers `notifyJobInBackground`, `notifyRulesInBackground`, `announceRuleEscalations`, `checkCarRuleEscalations`, `readingsWithLinked`.
4. `app/api/notify/job/route.ts` and `app/api/notify/rules/route.ts`.
5. `app/api/cron/daily/route.ts` and `lib/push-server.ts`: query shared cars (`memberUids`), read `users/{uid}/ruleNotices`, count pending jobs on own shared cars, pass to `planDailyNotifications`, write `users/{uid}/ruleNotices/{ruleId}`.
6. `lib/db.ts`, `components/km-form.tsx`, `components/forms/fuel-form.tsx`, `components/forms/job-form.tsx`, `app/(app)/autos/[carId]/page.tsx`, `app/(app)/ajustes/page.tsx`:
   - `subscribeUserData` reads `sharedCars: x?.sharedCars !== false`;
   - `saveJob` accepts optional `jobId` (`newChildId`) so `job-form` can call `notifyJobInBackground`;
   - wire `notifyJobInBackground`, `checkCarRuleEscalations` after `settle === 'saved'` (and on Undo/Delete);
   - add `"Avisos de autos compartidos"` checkbox in `ajustes/page.tsx`.
7. `firestore.rules`: `validSettings` accepts optional `sharedCars` (`optBool`); `match /ruleNotices/{ruleId}` under `match /users/{uid}` allows `read: if isOwner(uid)`.
8. `SYSTEM_MAP.md`, `CHANGELOG.md`, `lib/novedades.ts`, and `openspec/changes/member-and-instant-notifications/`.

## Out of scope

- Deleting `rule.lastNotifiedAt` / `rule.lastNotifiedStatus` from `MaintenanceRule` and `validRule` (kept as initial owner fallback and for backward compatibility with cached PWAs).
- Querying legacy email-only `car.members` in the cron (#66 removes `members`).

## Conventions

- Commits in English, conventional, no attribution.
- No inline comments: only `/** */` above declarations. In `firestore.rules`, comment above each `function`/`match`.
- Do not run build, typecheck, tests or lint locally.
- PR to `epic/e3-resiliencia-operacion`, assignee `Scerutti`, labels `enhancement, notificaciones, cron, api, firestore, prioridad: media`, body from `.github/pull_request_template.md`.

## Manual steps (Seba)

- Simulator (`firestore.rules`):
  - `users/{uid}`: updating `{ sharedCars: false }` or `{ sharedCars: true }` is allowed for `uid`; non-boolean `sharedCars` is denied; existing settings without `sharedCars` still pass.
  - `users/{uid}/ruleNotices/{ruleId}`: owner `uid` can `read`; client `create`, `update`, `delete` are denied; another user cannot `read`.
- Publish `firestore.rules` before merging the release to `main`.
