# Design: move-cars-to-shareable-structure

## Decisiones

### Modelo de datos

- **`cars/{carId}` de primer nivel.** Lleva los campos de hoy del auto más `ownerUid` (uid del dueño), `ownerName` (nombre de Google o null) y `members` (lista de mails en minúscula, como mucho 2; en este cambio siempre `[]`). `ownerName` se guarda ahora para que el PR 2 pueda mostrar "Compartido por …" sin otra migración.
- **Subcolecciones `cars/{carId}/rules|jobs|fuel|odometer`, con los mismos ids que hoy.** Los logros guardan `carId` y las URLs son `/autos/{carId}/…`: si los ids cambian, se rompen los dos.
- **Los documentos hijos conservan el campo `carId`**, aunque ahora esté en la ruta. Todo el cliente filtra y agrupa por `carId` (por ejemplo `DataProvider`, `carRecords` en `lib/achievements.ts`, gastos, reporte). Sacarlo obliga a tocar todo eso sin ganar nada. Las reglas exigen que coincida con el `carId` de la ruta.
- **Autoría: `createdBy` (uid) y `createdByName` (texto o null) en `jobs`, `fuel` y `odometer`.** No van en `rules`: el plan de mantenimiento es del dueño, y en el PR 2 los efectos de un trabajo aprobado los escribe la app del dueño. Se escriben solo al crear, nunca al editar. Para eso, seguí el patrón actual de `createdAt` en `saveJob` y `saveFuel` (el objeto `existing`). Las funciones de "Deshacer" (`restoreJob`, `restoreFuel`, `restoreReading`) tienen que volver a escribir los valores originales, así que los tipos `Job`, `FuelLoad` y `OdometerReading` en `lib/types.ts` suman `createdBy: string | null` y `createdByName: string | null`.
- **`jobs.status`: `'approved' | 'pending' | 'rejected'`.** En este cambio siempre se escribe `'approved'`, y un documento sin el campo se lee como `'approved'`. Nadie filtra por `status` todavía (eso es del PR 2). Se agrega ahora para no migrar dos veces.
- **El autor viaja como `actor: { uid: string; name: string | null }`.** Las funciones de `lib/db.ts` que escriben datos de autos reciben `actor` en lugar de `uid`: `createCar`, `updateCar`, `deleteCar`, `recordKm`, `syncCarKm`, `deleteReading`, `restoreReading`, `saveRule`, `deleteRule`, `restoreRule`, `saveJob`, `deleteJob`, `restoreJob`, `saveFuel`, `deleteFuel`, `restoreFuel`. `DataProvider` expone `actor` (con `user.displayName` de `useAuth`). Ajustes, push y logros siguen usando `uid`, porque siguen en `users/{uid}`.
- **Las funciones que borran o restauran un hijo ahora necesitan el `carId`** para armar la ruta (hoy `deleteJob(uid, jobId)` no lo recibe). Los objetos que tienen los formularios ya traen `carId`. Pasalo desde ahí.
- **`newId` para autos** pasa a generar el id en `collection('cars')`. `components/forms/car-form.tsx` lo genera antes de crear el auto, porque la foto se sube con ese id.

### Lectura en el cliente

- **Un listener por subcolección y por auto (4 por auto), más uno para los autos.** Los autos se escuchan con `where('ownerUid', '==', uid)`. La regla de lectura de `cars` depende de `resource.data.ownerUid`, y Firestore rechaza una consulta que no lo filtre así. Cuando aparece o desaparece un auto, se abren o se cierran sus 4 listeners y se sacan sus documentos.
- **Descartado: `collectionGroup` con `ownerUid` (o `members`) copiado en cada documento hijo.** Las reglas no pueden probar el acceso a un grupo de colecciones sin ese dato en cada documento, y en el PR 2 cambiar los miembros obligaría a reescribir todos los hijos del auto.
- **Trampa: hay que respetar el contrato de `subscribeUserData`.** Hoy llama a `onChange(patch, part, fromCache)` una vez por colección. `DataProvider` cuenta una parte como cargada (`loaded`) cuando llega su primer `onChange`, y como sincronizada (`synced`) cuando llega con `fromCache = false`. La corrección automática del km (`syncCarKm`) depende de `synced`. Con varios listeners por parte, la parte está cargada cuando **todos** los autos actuales entregaron su primera foto (y enseguida si no hay autos, una vez cargados los autos). `fromCache` es `true` si **alguna** de las fotos vino de la caché. Si esto se hace mal, la app queda cargando para siempre o corrige el km con datos incompletos.
- **El documento `users/{uid}` y `achievements` no cambian de lugar.** El cron recorre `users` para encontrar las cuentas.

