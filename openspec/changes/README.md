# Active changes

| Change | Title | Priority | Effort | Depends on | Status |
|--------|-------|----------|--------|------------|--------|
| move-cars-to-shareable-structure | Los autos pasan a una estructura que se puede compartir | P1 | L | — | DONE (salió en la 1.1.2 el 2026-10-24; reglas publicadas y migración aplicada) |
| share-cars-with-family | El dueño puede compartir un auto con hasta 2 personas | P1 | L | move-cars-to-shareable-structure | DONE (revisado 2026-10-24; faltan CI, simulador de reglas, publicar reglas y prueba con dos cuentas) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (one-line reason) | REJECTED (one-line rationale) | ARCHIVED.

## Dependency notes

- Grupo familiar: el PR 1 (`move-cars-to-shareable-structure`) ya salió. El PR 2 es `share-cars-with-family`. Faltan planificar el PR 3 (avisos del cron para los miembros, con estado de "avisado" por persona y resumen diario de trabajos para revisar) y la limpieza que borra los datos viejos de `users/{uid}/…`.

## Findings considered and rejected

- `collectionGroup` con los miembros copiados en cada documento hijo: descartado porque cambiar los miembros obligaría a reescribir todos los hijos del auto.
