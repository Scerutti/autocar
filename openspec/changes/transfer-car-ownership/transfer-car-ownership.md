# transfer-car-ownership (#65, E2)

**Base:** issue #65. This file adds the decisions taken on 2026-10-30 and wins over the issue where they conflict. It builds on #54 (PR #91, already in `epic/e2-colaboracion-segura`): `memberUids`, `memberProfiles`, `invites`, `carMembers`, `ownerMembersUpdate`.

**Branch:** `feat/65-transfer-car` from `epic/e2-colaboracion-segura`. The PR goes to `epic/e2-colaboracion-segura`.

## Decisions

1. **Invites:** `transferCar` deletes every invite of the car, with any status, in the same batch as the car (the existing `allow delete: if isOwner(resource.data.ownerUid)` rule lets the outgoing owner do it). An invite id is fixed (`{carId}_{emailKey}`) and only its `ownerUid` can resend or delete it, so leaving them would stop the new owner from inviting those mails again and from deleting them with the car. The invites come from `useData()` (the owner's invites, `where ownerUid == uid`).
2. **The new owner's old mail:** the same `update` removes from `members` every mail whose `canonicalEmail` equals that of the new owner's profile email.
3. **Photo: no change.** A photo uploaded by someone else (the previous owner) stays orphaned in Cloudinary when the new owner replaces, removes or deletes it: `POST /api/cloudinary/delete` only accepts the caller's own `publicId`, as today. The delete API, `deleteImage` and `car-form` do not change. Reason: `car-form` deletes the old photo after the server confirms the car update, when the car already points to the new photo (or to none), and `deleteCar` deletes the car before the photo; so the API cannot confirm that the old `publicId` belonged to the car.
4. **Rules:** add a new owner branch, `ownerTransfer()`, as an alternative to `ownerUid == before && ownerMembersUpdate()`. It holds when:
   - the caller is `before.ownerUid`;
   - `after.ownerUid` is in `before.memberUids` and is not the caller;
   - `after.memberUids.toSet() == before.memberUids.toSet().difference([to]).union([caller])`, with `size() <= 2`;
   - in `memberProfiles` the key `to` is removed and the key `caller` is added (`validProfile`);
   - `after.ownerName` is the name from `to`'s profile (`get('name', null)`);
   - `before.members` contains all of `after.members` (removal only);
   - the affected keys are only `ownerUid`, `ownerName`, `memberUids`, `memberProfiles` and `members`.
5. **`transferCar(actor, ctx, car, to: CarMember, myEmail)`:**
   - one batch: the car `update` (`ownerUid`, `ownerName`, `memberUids`, `memberProfiles` with my profile `{ email: login mail in lowercase, name: actor.name }` and `deleteField()` on `to`'s key, `members`) plus the invite revokes;
   - `memberUids` and `members` are written as full lists computed from `car`, not with `arrayUnion`/`arrayRemove`, because the rule compares whole sets;
   - only for members with a uid (`to.uid != null`). A member who is only an old mail cannot receive the car.
6. **UI:**
   - "Pasarle el auto" next to each member with a uid, under Compartir in `car-form`;
   - a strong `useConfirm` that names the person and says that the user becomes a member, that pending invites are cancelled, and that the new owner manages the maintenance plan and approvals;
   - after it succeeds, the user goes to `/autos/{carId}`.

## Tasks

1. `lib/sharing.ts`: pure function `transferPatch(car, to, me)` that returns the new `ownerUid`, `ownerName`, `memberUids`, `memberProfiles` (without the `deleteField`, which `lib/db.ts` adds) and `members`. Add tests in `lib/sharing.test.ts`.
2. `lib/db.ts`: add `transferCar` (decisions 1, 2, 5).
3. `firestore.rules`: add `ownerTransfer()` (decision 4), with a comment above it.
4. Photo: nothing to do (decision 3).
5. UI: decision 6.
6. `lib/novedades.ts`: add the user-facing text to the existing draft entry from #54 (do not create a new version). `CHANGELOG.md`: add to the "Próxima versión" draft.
7. `SYSTEM_MAP.md`: `transferCar` and the new rule branch. Copy this file to `openspec/changes/transfer-car-ownership/` and add it to `openspec/changes/README.md`.

## Out of scope

Roles (#71), removing `members` (#66), notifications (#61).

## Conventions

- Commits in English, conventional format, no attribution.
- No inline comments: only `/** */` above declarations. In `firestore.rules`, the comment goes above each function.
- Do not run build, typecheck, tests or lint.
- PR assigned to `Scerutti`, labels `enhancement, firestore, prioridad: baja`. The body follows `.github/pull_request_template.md`.

## Manual steps (user)

- Simulator:
  - handing the car to a member is allowed;
  - handing it to a non-member is denied;
  - handing it to myself is denied;
  - extra fields in the same `update` are denied;
  - in the same batch, the outgoing owner deletes the car's invites (pending, accepted, declined, revoked);
  - the previous owner ends up as a member and can leave;
  - afterwards, the new owner can invite a mail the previous owner had invited.
- Publish the rules with the rest of E2.
