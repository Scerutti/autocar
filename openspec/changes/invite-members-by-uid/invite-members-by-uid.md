# invite-members-by-uid (#54, E2)

**Base:** issue #54 is the base design (model, `canonicalEmail`, writes, rules, migration, UI, DoD). This change adds only the decisions taken on 2026-10-30 and the details the issue leaves open. If anything here conflicts with the issue, this file wins.

**Branch:** `feat/54-invitations` from `epic/e2-colaboracion-segura`. The PR goes to `epic/e2-colaboracion-segura`.

## Decisions

1. **Sending an invite again.** The id stays fixed (`{carId}_{emailKey}`). `inviteMember` does a `set` on it. The rules accept that `set` as:
   - **create:** the doc does not exist. Conditions as in the issue.
   - **owner update ("re-send"):** the doc exists and its status is one of these:
     - `declined` or `revoked`;
     - `pending` and expired (`request.time >= expiresAt`);
     - `accepted`, and `acceptedUid` is no longer in `cars/{carId}.memberUids`.

     The new doc follows the same conditions as a create (`pending`, `expiresAt <= request.time + 15d`, same `carId`/`ownerUid`/`email`/`emailKey`, `respondedAt == null`, `acceptedUid == null`).
   - **owner update to `revoked`:** only from `pending`.
2. **The old PWA cannot add members.** The owner can no longer add mails to `members` (the issue's leak). On `members`, the owner can only remove mails. This does not close #66: reading by mail stays until #66.
3. **"Salir" in the old PWA is denied if my uid is in `memberUids`.** The old member branch (remove only my mail from `members`) is valid only when `request.auth.uid` is not in `memberUids`.
4. **The owner listens to their invites** with `invites where ownerUid == uid` (provable by the read rule). `useData()` returns `invites` (mine as owner) and `myInvites` (pending ones for my `emailKey`). Expired invites are filtered in memory with `today`/`Date.now()`.
5. **`memberError(car, invites, email)`** counts `memberUids` plus pending, non-expired invites of that car against `MAX_MEMBERS`. It rejects my own mail and mails that are already members or already have a pending invite (compared by `canonicalEmail`).
6. **Pending items.** The `shared` kind, `sharedSeenKey` and `unseenSharedCars` are removed. They are replaced by `{ kind: 'invite'; invite: Invite }` for each pending, non-expired invite in `myInvites`.
7. **`/invitaciones/[inviteId]`** reads the invite with a `getDoc`. A `permission-denied` result means the invite is for another account; the page shows the masked mail from the id (`j•••@gmail.com`). Accept and Decline both use `useConfirm`. After accepting, the page goes to `/autos/{carId}`.
8. **Rules simulator.** The rules use `let`, the ternary, `split` and `replace` (plan A from the issue). Plan B (API route) is not built. The user verifies the cases in the simulator before publishing.

## Tasks

1. `lib/types.ts`: `Invite`, `InviteStatus`, and in `Car` add `memberUids: string[]` and `memberProfiles: Record<string, { email: string; name: string | null }>`.
2. `lib/sharing.ts`:
   - add `canonicalEmail`, `maskEmail`, `inviteId(carId, email)`, `isInviteOpen(invite, now)`;
   - change `memberError` (decision 5);
   - `isSharedCar` and the membership checks use `memberUids`, with the old `members` as a fallback.

   Tests in `lib/sharing.test.ts`.
3. `lib/db.ts`:
   - `carFrom` reads the new fields, with tolerant defaults;
   - `inviteFrom`;
   - the `invites` listeners and the third cars query (`memberUids array-contains uid`);
   - `inviteMember`, `revokeInvite`, `acceptInvite` (one batch), `declineInvite`;
   - `removeMember(actor, car, uid)` and `leaveCar(actor, car)` remove the uid, `memberProfiles.{uid}` (`deleteField`) and, if present, the old mail;
   - `addMember` is removed.
4. `lib/pending.ts`: decision 6, with tests.
5. `firestore.rules`:
   - add `myEmailKey`, `match /invites/{inviteId}` (decision 1 plus the issue) and `memberJoin()`;
   - `isMember` checks the uid or the mail;
   - change `memberCarUpdate` (new leave, plus decision 3);
   - the owner cannot add mails to `members` (decision 2);
   - `validCar` accepts `memberUids` and `memberProfiles`.

   Each new function gets a comment above it.
6. UI:
   - the share section in `car-form`;
   - the invite card on Inicio and in the bell;
   - the new page `app/(app)/invitaciones/[inviteId]/page.tsx`. Read the dynamic routes guide in `node_modules/next/dist/docs/` first;
   - `leaveCar` on `/autos/[carId]`;
   - member names come from `memberProfiles`.
7. `scripts/members-to-uids.mjs` + `scripts/members-to-uids-plan.mjs` (pure, with tests), dry run by default, `--apply`, idempotent, as in the issue.
8. `lib/novedades.ts`: new user-facing entry. `CHANGELOG.md`: draft under "Próxima versión" (no version bump).
9. `SYSTEM_MAP.md`:
   - `invites` collection, new fields, new and changed `lib/db.ts` functions, the new route, the rules, the script and its order;
   - the order is: publish the rules → deploy → dry run → `--apply`.

   Add this change to `openspec/changes/README.md` and copy this file to `openspec/changes/invite-members-by-uid/`.

## Out of scope

Removing `members` (#66), notifications (#61), roles (#71), handing the car over to someone else (#65).

## Conventions

- Commits in English, conventional format.
- No inline comments: only `/** */` above declarations. In `firestore.rules`, the comment goes above each function or match.
- Do not run build, typecheck, tests or lint: the user runs them.
- PR assigned to `Scerutti`, labels `enhancement, security, firestore, datos, ux, prioridad: alta, breaking-change`. The body follows `.github/pull_request_template.md`.

## Manual steps (user)

- Simulator cases from the DoD.
- Publish the rules → deploy → `members-to-uids.mjs` dry run → `--apply`.
- Test with two real accounts.
