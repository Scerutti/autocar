# Active changes

| Change | Title | Priority | Effort | Depends on | Status |
|--------|-------|----------|--------|------------|--------|
| move-cars-to-shareable-structure | Los autos pasan a una estructura que se puede compartir | P1 | L | — | DONE (revisado 2026-10-23; faltan typecheck, tests, simulador de reglas y migración, a cargo del operador) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (one-line rationale) | ARCHIVED.

## Dependency notes

- Es el PR 1 del grupo familiar. Lo siguen: el PR 2 (compartir, permisos por autor, aprobación de trabajos, logros y gastos por `createdBy` y `status`), el PR 3 (avisos del cron para los miembros, con estado de "avisado" por persona) y un cambio de limpieza que borra los datos viejos de `users/{uid}/…`. Ninguno está planificado todavía.

## Findings considered and rejected

- `collectionGroup` con los miembros copiados en cada documento hijo: descartado porque cambiar los miembros obligaría a reescribir todos los hijos del auto.