### Reglas de Firestore (`firestore.rules`)

- **`match /cars/{carId}`**:
  - Leer y borrar: `resource.data.ownerUid == request.auth.uid`.
  - Crear: `request.resource.data.ownerUid == request.auth.uid`.
  - Editar: lo mismo, y además `ownerUid` no puede cambiar.
  - Todo exige `isAllowed()`, como hoy.
  - `validCar` suma `ownerUid`, `ownerName` y `members` (lista de hasta 2 mails).
  - **Trampa:** las reglas no tienen bucles, así que no se puede validar elemento por elemento. Usá el mismo truco que `optIds`: tamaño de la lista y largo de `join(',')`. `join` falla si hay algo que no es texto, y la regla deniega.
- **Hijos (`rules`, `jobs`, `fuel`, `odometer` bajo el auto).** El permiso se decide con el documento del auto:
  - Leer y borrar: con `get()`.
  - Crear y editar: con `getAfter()`.
  - **Trampa:** `createCar` crea el auto y su primera lectura en el mismo batch. Con `get()` el auto todavía no existe para la regla de la lectura, y el batch falla. `getAfter()` ve el estado después del batch.
  - **Trampa:** en un borrado, `getAfter()` del auto devuelve null si el auto se borra en el mismo batch. Por eso el borrado usa `get()`, que ve el estado de antes del pedido.
- **Validación de los hijos.** Cada `valid*` (`validRule`, `validJob`, `validFuel`, `validReading`) sigue validando todo el documento:
  - `carId` tiene que ser el de la ruta.
  - Crear exige `createdBy == request.auth.uid`. Editar exige que `createdBy` no cambie.
  - `createdByName` es texto de hasta 200 caracteres.
  - `status` acepta solo los tres valores.
- **Las reglas de `users/{uid}/cars|rules|jobs|fuel|odometer` se quedan como están.** Si hay que volver a la versión anterior de la app, sigue funcionando. Se sacan en el cambio de limpieza.
- **Comentarios en `firestore.rules`**: solo el que va justo encima de una `function` o un `match` y lo describe (CLAUDE.md). Los comentarios de la sección de validación ya explican el criterio: sumá las funciones nuevas con el mismo estilo.
- **No hacen falta índices compuestos**: `where('ownerUid', '==', …)` usa el índice automático de un campo. Si Firestore pide un índice, es una condición de STOP.

### Borrar un auto

- **Primero los hijos y el auto al final.** `deleteCar` hoy borra el auto y los hijos conocidos en un batch y después barre con una consulta lo que quedó. Con las reglas nuevas, cuando el auto ya no existe, la consulta y los borrados de los hijos fallan. Orden nuevo:
  1. Borrar los hijos conocidos.
  2. Consultar cada subcolección y borrar lo que quede.
  3. Borrar el auto en el último batch.
- **Costo aceptado**: el auto desaparece de la pantalla al final y no al instante.
- **Descartado: permitir borrar hijos cuando el auto no existe.** Cualquier cuenta podría borrar documentos huérfanos de otro con solo saber la ruta.

### Cron (`app/api/cron/daily/route.ts`)

- Por cada usuario: los autos con `where('ownerUid', '==', uid)` y los mantenimientos de la subcolección `rules` de cada auto, con el mismo tope `MAX_DOCS_PER_USER` en total.
- El `bulkWriter` actualiza `cars/{carId}/rules/{ruleId}`. Hoy recibe solo `ruleId`: `RuleNotificationUpdate` (en `lib/notifications.ts`) o el armado de la ruta tienen que conocer el `carId`. Sacalo de la regla.
- `lastNotifiedAt` y `lastNotifiedStatus` siguen en el mantenimiento. Pasan a ser por persona en el PR 3.

### Migración (`scripts/migrate-cars.mjs`)

