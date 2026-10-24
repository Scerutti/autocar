# Tasks: move-cars-to-shareable-structure

## Implementación

- [x] 1.1 `lib/types.ts`: tipo `Actor`. `Job`, `FuelLoad` y `OdometerReading` con `createdBy` y `createdByName`. `Job` con `status`.
- [x] 1.2 `lib/db.ts`: el mapeo lee los campos nuevos (`status` por defecto `'approved'`, autoría por defecto null).
- [x] 1.3 `lib/db.ts`: rutas nuevas (`cars/{carId}` y subcolecciones). `newId` de autos en `collection('cars')`.
- [x] 1.4 `lib/db.ts`: las escrituras reciben `actor`. Al crear se graban `createdBy` y `createdByName`, y al editar no se tocan. Los trabajos se graban con `status: 'approved'`. "Deshacer" conserva la autoría original.
- [x] 1.5 `lib/db.ts`: `createCar` graba `ownerUid`, `ownerName` y `members: []`. `updateCar` no toca esos campos.
- [x] 1.6 `lib/db.ts`: `deleteCar` borra los hijos conocidos, después lo que queda en cada subcolección, y el auto al final.
- [x] 1.7 `lib/db.ts`: `subscribeUserData` con los autos filtrados por `ownerUid`, 4 listeners por auto que se abren y cierran cuando cambian los autos, y la suma de `loaded` y `fromCache` de design.md.
- [x] 1.8 `components/providers/data-provider.tsx`: `actor` en el contexto. `syncCarKm` con `actor`.
- [x] 1.9 Formularios, `km-form.tsx` y la página del auto: pasan `actor` y, donde haga falta, el `carId`.
- [x] 1.10 `firestore.rules`: `match /cars/{carId}` y sus 4 subcolecciones, con `get()` y `getAfter()` como dice design.md. Los `valid*` suman los campos nuevos. Las reglas de `users/{uid}/…` quedan como están.
- [x] 1.11 Cron: autos por `ownerUid`, mantenimientos por auto, y la actualización en `cars/{carId}/rules/{ruleId}`.
- [x] 1.12 `scripts/migrate-cars.mjs`: simulacro por defecto, `--apply`, solo crea, informa huérfanos y conflictos, lógica pura separada.
- [x] 1.13 Pruebas de la lógica pura de la migración.
- [x] 1.14 `INSTRUCTIONS.md`: modelo de datos, línea de seguridad y sección "Migración a `cars/`" con el procedimiento de salida de design.md.
- [x] 1.15 `CHANGELOG.md`: entrada en "Mantenimiento" de la próxima versión. **No** sumes nada a `lib/novedades.ts`.

## Pruebas y verificación manual

**Pruebas nuevas (vitest)**, para la lógica pura de la migración. Casos:

- Una cuenta con 2 autos y sus hijos: cada auto sale con `ownerUid`, `ownerName` y `members: []`; cada trabajo, carga y lectura sale con `createdBy` y `createdByName`; cada trabajo sale con `status: 'approved'`; los mantenimientos salen sin cambios; los ids se mantienen.
- Un hijo con un `carId` que no es de la cuenta: queda informado como huérfano y no se escribe.
- Un destino que ya existe: se saltea y no se pisa.
- Un `cars/{carId}` que ya existe con otro dueño: queda informado como conflicto.

**Simulador de reglas** (consola de Firebase, antes de publicar). Usuario A es el dueño, usuario B es otra cuenta registrada en `allowlist`:

1. A lee `cars/{carDeA}` → permitido. B lee `cars/{carDeA}` → denegado.
2. A crea `cars/{nuevo}` con `ownerUid = A` → permitido. A crea `cars/{nuevo}` con `ownerUid = B` → denegado.
3. A cambia `ownerUid` de su auto → denegado.
4. A crea `cars/{carDeA}/fuel/{id}` con `createdBy = A` y el `carId` correcto → permitido. Con `createdBy = B` → denegado. Con otro `carId` → denegado.
5. A edita esa carga cambiando `createdBy` → denegado.
6. B crea una carga en `cars/{carDeA}/fuel` → denegado.
7. A crea un trabajo con `status = 'otro'` → denegado.

**En producción, después del procedimiento de salida** (con la cuenta del dueño):

1. Abrí la app. Se ven los mismos autos, con su foto, km y próximo mantenimiento, que antes de migrar.
2. Abrí un auto. Trabajos, combustible y km tienen la misma cantidad de registros que antes. Gastos muestra los mismos totales del año.
3. Cargá km. El km del auto se actualiza enseguida.
4. Cargá una carga de combustible, editala y borrala con "Deshacer". La carga vuelve igual.
5. Cargá un trabajo que marque un mantenimiento. El mantenimiento vuelve a "al día".
6. Creá un auto de prueba con una carga, y borralo. Desaparece, y en la consola de Firebase no queda nada en `cars/{ese id}` ni en sus subcolecciones.
7. Logros: no aparece ninguna celebración nueva y el conteo es el mismo.
8. Al día siguiente: en los logs de Vercel, el cron diario no tiene errores y los avisos llegan como siempre.

## Criterios de terminado

**Este es el contrato.** La revisión verifica estos resultados:

- [ ] `npm run typecheck` y `npm test` pasan (los corre el operador). El CI del PR está en verde.
- [x] Las pruebas de la migración cubren los 4 casos de arriba.
- [ ] Los 7 casos del simulador de reglas dan lo esperado (los confirma el operador).
- [x] Los controles con `grep` de design.md se cumplen.
- [x] Ninguna pantalla cambia: no hay textos ni componentes visuales nuevos.
- [x] No hay cambios fuera de los archivos de "Orientación" (`git status`).
- [x] No hay comentarios inline nuevos (CLAUDE.md).
- [x] El procedimiento de salida está en `INSTRUCTIONS.md`.
- [ ] La fila de este cambio en `openspec/changes/README.md` está actualizada.
- [ ] Después del deploy (lo confirma el operador): los 8 pasos de producción dan lo esperado.
