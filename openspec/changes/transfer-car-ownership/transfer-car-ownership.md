# transfer-car-ownership (#65, E2)

**Base:** issue #65. This file adds the decisions taken on 2026-10-30 and wins over the issue where they conflict. It builds on #54 (PR #91, already in `epic/e2-colaboracion-segura`): `memberUids`, `memberProfiles`, `invites`, `carMembers`, `ownerMembersUpdate`.

**Branch:** `feat/65-transfer-car` from `epic/e2-colaboracion-segura`. The PR goes to `epic/e2-colaboracion-segura`.

## Decisions

1. **Pending invites:** `transferCar` revokes every invite of the car with `status == 'pending'`, expired or not, in the same batch as the car (`status: 'revoked'`, the existing `ownerRevoke` rule). The invites come from `useData()` (the owner's invites).
2. **The new owner's old mail:** the same `update` removes from `members` every mail whose `canonicalEmail` equals that of the new owner's profile email.
3. **The photo can be deleted by the car's owner even if someone else uploaded it:**
   - `POST /api/cloudinary/delete` accepts `{ publicId, carId? }`.
   - If `publicId` is not the caller's (`isOwnPublicId`), it is accepted only when `carId` is given, `cars/{carId}` (Admin SDK) has `ownerUid == uid`, and its `photoPublicId == publicId`.
   - The character check on `publicId` (`[A-Za-z0-9/_-]`, prefix `autocar/`) stays for both paths.
   - `deleteImage(publicId, idToken, carId?)` passes it on. `car-form` passes `car.id` when it replaces or removes the photo of an existing car.
   - Keep the order the form uses today (update the car, then delete the old photo), so the check reads the car before it changes. If it does not work that way, read the code and report it rather than change the order on a guess.
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
4. `app/api/cloudinary/delete/route.ts`, `lib/cloudinary-client.ts` and `car-form`: decision 3. If the ownership check is extracted as a pure helper (for example in `lib/cloudinary-server.ts`), test it.
5. UI: decision 6.
6. `lib/novedades.ts`: add the user-facing text to the existing draft entry from #54 (do not create a new version). `CHANGELOG.md`: add to the "Próxima versión" draft.
7. `SYSTEM_MAP.md`: `transferCar`, the new rule branch, and the new delete input. Copy this file to `openspec/changes/transfer-car-ownership/` and add it to `openspec/changes/README.md`.

## Out of scope

Roles (#71), removing `members` (#66), notifications (#61).

## Conventions

- Commits in English, conventional format, no attribution.
- No inline comments: only `/** */` above declarations. In `firestore.rules`, the comment goes above each function.
- Do not run build, typecheck, tests or lint.
- PR assigned to `Scerutti`, labels `enhancement, firestore, cloudinary, api, prioridad: baja`. The body follows `.github/pull_request_template.md`.

## Manual steps (user)

- Simulator:
  - handing the car to a member is allowed;
  - handing it to a non-member is denied;
  - handing it to myself is denied;
  - extra fields in the same `update` are denied;
  - the previous owner ends up as a member and can leave.
- Publish the rules with the rest of E2.
