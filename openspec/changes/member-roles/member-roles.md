# member-roles (#71, E2)

**Base:** issue #71. This file adds the decisions taken on 2026-10-30 and wins over the issue where they conflict. It builds on #54 and #65 (already in `epic/e2-colaboracion-segura`): `memberProfiles`, `validProfile`, `ownerMembersUpdate`, `memberJoin`, `ownerTransfer`, `carMembers`.

**Branch:** `feat/71-member-roles` from `epic/e2-colaboracion-segura`. The PR goes to `epic/e2-colaboracion-segura`.

## Decisions

1. **Model:**
   - `memberProfiles[uid].role?: 'editor' | 'trusted' | 'viewer'`. A missing role means `editor`.
   - Members who exist only by their old mail (no profile) are `editor`.
   - `validProfile` accepts `role`.
   - `memberJoin` writes no role: accepting an invite makes you `editor`.
   - Pure helper `memberRole(car, uid)` in `lib/sharing.ts`.
2. **The owner changes a role:** this adds a third case to the owner's car update.
   - Only the `role` key of one existing profile changes, to one of the three values. Nothing else in the car changes.
   - `ownerMembersUpdate` stays as is, so it still rejects changed profiles.
   - `ownerTransfer`: the new owner's profile is removed, so its role goes away. The outgoing owner's profile is written without a role (`editor`).
3. **`trusted`:**
   - `saveJob` creates their job with `status: 'approved'` and goes through the same path as the owner for the job batch: `applyJobChange` writes the linked reading `job-{id}` in the member's name, plus the car's km. The odometer rules already let a member create their own linked reading, and `memberCarUpdate` already allows the km.
   - The trusted member **does not write `rules`** (still owner-only). The owner's reconciliation (`DataProvider`) applies those effects the next time the owner opens the app. Until then, `useData` shows the projection computed in memory.
   - In `applyJobChange`, skip the maintenance batches when the actor is not the owner.
   - Rule for creating a job: `approved` is allowed for a member only when their role is `trusted`. `reviewedAt` stays null and `revision` is 0.
   - Editing or deleting their own approved jobs: **not allowed**, same as today; only the owner can. `canEditJob` keeps that.
   - A job that was pending before the promotion stays pending.
4. **`viewer`: read only, all of it.**
   - The rules deny them create, update and delete on `jobs`, `fuel` and `odometer`, also for records they created before becoming a viewer.
   - On the car, `memberCarUpdate` denies the km branch. Leaving the car (`memberLeave`, `legacyMemberLeave`) stays allowed.
   - `DataProvider` does not call `syncCarKm` when I am a viewer.
   - The UI hides the entry points: "Cargar km", new job, new fuel load, edit and delete. Use a pure helper `canWrite(car, uid)` and plug it into `canEditEntry` and `canEditJob`.
   - `pendingItems` does not ask a viewer for km.
5. **Rules helper:** `memberRoleOf(car)`, which reads `car.get('memberProfiles', {}).get(request.auth.uid, {}).get('role', 'editor')`.
   - The child rules use it on `get`/`getAfter` of the car, inside the member branches that already call `memberOfCar`/`memberOfCarAfter`. Do not add new `get` calls if the same document is already read; check the per-request call limit.
6. **UI:** in Compartir, a segmented control (no select) per member with a uid: "Puede cargar" (editor), "Sin aprobación" (trusted), "Solo mira" (viewer). It applies with `useConfirm`. A member who exists only by old mail shows no control.

## Tasks

1. `lib/types.ts`: add `MemberRole` and `role?` in the profile.
2. `lib/sharing.ts`:
   - add `memberRole` and `canWrite`;
   - plug them into `canEditEntry` and `canEditJob`;
   - add `setRolePatch` if it helps.

   Tests in `lib/sharing.test.ts`. `lib/pending.ts` and its tests: decision 4.
3. `lib/db.ts`:
   - add `setMemberRole(actor, car, uid, role)` (`update` of `memberProfiles.{uid}.role`);
   - `saveJob` and `applyJobChange` handle trusted members (decision 3);
   - `profilesFrom` reads `role`.
4. `components/providers/data-provider.tsx`: decision 4 (`syncCarKm`).
5. `firestore.rules`:
   - `validProfile` accepts `role`;
   - the role-change case for the owner;
   - `memberRoleOf`;
   - the trusted case in the jobs `create` rule;
   - the viewer case in `jobs`, `fuel`, `odometer` and `memberCarUpdate`.

   Each new function gets a comment above it.
6. UI: decisions 4 and 6 (`car-form`, car detail, entry points, `job-form`).
7. `lib/novedades.ts`: add to the existing draft entry. `CHANGELOG.md`: add to the draft. `SYSTEM_MAP.md`: role, `setMemberRole`, the permissions per role, the rules. Copy this file to `openspec/changes/member-roles/` and add it to the README.

## Out of scope

Choosing the role when inviting. Notifications (#61). Removing `members` (#66).

## Conventions

- Commits in English, conventional format, no attribution.
- No inline comments: only `/** */` above declarations. In `firestore.rules`, the comment goes above each function.
- Do not run build, typecheck, tests or lint.
- PR assigned to `Scerutti`, labels `enhancement, firestore, prioridad: baja`. The body follows `.github/pull_request_template.md`.

## Manual steps (user)

- Simulator:
  - trusted: creates an approved job with its linked reading and the km; cannot write `rules`; cannot edit their own approved job.
  - editor: cannot create an approved job.
  - viewer: is denied create, update and delete on jobs, fuel and odometer, and the km on the car; can leave.
  - owner: changes only `role` (allowed); changes `role` together with another field, or to an invalid value (denied).
- Publish the rules with the rest of E2.
