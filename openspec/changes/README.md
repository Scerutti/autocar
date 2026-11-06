# Active changes

| Change | Title | Priority | Effort | Depends on | Status |
|--------|-------|----------|--------|------------|--------|
| move-cars-to-shareable-structure | Los autos pasan a una estructura que se puede compartir | P1 | L | — | DONE (salió en la 1.1.2 el 2026-10-24; reglas publicadas y migración aplicada) |
| share-cars-with-family | El dueño puede compartir un auto con hasta 2 personas | P1 | L | move-cars-to-shareable-structure | DONE (revisado 2026-10-24; faltan CI, simulador de reglas, publicar reglas y prueba con dos cuentas) |
| invite-members-by-uid | Compartir con invitación que se acepta, y miembros por uid (#54, E2) | P1 | L | share-cars-with-family | IN PROGRESS (implementado en `feat/54-invitations`; faltan CI, simulador de reglas, publicar reglas, deploy, migración y prueba con dos cuentas) |
| transfer-car-ownership | El dueño le pasa el auto a un miembro (#65, E2) | P3 | M | invite-members-by-uid | IN PROGRESS (implementado en `feat/65-transfer-car`; faltan CI, simulador de reglas y publicar reglas) |
| member-roles | Roles por miembro: aprobación automática o solo lectura (#71, E2) | P4 | M | invite-members-by-uid | IN PROGRESS (implementado en `feat/71-member-roles`; faltan CI, simulador de reglas y publicar reglas) |
| cron-push-users-and-run-log | El cron recorre solo usuarios con push, lee en paralelo y registra cada corrida (#58, E3) | P2 | M | — | IN PROGRESS (implementado en `feat/58-cron-push-users`; faltan CI y una semana de `cronRuns` sin salteados) |
| member-and-instant-notifications | Avisar a los miembros y avisar aprobaciones, rechazos y trabajos para revisar (#61, E2) | P2 | L | invite-members-by-uid, cron-push-users-and-run-log | IN PROGRESS (implementado en `feat/61-member-notifications`; faltan CI, simulador de reglas, publicar reglas y prueba con dos cuentas) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (one-line rationale) | ARCHIVED.

## Dependency notes

- Grupo familiar: el PR 1 (`move-cars-to-shareable-structure`) ya salió. El PR 2 es `share-cars-with-family`. El PR 3 (`member-and-instant-notifications`, #61) está implementado sobre la rama de E3. La limpieza de los datos viejos: `members` salió en #66 (1.6.0); `users/{uid}/…` está en #64 (reglas sólo de lectura y borrado, y `scripts/cleanup-legacy.mjs`; faltan publicar las reglas y correr el script).

## Findings considered and rejected

- `collectionGroup` con los miembros copiados en cada documento hijo: descartado porque cambiar los miembros obligaría a reescribir todos los hijos del auto.
