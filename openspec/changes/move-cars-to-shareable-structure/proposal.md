# Los autos pasan a una estructura que se puede compartir

> **Instrucciones para el ejecutor**: tenés el repo. Hacé tu propio reconocimiento de los archivos del alcance
> antes de cambiar nada. Esta carpeta te da las decisiones, los límites y los criterios de terminado; el
> "Enfoque sugerido" de design.md es un consejo, no una ley. Pasá cada control de verificación y confirmá el
> resultado esperado. Si pasa algo de "Condiciones de STOP" en design.md, pará y avisá: no improvises alrededor
> de una decisión que la realidad contradice. Al terminar, actualizá la fila de este cambio en
> `openspec/changes/README.md`. Saltealo solo si te despachó un revisor de `execute` que dijo que mantiene el índice.
>
> **Build y commits**: según la política del proyecto (citada en design.md, "Comandos"). No hagas commit, push,
> cambio de rama ni worktree salvo que esa política o el operador lo pidan. En este repo conviene usar `execute`
> en lugar de `/opsx-apply`.

## Estado

- **Prioridad**: P1
- **Esfuerzo**: L
- **Riesgo**: HIGH (mueve todos los datos de producción y cambia las reglas de Firestore; no hay entorno de prueba)
- **Depende de**: nada
- **Categoría**: migration
- **Planificado**: 2026-10-23
- **Origen**: ad hoc. Primer PR del "grupo familiar" (decisiones del usuario del 2026-10-23).

## Por qué

Hoy cada auto y todo lo que cuelga de él (mantenimientos, trabajos, cargas, km) vive en `users/{uid}/…`. Con
esa estructura, otra cuenta no puede ver ni cargar nada en ese auto sin abrirle todo el árbol del dueño. El grupo
familiar necesita que el auto sea la unidad que se comparte: el dueño y hasta 2 personas más. Este cambio mueve los
datos a `cars/{carId}` y deja grabado quién cargó cada cosa, **sin cambiar nada de lo que ve el usuario**. Así
el PR siguiente (compartir, permisos y aprobación de trabajos) se apoya en una base ya migrada y probada.

## Qué cambia

- Los autos pasan a `cars/{carId}`, con `ownerUid`, `ownerName` y `members` (siempre vacío en este cambio).
- Mantenimientos, trabajos, cargas y lecturas de km pasan a subcolecciones del auto (`cars/{carId}/rules|jobs|fuel|odometer`), con los mismos ids.
- Trabajos, cargas y lecturas guardan `createdBy` y `createdByName`. Los trabajos guardan `status` (en este cambio, siempre `approved`).
- La capa de datos del cliente (`lib/db.ts`, `DataProvider`) lee y escribe en la estructura nueva. Las escrituras reciben al autor.
- Reglas de Firestore nuevas para `cars/**`. Solo el dueño lee y escribe.
- El cron diario lee los autos y los mantenimientos de la estructura nueva.
- Un script de migración con Admin SDK (`scripts/migrate-cars.mjs`) que copia los datos actuales. Lo corre el usuario.
- Documentación: modelo de datos, seguridad, procedimiento de migración y CHANGELOG.

## Fuera del alcance

- **Compartir el auto, la vista del familiar, los permisos por autor y la aprobación de trabajos**: son el PR 2. Este cambio tiene que poder salir solo, sin cambios visibles.
- **Filtrar logros y gastos por `createdBy` o `status`**: PR 2. Hoy todo es del dueño y está aprobado, así que no cambia ningún número.
- **Estado de "avisado" por persona en el cron**: PR 3. Mientras haya un solo usuario por auto, el estado en el mantenimiento alcanza.
- **Borrar los datos viejos de `users/{uid}/…` y sus reglas**: es un cambio aparte, después de confirmar en producción que todo funciona. Mantenerlos permite volver atrás.
- **Nombres de las personas para mostrar ("Cargado por")**: solo se guarda el dato. La UI es del PR 2.
- **Una entrada en `lib/novedades.ts`**: no hay nada nuevo para el usuario.