- **Node con Admin SDK y las variables de `.env.local`**: `node --env-file=.env.local scripts/migrate-cars.mjs`. Usa las mismas `FIREBASE_ADMIN_*` y el mismo arreglo de la clave privada que `adminApp()` en `lib/firebase/admin.ts`. No lo importes: ese archivo tiene `import 'server-only'` y es TypeScript.
- **Sin flags no escribe nada (simulacro).** Con `--apply` escribe. En los dos casos imprime, por cuenta, cuántos autos y cuántos hijos copia, saltea u omite.
- **Solo crea: si el documento destino ya existe, lo saltea.** Así se puede correr de nuevo justo después del deploy para levantar lo que se cargó con la app vieja en el medio, sin pisar lo que ya se cargó con la nueva.
- **Datos que agrega:**
  - Autos: `ownerUid` (uid de la cuenta), `ownerName` (`displayName` de Admin Auth `getUser`, o null) y `members: []`.
  - Trabajos, cargas y lecturas: `createdBy` (uid del dueño) y `createdByName` (el mismo nombre).
  - Trabajos: `status: 'approved'`.
  - Los mantenimientos se copian tal cual.
- **Casos que informa y no copia:**
  - Hijos cuyo `carId` no corresponde a un auto de esa cuenta (huérfanos).
  - Un `cars/{carId}` que ya existe con otro `ownerUid` (conflicto).
- **No borra nada de `users/{uid}/…`.**
- **Separá la lógica pura de Firestore**: una función que, con los documentos leídos de una cuenta, devuelve qué escribir y qué informar. Así se puede probar con vitest. Las pruebas viven al lado, con el mismo patrón `*.test.*` que ya usa el repo.
- **Escrituras en tandas de 450 como mucho**, igual que `deleteRefs` en `lib/db.ts`.
- **Reproducir un secreto, nunca.** El script no imprime las variables de entorno ni el contenido de la service account.

### Procedimiento de salida (lo hace el usuario; el ejecutor lo documenta)

1. Avisar a los otros usuarios que no usen la app unos minutos.
2. Publicar `firestore.rules`.
3. Correr el simulacro y revisar los números.
4. Correr con `--apply`.
5. Mergear y esperar que Vercel publique.
6. Correr con `--apply` otra vez.
7. Hacer las verificaciones de `tasks.md`.

Este cambio no tiene que llegar a `main` sin seguir este procedimiento. Conviene publicarlo solo, sin mezclarlo con el PR 2.

## Orientación

- `lib/db.ts`: rutas, mapeo de documentos, suscripción y todas las escrituras. Acá cae la mayor parte del cambio.
- `lib/types.ts`: `Car`, `Job`, `FuelLoad` y `OdometerReading` suman los campos nuevos. Ahí también va el tipo `Actor`.
- `components/providers/data-provider.tsx`: estados `loaded` y `synced`, corrección del km y `actor` en el contexto.
- `components/forms/car-form.tsx`, `job-form.tsx`, `fuel-form.tsx`, `rule-form.tsx`, `components/km-form.tsx`, `app/(app)/autos/[carId]/page.tsx`: llaman a las funciones de escritura y pasan de `uid` a `actor`.
- `firestore.rules`: reglas de `cars/**`.
- `app/api/cron/daily/route.ts` y `lib/notifications.ts`: lectura y escritura del cron.
- `scripts/migrate-cars.mjs` (nuevo), con su lógica pura y su prueba.
- `package.json`: un script `migrate-cars` es opcional. No sumes dependencias: `firebase-admin` ya está.
- `INSTRUCTIONS.md`: secciones "Modelo de datos (Firestore)" y "Seguridad" (la línea de "Datos"), y una sección nueva con el procedimiento de migración.
- `CHANGELOG.md`: entrada en la próxima versión, en "Mantenimiento".
- **No tocar**: `lib/achievements.ts`, `lib/expenses.ts` y `lib/report.ts`. Siguen recibiendo los mismos arrays con `carId`.

## Comandos

Política del operador (memoria del proyecto): **el ejecutor no corre build, tests, typecheck ni lint**. Dice qué
correr y espera la salida que pega el operador. El CI (`.github/workflows/ci.yml`) corre `npx next typegen`,
`npm run typecheck` y `npm test` en cada PR. Vercel hace el build.

| Para qué | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npm run typecheck` | sale con código 0. Lo corre el operador. |
| Pruebas | `npm test` | todas pasan, incluidas las nuevas de la migración. Lo corre el operador. |
| Build | `npm run build` | lo hace Vercel. No lo corras. |
| Simulacro de la migración | `node --env-file=.env.local scripts/migrate-cars.mjs` | imprime los totales por cuenta y no escribe nada. Lo corre el operador contra producción. |
| Migración | `node --env-file=.env.local scripts/migrate-cars.mjs --apply` | los mismos totales, ahora escritos. Correrlo de nuevo saltea todo lo existente. Lo corre el operador. |
| Publicar reglas | `npx firebase-tools deploy --only firestore:rules` (o la consola de Firebase) | publica sin errores. Lo corre el operador. |

No hay emulador ni proyecto de prueba de Firebase. Las reglas se prueban con el **Simulador de reglas** de la
consola (Firestore → Reglas → Zona de pruebas) con los casos de `tasks.md`, antes de publicar.

Controles de lectura que el ejecutor sí puede correr:

- `grep -rn "'users', uid, \|collection('cars')\|collection('rules')" lib app components`: los únicos que tienen que quedar son los del documento `users/{uid}` y sus `pushSubscriptions` y `achievements`.
- `grep -rn "deleteJob(\|deleteFuel(\|deleteRule(\|restoreJob(\|restoreFuel(\|restoreRule(" app components`: todas las llamadas pasan `actor` y el `carId`.

## Enfoque sugerido

1. Tipos y `Actor` en `lib/types.ts`. Mapeo de los campos nuevos en `lib/db.ts` (`status` por defecto `'approved'`, autoría por defecto null).
   **Verificar**: el operador corre `npm run typecheck`. Los errores solo marcan las llamadas que hay que actualizar.
2. Rutas y escrituras en `lib/db.ts` (incluido el orden nuevo de `deleteCar`), y las llamadas en formularios y páginas.
3. `subscribeUserData` con listeners por auto y la suma de `loaded` y `fromCache`. `actor` en `DataProvider`.
   **Verificar**: el operador corre `npm run typecheck` y da 0.
4. `firestore.rules`.
   **Verificar**: el operador corre los casos del simulador de `tasks.md` y todos dan el resultado esperado.
5. Cron.
6. Script de migración, su lógica pura y sus pruebas.
   **Verificar**: el operador corre `npm test` y pasa todo.
7. Documentación y CHANGELOG.

## Condiciones de STOP

Pará y avisá (no improvises) si:

- El simulador de reglas muestra que el dueño no puede crear un auto con su primera lectura en el mismo batch, o no puede borrar los hijos antes que el auto.
- Firestore pide un índice compuesto para alguna consulta.
- Encontrás código que lee o escribe `users/{uid}/cars|rules|jobs|fuel|odometer` fuera de los archivos de "Orientación".
- Respetar el contrato de `loaded` y `synced` obliga a cambiar `DataProvider` más allá de la suscripción y `actor`.
- El cambio parece necesitar tocar logros, gastos, reporte o cualquier pantalla de forma visible.
- El simulacro de la migración informa conflictos (un `cars/{carId}` con otro dueño).
- Un control de verificación falla dos veces después de un intento razonable de arreglo.

## Notas de mantenimiento

- **PR 2 (compartir)**:
  - Suma la consulta `where('members', 'array-contains', email)` y los permisos del familiar en las reglas, filtra logros y gastos por `createdBy` y `status`, y agrega la UI.
  - Ojo: la regla "crear exige `createdBy == request.auth.uid`" impide que el dueño restaure ("Deshacer") algo que cargó un familiar. El PR 2 tiene que ajustarla.
- **PR 3 (avisos)**: el estado de "avisado" pasa del mantenimiento a cada persona, y el cron suma a los miembros con el `uid` que guarda `allowlist/{mail}`.
- **Limpieza (cambio aparte)**: borrar `users/{uid}/cars|rules|jobs|fuel|odometer` y sus reglas, después de unos días sin problemas en producción.
- **Qué mirar en la revisión**:
  - Las reglas de `get()` y `getAfter()`.
  - La suma de `loaded` y `fromCache` en la suscripción.
  - Que `createdBy` no se pise al editar.
  - El orden de `deleteCar`.
  - Que la migración saltee lo que ya existe.
