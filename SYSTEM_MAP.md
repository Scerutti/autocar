# AutoCar — System Map

Mapa técnico de navegación. Fuente de verdad: el código. Si un cambio agrega o cambia una ruta, una función de `lib/db.ts`, una colección o un campo, este archivo se actualiza en el mismo PR.

Relevado sobre `develop` @ v1.2.1 (2026-10-25).

---

## 1. Arquitectura y stack

| Capa | Tecnología | Dónde |
|---|---|---|
| Framework | Next.js 16.4 (App Router), React 19, TypeScript 5.7 | `app/` |
| UI | Tailwind 4, shadcn sobre `@base-ui/react`, `lucide-react` | `components/ui/`, `app/globals.css` |
| Auth | Firebase Auth (Google, popup → redirect en iOS PWA) | `components/providers/auth-provider.tsx` |
| DB | Cloud Firestore, **acceso directo desde el cliente** con caché persistente offline | `lib/firebase/client.ts`, `lib/db.ts` |
| Autorización | `firestore.rules` (cliente) + `authorize()` con Admin SDK (API routes) | `firestore.rules`, `lib/firebase/admin.ts` |
| Server | 8 Route Handlers (Node runtime) con `firebase-admin` | `app/api/**/route.ts` |
| Fotos | Cloudinary, subida firmada directa desde el navegador | `lib/cloudinary-*.ts` |
| Push | Web Push (VAPID, `web-push`), service worker `public/sw.js` | `lib/push-*.ts` |
| PDF | `@react-pdf/renderer` en el cliente | `components/report/` |
| Hosting | Vercel + Vercel Cron (2/día, la segunda retoma) + Analytics + Speed Insights | `vercel.json` |
| Tests | Vitest, sólo lógica pura de `lib/*.test.ts` | — |

**Patrón:** SPA client-side sobre Firestore (BaaS). No hay capa de API para CRUD: las pantallas llaman funciones de `lib/db.ts`, que escriben en Firestore, y las reglas validan. Las API routes existen sólo para lo que necesita un secreto (Admin SDK, Cloudinary, VAPID, cron).

```
UI (app/(app)/**/page.tsx, 'use client')
  ├─ lee:    useData() / useCar(carId)  ← DataProvider ← subscribeUserData() (onSnapshot)
  ├─ escribe: lib/db.ts (writeBatch / setDoc)  → Firestore → firestore.rules
  ├─ lógica pura: lib/{maintenance,fuel,odometer,expenses,pending,achievements,sharing,report}.ts
  └─ fetch + Bearer ID token → app/api/* → firebase-admin / Cloudinary / web-push
```

### Carpetas

| Ruta | Contenido |
|---|---|
| `app/(app)/` | Pantallas autenticadas. `layout.tsx` = gate de auth + `DataProvider` + registro automático + `AppShell` |
| `app/login/` | Login Google. `?next=` (validado con `safeNextPath`) |
| `app/api/` | Route Handlers (ver §2.1) |
| `components/forms/` | `car-form`, `job-form`, `fuel-form`, `rule-form` (crear y editar) |
| `components/providers/` | `AuthProvider`, `DataProvider`, `Providers` (toasts, confirm, SW) |
| `components/achievements/`, `invites/`, `novedades/`, `outbox/`, `pending/`, `report/` | Features transversales |
| `lib/` | Data layer (`db.ts`), dominio puro, helpers de servidor (`*-server.ts`, `firebase/admin.ts`, `import 'server-only'`) |
| `lib/types.ts` | Todas las entidades, enums y presets |
| `scripts/` | Migración `users/{uid}/…` → `cars/…`, íconos, manual PDF |
| `openspec/changes/` | Planes de cambios (OpenSpec) |

### Convenciones

- Todo componente de pantalla es `'use client'`. Datos siempre por `useData()` / `useCar()`, nunca leyendo Firestore en la pantalla.
- Toda escritura recibe `actor: Actor` (`useData().actor`) → se graba `createdBy`/`createdByName` al crear.
- Fechas de calendario: `ISODate` `'YYYY-MM-DD'` (string). Instantes: `Date` en la app, `Timestamp` en Firestore.
- Lectura tolerante: `carFrom/jobFrom/...` en `lib/db.ts` y `lib/parse.ts` normalizan docs viejos (campos faltantes → defaults).
- Moneda ARS. Textos de UI en español rioplatense.
- Build de producción: `next build --webpack` (Turbopack rompe `firebase-admin` en Vercel). No tocar el override de `jose`.

---

## 2. Registry

### 2.1 API routes (`app/api`)

Todas responden JSON. Errores: `{ error: string }` con mensaje listo para mostrar.

Auth:
- **verifyUser**: header `Authorization: Bearer <Firebase ID token>` (`useAuth().getToken()`). Sin token o token inválido → 401.
- **authorize**: `verifyUser` + existe `allowlist/{emailLower}` y el email está verificado. Si no → 403. Si falla la lectura → 500.

#### `POST /api/access`
- Propósito: registro automático de la cuenta en `allowlist` la primera vez que entra.
- Auth: `verifyUser` (no exige allowlist).
- Input: sin body.
- 200: `{ ok: true }` · 401 · 403 `email no verificado` · 500.
- Interno: `accountRef(email).set({ uid, createdAt })` si no existe. Lo llama `Join` en `app/(app)/layout.tsx` cuando la carga de Firestore da `permission-denied`.

#### `POST /api/cloudinary/sign`
- Propósito: firma una subida de una foto a Cloudinary (una firma = una foto).
- Auth: `authorize`.
- Input: sin body.
- 200: `{ params: { folder: "autocar/{uid}", public_id: uuid, overwrite: "false", allowed_formats: "jpg,png,webp", transformation: "c_limit,w_1600,h_1600", timestamp }, signature, apiKey, cloudName }`
- Errores: 401 · 403 · 429 `límite diario` · 500 (sin config / falla de cuota).
- Interno: transacción sobre `usage/{uid}` `{ day, photos }` (tope 15 firmas/día, el mensaje dice 10 fotos). Cliente: `uploadImage(blob, idToken)` en `lib/cloudinary-client.ts` → luego POST directo a `api.cloudinary.com/v1_1/{cloud}/image/upload` → `{ url: secure_url, publicId }`.

#### `POST /api/cloudinary/delete`
- Propósito: borrar una foto del usuario.
- Auth: `authorize`.
- Input: `{ publicId: string }` — tiene que empezar con `autocar/{uid}/`, sólo `[A-Za-z0-9/_-]` (`isOwnPublicId`).
- 200: `{ result: "ok" | "not found" }` · 400 `Imagen inválida` · 401 · 403 · 500 (sin config) · 502 (Cloudinary caído o rechazó, timeout 10 s).
- Interno: `destroyImage(publicId)` (`lib/cloudinary-server.ts`: `image/destroy` firmado con `invalidate`, timeout 10 s → `DestroyResult`), el mismo que usa `purgeCar`.
- Cliente: `deleteImage(publicId, idToken)` (traga errores; la foto queda huérfana).

#### `DELETE /api/cars/[carId]`
- Propósito: terminar de borrar un auto del dueño con su historial, sus invitaciones y su foto. La app primero lo marca (`markCarDeleted`) y llama a esta ruta cuando el servidor confirma la marca (`purgeCarInBackground`, `lib/cars-client.ts`, en segundo plano y sin avisar si falla: lo termina el barrido del cron).
- Auth: `authorize` + ser el dueño (`carDeleteDecision`, `lib/cars.ts`).
- Input: sin body; `carId` del path (`params` es una promesa), validado con `isCarId` (`[A-Za-z0-9_-]{1,100}`).
- 200: `{ deleted: true, photo: 'none' | 'deleted' | 'pending' | 'abandoned' }`; auto inexistente → 200 `{ deleted: true }` (idempotente: dos llamadas dan 200 las dos veces) · 400 `Auto inválido` · 401 · 403 (no es el dueño) · 500.
- Interno: lee `cars/{carId}` (`serverCarFrom`) → `carDeleteDecision(car, uid)`: `gone` (no existe), `forbidden`, `mark` (sin marca: `update({ deletedAt: serverTimestamp() })` antes de borrar) o `purge` (ya marcado) → `purgeCar(carRef, data)` (`lib/cars-server.ts`, `import 'server-only'`): borra `invites where carId == carId` y `notices where carId == carId` (los avisos de `/api/notify/job`; batches de 450), cada subcolección del auto con `recursiveDelete` (`listCollections`: `rules`, `jobs`, `fuel`, `odometer` y cualquier otra), después la foto con `destroyImage` sólo si es de la carpeta del dueño actual (`purgePhotoId`; la de otra carpeta, por ejemplo del dueño anterior a un `transferCar`, queda en Cloudinary) y al final el documento del auto. Si Cloudinary falla, `photoFailureAction` (`lib/cars.ts`) con los fallos anteriores: `retry` suma `purgeAttempts` (y `photoFailedAt` la primera vez) en el auto y responde `photo: 'pending'` (el auto marcado, sin historial, queda para el barrido); `give-up` (este fallo es el 3.º, `MAX_PURGE_ATTEMPTS`, o el primero fue hace 7 días o más, `PHOTO_GIVE_UP_MS`) borra el auto igual con un `console.error` del `publicId` y responde `photo: 'abandoned'` (la foto queda huérfana en Cloudinary). Un `NOT_FOUND` (código 5) en el medio cuenta como borrado. `maxDuration = 60`.

#### `POST /api/push/test`
- Propósito: notificación de prueba a los dispositivos del usuario.
- Auth: `authorize`.
- Input: sin body.
- 200: `{ sent: number }` · 401 · 403 · 500.
- Interno: `sendToUser(uid, [payload])` → lee `users/{uid}/pushSubscriptions` (5 más recientes), borra las que dan 404/410. Lo llama `app/(app)/ajustes/page.tsx`.

#### `POST /api/notify/job`
- Propósito: aviso push al instante cuando un miembro envía un trabajo para revisar (`submitted`), o cuando el dueño aprueba (`approved`) o rechaza (`rejected`) el trabajo de un miembro.
- Auth: `authorize`.
- Input: `{ carId: string, jobId: string, event: 'submitted' | 'approved' | 'rejected' }`.
- 200: `{ sent: number, duplicate?: true }` · 400 · 401 · 403 · 404 · 500.
- Interno: lee `cars/{carId}` y `cars/{carId}/jobs/{jobId}` en paralelo (un auto con `deletedAt` cuenta como inexistente: 404) → valida autoría, rol y estado con `planJobNotification({ uid, car, job, event })` → idempotencia en `notices/{jobId}_{event}_{revision}` con `.create({ carId, jobId, event, revision, createdAt })` (si da código 6 `ALREADY_EXISTS`, responde `{ sent: 0, duplicate: true }`) → `sendToUser(recipientUid, [message])`. Cliente: `notifyJobInBackground` (`lib/notify-client.ts`) en `job-form.tsx`, enganchado al `.then` de la escritura (si se guarda sin señal y sincroniza con la app abierta, avisa al sincronizar; si la app se cierra antes, `submitted` queda cubierto por el resumen diario del cron y `approved`/`rejected` se ven en la app).

#### `POST /api/notify/rules`
- Propósito: aviso push al instante al resto del auto (dueño y miembros con `sharedCars !== false`, excepto quien llamó) cuando un cambio deja algún mantenimiento activo en `soon` o `overdue` (`didRuleEscalate`).
- Auth: `authorize` + ser dueño o miembro (`memberUids`) del auto.
- Input: `{ carId: string, ruleIds?: string[] }`.
- 200: `{ sent: number }` · 400 · 401 · 403 · 404 · 500.
- Interno: lee `cars/{carId}` (con `deletedAt`: 404), sus `rules` y, de la fecha más nueva a la más vieja (tope 1000 cada uno), `jobs` y `odometer` en paralelo → proyecta los mantenimientos en memoria (`projectRules(rawRules, jobs, readings)` filtrando por `ruleIds` si vienen) y el km del auto (`carKmFrom(readings)`) → por cada destinatario lee `users/{recipientUid}` (saltea miembros con `sharedCars === false`) → calcula alertas con `planRuleAlerts` → por cada mantenimiento que escaló reclama el cambio en una transacción (`claimRuleNotice`) sobre `users/{recipientUid}/ruleNotices/{ruleId}` y envía push con `sendToUser`. Cliente: `checkCarRuleEscalations` (`lib/notify-client.ts`), que muestra un `toast.warning` local a quien hizo el cambio (`announceRuleEscalations`) y sólo llama al servidor si `escalations.length > 0` y el auto tiene miembros, pasando los `ruleIds` escalados. Llamado desde `km-form.tsx`, `autos/[carId]/page.tsx`, `fuel-form.tsx` y `job-form.tsx`.

#### `GET /api/cron/daily`
- Propósito: avisos push diarios de mantenimientos por vencer/vencidos y recordatorio semanal de km, y barrido de autos borrados.
- Auth: `Authorization: Bearer $CRON_SECRET` (comparación en tiempo constante). Si no → 401.
- Schedule: `0 12 * * *` y `0 14 * * *` UTC (`vercel.json`, misma ruta; en Hobby cada una corre una vez por día en cualquier minuto de esa hora). `maxDuration = 60`, presupuesto 40 s, 5 usuarios en paralelo, en orden de uid.
- Qué hace cada llamada sale de `cronRuns/{YYYY-MM-DD}` (fecha UTC), tomado en una transacción (`claimRun`), no del schedule: sin registro procesa a todos; con una corrida que terminó sin dejar a nadie afuera (`finishedAt` y `skipped == 0`) responde `{ ok: true, date, alreadyDone: true, sweep }` (sólo hace el barrido); si otra llamada está en curso (`runningSince` de hace menos de 60 s y `finishedAt == null`) responde `{ ok: true, date, busy: true }`; si no (quedaron usuarios afuera, o la anterior se cortó), sigue con los uids `> cursor`. Los usuarios con error no se reintentan (quedan en `failures`). Para repetir una corrida completa el mismo día: borrar `cronRuns/{fecha}` en la consola.
- 200: `{ ok: true, date, candidates, processed, skipped, errors, sent, report: { uid, messages, sent, error? }[], sweep: { found, purged, photoPending, photoAbandoned, errors, error? } }` (los números son de esta corrida; los del día quedan en `cronRuns`, guardado con un reintento; si aun así falla el cierre, responde 500 con `ok: false`). Si `skipped > 0` o hay errores, `console.error` con el resumen y `failures` (para la alerta en los logs de Vercel).
- Candidatos: `collectionGroup('pushSubscriptions').select()` → uids de `users/{uid}/pushSubscriptions/{id}` sin repetir y ordenados (`candidateUids`, `lib/cron-run.ts`). `users/{uid}` se lee dentro de `processUser`, sólo por cada usuario que efectivamente se procesa (no se pagan las lecturas de los que quedan afuera por tiempo). Un usuario sin suscripciones no genera ninguna lectura de autos, mantenimientos ni lecturas de km (consecuencia aceptada: a quien no tiene push no se le limpia `lastNotifiedStatus` cuando un mantenimiento vuelve a estar al día; se limpia en la primera corrida después de suscribirse). Otra consecuencia aceptada: quien se suscribe entre la primera y la segunda corrida con un uid menor o igual al cursor recibe su primer aviso al día siguiente. Un uid con suscripciones sin `users/{uid}` cuenta como procesado sin mensajes. Dos corridas completas el mismo día (sólo si la primera se cortó después de 60 s): los mantenimientos ya avisados se saltean por `lastNotified*` y el pedido de km se repite, pero el `tag` lo reemplaza en el dispositivo.
- Barrido de autos borrados (`sweepDeletedCars`): corre en paralelo con los usuarios cuando la llamada toma el turno y también, sin los avisos, cuando el día ya está hecho (`alreadyDone`); no corre si la llamada da `busy` (barre la que está en curso). `cars where deletedAt < now - 1 h` (`purgeCutoff`, `PURGE_DELAY_MS`; índice simple automático), `orderBy('deletedAt')`, `limit(20)` → `purgeCar` de a uno, sin empezar otro pasado `SWEEP_BUDGET_MS = 30_000` desde el arranque (menor que el presupuesto de 40 s de los usuarios: un auto con mucho historial tarda y tiene que terminar antes de `maxDuration`; si se corta, `purgeCar` lo retoma en la próxima corrida). Nunca tira: los errores se cuentan en `sweep` y van a `console.error`, sin afectar los avisos; si `photoPending > 0`, también un `console.error`. Un auto cuya foto falla siempre no traba el barrido: se borra igual al 3.er intento o a los 7 días (`photoFailureAction`). No toca el turno, el cursor ni las métricas de `cronRuns`, y el cierre de la corrida se guarda sin esperarlo. Cubre la PWA cerrada antes de llamar a `DELETE /api/cars/[carId]`, la marca que se sincronizó sin la app abierta y la foto que quedó `pending`.
- Interno: por cada candidato → `users/{uid}` → `cars where ownerUid == uid` y, si `settings.sharedCars !== false`, `cars where memberUids array-contains uid` (hasta 1000 autos en total, sin los marcados con `deletedAt`, cuyos `ruleNotices` quedan huérfanos) → en paralelo: `cars/{id}/rules` de todos los autos (`limit(1000)` por auto y recorte a 1000 en total), la lectura de más km de cada auto (`topReadingOf`: `cars/{id}/odometer` `orderBy('km', 'desc').limit(1)`), `users/{uid}/ruleNotices` (`limit(1000)`) y, en los autos propios compartidos, `cars/{id}/jobs where status == 'pending'` (`pendingReviewOf`) → el km de cada auto para los avisos es esa lectura (`carKmForNotifications`: `currentKm` y `kmUpdatedAt` de la lectura, o lo guardado si no tiene; `avgKmPerDay` del auto), no el `currentKm` guardado → `planDailyNotifications()` (`lib/notifications.ts`, máx. 6 mensajes; saltea los recordatorios cumplidos `completedByJobId != null`; saltea el pedido de km en autos donde el usuario es `viewer` vía `canWrite`; reserva 1 lugar para `"Tenés N trabajo(s) para revisar"` con `REVIEW_TAG` si hay pendientes; usa el estado de avisado por persona `effectiveRuleNotice`, tomando `rule.lastNotified*` como semilla inicial del dueño si aún no tiene doc en `ruleNotices`) → `sendToUser()` → `bulkWriter` escribe `users/{uid}/ruleNotices/{ruleId}` sólo de lo entregado (`updatesToPersist`) y, si se leyeron todos los autos y mantenimientos (`sharedCars !== false` y sin llegar al tope), borra los `ruleNotices` huérfanos (`orphanNoticeIds`). Usa la proyección guardada de cada mantenimiento (`lastDone*`, `completedByJobId`), sin leer trabajos aprobados. `serverRuleFrom` (`lib/push-server.ts`) tiene la misma lectura tolerante de la base que `ruleFrom` de `lib/db.ts`.

### 2.2 Data layer (Firestore desde el cliente, `lib/db.ts`)

Estos son los "endpoints" reales del CRUD. Todas son `async`, resuelven cuando el servidor confirma (offline quedan pendientes; envolver con `settle(p, errorTitle? | track?)` de `lib/use-saver.ts`, que devuelve `SaveStatus = 'saved' | 'offline' | 'unchanged'` después de esperar hasta `OFFLINE_GRACE_MS` (2,5 s) y, si el servidor rechaza después, avisa con un toast `errorTitle` + `errorMessage`). Con `track = { uid, entry }` (los formularios de carga, trabajo, km, mantenimiento y auto, alta y edición) la escritura va antes a la bandeja de lo que no se sincronizó (ver **Bandeja** abajo). Errores de permisos: `FirebaseError` `code: 'permission-denied'`. Editar un registro que otro dispositivo borró: `code: 'not-found'` (`errorMessage` → "Ese registro se borró en otro dispositivo."; `useSaver().run` lo muestra en un toast).

**Bandeja** (`lib/outbox.ts`, `components/outbox/outbox.tsx`): lo que el usuario guardó y el servidor todavía no confirmó, en localStorage de este dispositivo (`autocar:outbox:{uid}`, `outboxKey`; vía `lib/local-store.ts`, entre pestañas por el evento `storage`). Entrada `OutboxEntry = { id, kind: 'fuel'|'job'|'km'|'rule'|'car', carId, carLabel, label, payload, createdAt (ms), state: 'pending'|'failed', error?, conflict? }`; `payload = { recordId, data, original }` (+ `followUp` en `job`, `initialKm` en `car`): `data` es el input de la función de `lib/db.ts` (`FuelInput`, `JobInput`, `KmInput { km, date }`, `RuleInput`, `CarInput` sin la foto), `original` los mismos campos del registro como estaban al abrir el formulario (null = alta) y `recordId` el id del documento, generado antes de escribir (`newChildId`/`newCarId`, que reciben `saveFuel`, `saveJob`, `saveRule`, `recordKm`, `createCar`).
- `settle` registra la entrada (`pending`) antes de esperar. Confirma el servidor → se borra. Rechaza después del timeout → `failed` con el motivo y el toast dice que quedó en Pendientes. Rechaza antes → el error lo muestra el formulario (sigue abierto con los datos) y la entrada se borra, salvo que ya estuviera (reintento o borrador) o que sea `not-found` (el registro se borró en otro dispositivo y la pantalla pasa a "no existe"), que queda `failed`; en el `not-found`, el toast de `useSaver().run` dice que quedó en Pendientes. El motivo es `outboxFailure` (`lib/use-saver.ts`): `errorMessage`, salvo `permission-denied`, que es `deniedReason` (nunca "Probá cerrar sesión…"). `setWaiting`/`isWaiting`: las que espera esta pestaña.
- **Después de recargar** (`OutboxSync`, en `app/(app)/layout.tsx`): la promesa se perdió, pero Firestore vuelve a mandar la escritura desde su caché. Las entradas `pending` al abrir que esta pestaña no espera se resuelven cuando `waitForServerWrites()` (`waitForPendingWrites`) termina: `serverDocData(outboxDocPath(entry))` (`getDocFromServer`) y `checkServer` (pura) → `ServerCheck`:
  - `saved`: un alta cuyo documento existe, o una edición cuyo documento tiene los valores que cambió (`expectedFields` = `changedFields(original, data)`) → se borra.
  - `not-saved`: el documento no existe, o en los campos que difieren sigue el valor de `original` → `failed` con `NOT_SAVED` (Reintentar, Editar, Descartar).
  - `changed`: en alguno de esos campos hay otro valor (otro dispositivo lo cambió) → `failed` con `CHANGED_ELSEWHERE` y `conflict: true`: sin Reintentar (pisaría lo del otro dispositivo), sólo Editar (lo de ahora con los cambios de la entrada encima, `draftSeed`) y Descartar.
  - Sin permiso para leerlo (`permission-denied`) → `failed` con `deniedReason(entry, carVisible)`: un alta, `NOT_SAVED` (la regla de lectura mira el documento, que no existe), salvo que su auto ya no esté en `carById`; una edición o un auto que ya no está, `NO_ACCESS` ("Ya no tenés acceso a este auto."). Sin conexión → queda `pending`.
  - Al abrir también borra las de más de `OUTBOX_DAYS` (30) días (`pruneOutbox`; `useOutbox` tampoco las muestra). Borrar la bandeja al cerrar sesión es #62.
- Leer, cambiar y escribir la bandeja (`updateOutbox`) no es atómico entre pestañas: si dos escriben casi a la vez, gana la última (puede desaparecer una `failed` o volver una ya confirmada, que la reconciliación resuelve al abrir). Aceptado: la ventana es de milisegundos.
- Borrados con "Deshacer" (`removeWithUndo`), aprobar/rechazar trabajos, invitaciones y miembros no pasan por la bandeja. Un cambio sólo de la foto del auto tampoco (`car-form` lo guarda sin entrada: la foto no viaja en la entrada y no habría campos que reintentar ni comparar).
- Reintentar (`useOutboxActions`) mide una edición contra el `original` de la entrada sobre el registro actual; la del auto escribe sólo lo que cambió (`updateCar(actor, id, changedFields(original, data))`; nada = `'unchanged'`).

**Editar = `update` de lo que cambió** (`saveJob`, `saveFuel`, `saveRule`): se compara el borrador con el registro como lo abrió el formulario (`changedFields`, `lib/utils.ts`), así dos dispositivos que cambian campos distintos no se pisan. Crear sigue siendo `set`. Si no cambió nada, no se escribe nada y la función devuelve `WriteOutcome` `'unchanged'` (`settle` → `'unchanged'`, `toastSaved` → "Sin cambios"); si no, `'saved'`. Un `update` sobre un registro borrado falla con `not-found` y no lo vuelve a crear.

Leyenda Auth: **O** = dueño del auto (`car.ownerUid == uid`), **M** = miembro (`uid in car.memberUids`; el mail no da acceso), **U** = el propio usuario (`users/{uid}`).

**Roles del miembro** (`memberProfiles[uid].role`; sin rol o sin perfil = `editor`; `memberRole(car, uid)`): `editor` carga combustible, km y trabajos, y sus trabajos esperan la aprobación del dueño (lo de antes); `trusted` igual, pero sus trabajos nuevos se crean `approved` (`approvesOwnJobs`); `viewer` sólo lee: donde la tabla dice M, un `viewer` no escribe nada (ni lo que cargó antes), salvo salir del auto (`canWrite(car, uid)`). Un trabajo pendiente de antes de pasar a `trusted` sigue pendiente; un trabajo aprobado del miembro sólo lo edita o borra el dueño. Al aceptar una invitación se entra como `editor`. Lo cambia el dueño con `setMemberRole`.

#### Lectura

| Función | Input | Output / efecto |
|---|---|---|
| `subscribeUserData(uid, email, onChange, onError)` | `email` en minúscula o null | Listeners: `users/{uid}`, `users/{uid}/achievements`, `cars where ownerUid==uid` ∪ `cars where memberUids array-contains uid`, y por auto `rules`, `jobs`, `fuel`, `odometer`; `invites where ownerUid==uid` (parte `invites`) y `invites where emailKey==canonicalEmail(email) and status=='pending'` (parte `myInvites`). Emite `Partial<UserData>` por parte. Crea `users/{uid}` con `DEFAULT_SETTINGS` si no existe. Los autos marcados como borrados (`deletedAt`, leído con `serverTimestamps: 'estimate'` para que también desaparezcan sin señal) se filtran y se cierran sus listeners. Auto revocado (`permission-denied`) → se quita sin error. Una consulta de compartidos o de invitaciones con `permission-denied` (reglas sin publicar) cuenta como vacía. |
| `useData()` | — | `UserData` + `{ uid, email, actor, loading, error, today, carById: Map, rulesByCar: Map<carId, RuleWithState[]>, byCar: Map<carId, { rules, jobs, fuel, readings }> }`. `byCar`: los registros de cada auto de `cars`, agrupados una sola vez por cambio (`groupByCar`, `lib/by-car.ts`), con los mantenimientos ya proyectados y cada lista en el orden de la completa; un auto sin registros tiene listas vacías y lo de un auto que no está en `cars` queda afuera. El km de cada auto, `rulesByCar`, la proyección (por auto), la corrección del km, la reconciliación y `useCar` leen de ahí. `invites`: las que mandé como dueño (todos los estados); `myInvites`: las pendientes para mi mail, sin las vencidas (`isInviteOpen` al recalcular). `rules` son todos los mantenimientos (también los cumplidos) con la proyección calculada en memoria (`projectRules` con los trabajos y las lecturas), así la UI no espera a que se guarde; `rulesByCar`, sólo los activos (`activeRules`). Jobs/fuel ordenados por fecha desc. `car.currentKm`/`kmUpdatedAt` = los de la lectura más alta (`topReading`) aunque el guardado sea mayor o menor; sin lecturas, lo guardado. |
| `useCar(carId)` | — | `{ car: Car \| null, rules: RuleWithState[] (activos), completed: MaintenanceRule[] (cumplidos), allRules: MaintenanceRule[] (todos), jobs, fuel, readings }`, todo de `byCar` (sin filtrar las listas completas); jobs/fuel/readings por fecha desc. Un auto que no existe: listas vacías |

`UserData = { settings: UserSettings, cars: Car[], rules: MaintenanceRule[], jobs: Job[], fuel: FuelLoad[], odometer: OdometerReading[], achievements: AchievementRecord[], invites: Invite[], myInvites: Invite[] }`

#### Autos — `cars/{carId}`

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `newCarId()` / `newChildId(carId, sub)` | — | — | `string` (id antes de crear, para la foto o para avisar un trabajo nuevo) |
| `createCar(actor, data: CarInput, initialKm, carId?)` (`car-form` genera `carId` antes, para la bandeja) | U (queda O) | `CarInput = { brand, model, version, year, plate, fuelTypes, photoUrl?, photoPublicId? }` | batch: `cars/{id}` (`ownerUid`, `ownerName`, `memberUids: []`, `memberProfiles: {}`, `currentKm`, `kmUpdatedAt`, `avgKmPerDay: null`, `createdAt`) + `odometer` `source:'initial'`, `sourceId: null`, `createdAt`. → `carId` |
| `updateCar(actor, carId, Partial<CarInput>)` | O | — | `cars/{id}` |
| `markCarDeleted(actor, { invites }, carId)` | O | `invites`: las mías (`useData()`) | Un batch: `update` sólo de `deletedAt: serverTimestamp()` (`ownerMarkDeleted` en las reglas) + las invitaciones pendientes del auto a `revoked` (`ownerRevoke`), así nadie acepta una mientras el servidor no las borra. El auto desaparece al instante, también sin señal; desde ahí nadie crea ni edita nada en él. `car-form` hace `settle(markCarDeleted)` después de navegar a `/` y, cuando el servidor confirma, `purgeCarInBackground` (`DELETE /api/cars/[carId]`); si la app se cierra antes, lo termina el barrido del cron |
| `removeMember(actor, car, member: CarMember)` | O | `CarMember = { uid, email, name }` de `carMembers(car)` | `memberUids: arrayRemove(uid)` y `memberProfiles.{uid}: deleteField()` |
| `transferCar(actor, { invites }, car, to: CarMember, myEmail)` | O | `to`: un miembro; `invites`: las mías (`useData()`); `myEmail`: el del login | Un batch: `cars/{id}` `update` con `transferPatch` (`ownerUid = to.uid`, `ownerName` = el de su perfil, `memberUids` como lista entera: sin `to` y conmigo, `memberProfiles.{yo}` = `{ email, name }` sin rol (`editor`), `memberProfiles.{to}: deleteField()`, y con él su rol) + `delete` de cada invitación del auto, con cualquier estado (el id es fijo y sólo su dueño la vuelve a mandar o la borra). El dueño anterior queda como miembro |
| `setMemberRole(actor, car, uid, role: MemberRole)` | O | un miembro (`uid` de `memberUids`) | `update` sólo de `memberProfiles.{uid}.role` (`setRolePatch`); nada más del auto |
| `leaveCar(actor, car)` | M (también `viewer`) | — | `memberUids: arrayRemove(uid)` y `memberProfiles.{uid}: deleteField()` |

#### Invitaciones — `invites/{carId}_{emailKey}`

Una por auto y mail canónico (`inviteId(carId, email)`); volver a invitar pisa la misma. El auto le aparece al invitado recién cuando acepta (`memberUids`).

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `inviteMember(actor, car, email)` | O | validar antes con `memberError(car, invites, email, { ownerEmail, now })` (`lib/sharing.ts`) | `set` `{ carId, ownerUid, ownerName, carLabel, email, emailKey, status:'pending', createdAt, expiresAt: +14 días, respondedAt: null, acceptedUid: null }` |
| `revokeInvite(actor, invite)` | O | pendiente | `status:'revoked'` |
| `getInvite(id)` | O, invitado | — | Lee (`getDoc`). `null` si no existe; de otra cuenta (o inexistente, para quien no es el dueño) → `permission-denied` |
| `acceptInvite(actor, invite, email)` | invitado | pendiente sin vencer; `email`: el del login | batch: invitación `{ status:'accepted', acceptedUid: uid, respondedAt: serverTimestamp() }` + auto `{ memberUids: arrayUnion(uid), memberProfiles.{uid}: { email, name } }` |
| `declineInvite(actor, invite)` | invitado | pendiente sin vencer | `{ status:'declined', acceptedUid: uid, respondedAt: serverTimestamp() }` |

#### Km — `cars/{carId}/odometer/{id}`

Dos tipos de lectura:
- **Sin `sourceId`** (`initial`, `manual` y las viejas): id al azar. Se cargan con `recordKm` y se borran con `deleteReading`. Una manual de hoy lleva la hora en que se cargó; una con fecha pasada, el mediodía de ese día (`readingDateOf`).
- **Vinculadas** (`source` `'fuel'` o `'job'` + `sourceId`): una por carga o trabajo aprobado con km, con id `fuel-{id}` / `job-{id}` (`linkedReadingId`), fecha = la del registro a las 12:00 (`readingDateOf`) y `createdBy` = autor del registro. Las escribe `writeLinkedReading` (interna de `lib/db.ts`) en el mismo batch que la carga o el trabajo: con km la pone o la pisa (aunque sea menor al km actual), sin km o al borrar el registro la borra, y actualiza `currentKm`, `kmUpdatedAt`, `avgKmPerDay` con `carKmFrom` sobre las lecturas resultantes (el km puede bajar). No se borran desde la pestaña Km.
- Toda lectura nueva graba `createdAt` (cuándo se cargó en la app, para los logros). Al pisar una vinculada se conserva el `createdAt` que tenía en memoria. Las de la 1.3.0 o anteriores no lo tienen (`null`).

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `recordKm(actor, car, readings, km, date: ISODate, readingId?)` | O, M (no `viewer`) | validar antes con `validateKmReading(km, date, lecturas del auto)` (`lib/odometer.ts`); `date` = hoy por defecto en `km-form`, nunca futura | lectura `source:'manual'`, `sourceId: null`, id `readingId` (`km-form` lo genera antes, para la bandeja) o al azar, `createdAt` (`addManualReading`); fecha = ahora si `date` es hoy, si no `readingDateOf(date)` + km del auto recalculado con `carKmFrom` (una lectura vieja con menos km no lo baja) |
| `deleteReading(actor, car, readings, readingId)` | O; M sólo propias | sólo lecturas sin `sourceId` (con `sourceId` tira error) | Borra y recalcula km. Error si es la única lectura |
| `restoreReading(actor, car, readings, reading)` | igual | `OdometerReading` sin `sourceId` | "Deshacer" |
| `syncCarKm(actor, carId, readings)` | O, M (no `viewer`) | — | Escribe `currentKm`, `kmUpdatedAt`, `avgKmPerDay` con `carKmFrom` (sube o baja a la lectura más alta). Lo llama `DataProvider` solo cuando `kmCorrection(car, readings)` no es null y puedo escribir en el auto (`canWrite`: no en los que soy `viewer`), sólo con `cars` y `odometer` confirmados por el servidor (no caché), 2 s después del último cambio; una corrección que falló no se reintenta |

#### Mantenimientos — `cars/{carId}/rules/{id}` (plan del dueño; M sólo lee)

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `saveRule(actor, { jobs, readings }, data: RuleInput, existing?: MaintenanceRule, ruleId?)` (`ruleId`: id de un alta generado antes, para la bandeja) | O | `RuleInput = { carId, name, intervalKm, intervalTime, repeat, baseKm, baseDate, warnKm, warnDays }` (lo declarado; la "última vez" es la base); defaults de aviso: `defaultWarnings()`; `existing`: el mantenimiento como lo abrió el formulario (con la proyección en memoria) | Crear: `set` de lo declarado + la proyección (`projectRule` con los trabajos de `ctx`) + `lastNotified*` en null. Editar: `update` de lo declarado que cambió (`changedFields`; si cambió algo, resetea `lastNotified*`; si cambió `intervalTime`, borra `intervalMonths`) + la proyección sólo si no es la de `existing` (`projectionPatch`). `baseKm` y `baseDate` van siempre juntos y con la proyección (un doc sin `baseDate` lee la base de `lastDone*`). Nunca escribe `lastDone*` del formulario. → `WriteOutcome` |
| `syncRuleProjection(actor, change: ProjectionChange)` | O | `{ ruleId, carId, patch }` de `projectionDiff` | `update` de la proyección (y `lastNotified*: null` si el patch lo trae). Lo llama la reconciliación de `DataProvider` |
| `deleteRule(actor, carId, ruleId)` | O | — | — |
| `restoreRule(actor, rule)` | O | `MaintenanceRule` | "Deshacer": `set` con lo declarado y la proyección que tenía |

**Proyección** (`lib/maintenance.ts`, pura). Lo declarado (`baseKm`, `baseDate`, la "última vez" que carga el dueño) se separa de lo derivado de los trabajos aprobados (`lastDoneKm`, `lastDoneDate`, `lastDoneKmEstimated`, `lastDoneJobId`, `completedByJobId`), que se guarda sólo como caché para el cron.
- `projectRule(rule, jobs, readings)`: manda el trabajo aprobado más reciente del auto que marca el mantenimiento y no es anterior a la base (`>=`: uno de la misma fecha le gana); empate de fecha entre trabajos → `createdAt`, después id. Periódico: fecha del trabajo y, si tiene intervalo de km, `jobDoneKm` (el del trabajo o el estimado, `lastDoneKmEstimated: true`); sin intervalo de km, `lastDoneKm: null`. De una vez: `completedByJobId` = el trabajo, conserva su base. Sin trabajos: la base.
- `projectionPatch(stored, next)` / `projectionDiff(rules, jobs, readings)` → `ProjectionChange { ruleId, carId, patch }[]`. El patch pone `lastNotifiedAt/lastNotifiedStatus: null` si cambia `lastDoneDate`, `completedByJobId` o el `lastDoneKm` de uno por km que no es estimado antes y después; un estimado que se ajusta se guarda sin volver a avisar. Aplicar el diff y recalcular da vacío.
- `jobChangeDiff({ rules, jobs, readings, readingsAfter?, before, after })`: los cambios de un trabajo que pasa de `before` a `after` (null = no existe), comparando la proyección con el trabajo como estaba contra como queda (sirve con datos de antes de borrar, para "Deshacer"). `describeProjectionChange(rule, next)` arma el texto de las confirmaciones.
- `isCompleted`, `activeRules`, `projectRules`, `projectionKey`.

**Reconciliación** (`DataProvider`): en los autos propios (`isCarOwner`), también para los trabajos que creó aprobados un miembro `trusted` (él no escribe `rules`), con `cars`, `rules`, `jobs` y `odometer` confirmados por el servidor, 2 s después del último cambio, `projectionDiff` con lo guardado y `syncRuleProjection` de cada cambio. Una clave `ruleId:patch` (`projectionKey`) en un `useRef` evita repetirlo; uno que falló no se reintenta. Es determinística: dos pestañas escriben lo mismo y no compiten. Arregla un batch de un trabajo que falló, lo que escribe la versión anterior de la PWA y los estimados que se mueven.

**Lectura tolerante** (`ruleFrom` en `lib/db.ts` y en el cron): si el documento no tiene `baseDate` (lo creó o editó la versión anterior de la PWA, que reescribe el documento), la base es `lastDone*`; si tiene `baseKm`/`baseDate` en null, la base es null.

**Cumplidos** (`completedByJobId != null`): no son mantenimientos activos. No están en `rulesByCar` (ni en la pantalla de inicio, `car-card`, `km-form`, el PDF ni `pendingItems`, que además los filtra), ni en los logros (`mineForAchievements`), ni en el cron. La pestaña Estado los muestra en "Cumplidos", plegados, con link al trabajo; `job-form` muestra marcado el que cumplió ese mismo trabajo, para poder desmarcarlo. La página del mantenimiento los busca en `allRules`.

Estado calculado (no se guarda, con la proyección en memoria): `getRuleState()` / `rulesWithState()` en `lib/maintenance.ts` → `RuleState { status: 'ok'|'soon'|'overdue'|'unknown', nextKm, nextDate, remainingKm, remainingDays, dueBy: 'km'|'date'|null, estimatedKmDate, daysUntilDue, progress: 0-100+ }`. Un mantenimiento por km con `lastDoneKm == null` (`missingLastKm`) se calcula sólo por fecha, y la tarjeta (pestaña Estado) y la ficha dicen "Falta el km de la última vez". Un `lastDoneKm` estimado se muestra "≈ 48.300 km (estimado)" (`formatLastDoneKm`). `rule-form` edita la base ("Última vez (si no hay trabajos)"); si un trabajo manda, muestra "Según el trabajo «X» del dd/mm" con link (o "Cumplido con…"), y exige el km y la fecha de la base sólo si no hay un trabajo que mande.

#### Trabajos — `cars/{carId}/jobs/{id}`

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `saveJob(actor, ctx, data: JobInput, existing?: Job, followUp?)` | O; M (no `viewer`) crea/edita propios no aprobados; M `trusted` crea aprobados | `ctx = { car, rules, jobs, readings }` (`rules`: todos los del auto, también los cumplidos); `JobInput = { carId, date, km, title, category, cost, workshop, notes, ruleIds }`; `existing`: el `Job` como lo abrió el formulario; `followUp = { name, intervalTime }` (sólo al crear) | Crear: `set` con autoría, `revision: 0` y `status` (`approved` si es O o M `trusted`, `pending` si es M `editor`) + `applyJobChange` (aprobado: lectura vinculada `job-{id}` a nombre del autor o, sin km, la borra, y el km del auto; O: recalcula los mantenimientos que marca y regla de una vez si `followUp`, con `baseDate` = fecha del trabajo; M `trusted`: sin mantenimientos ni `followUp`, los escribe la reconciliación del dueño). Editar: `update` de lo que cambió contra `existing` + lo que dice `jobEdit` con el trabajo actual de `ctx.jobs` (M: `status:'pending'` si no lo estaba y siempre `revision + 1`; O: no cambia el estado y sube `revision` sólo si no está aprobado) + `applyJobChange` (la lectura se reescribe sólo si cambió el km, la fecha o la aprobación). M, o O sobre uno sin aprobar: sin lectura ni cambios en los mantenimientos. → `WriteOutcome` |
| `approveJob(actor, ctx, job)` | O | `Job` pendiente, como se lo mostró al dueño | `update` `status:'approved'`, `reviewedAt`, `revision: job.revision` + `applyJobChange` (lectura `job-{id}` a nombre del autor; sin km, el estimado a la fecha del trabajo, no el de hoy). Si las reglas lo deniegan (`permission-denied`: el miembro lo editó, o ya no está pendiente), lee el trabajo con `getDocFromServer`: si ya está `approved` (`reviewAlreadyDone`) termina bien sin aplicar nada; si no, `Error(REVIEW_CHANGED)` = "El trabajo cambió mientras lo revisabas. Miralo de nuevo." |
| `rejectJob(actor, ctx, job)` | O | `Job` pendiente o aprobado | Igual que `approveJob` con `status:'rejected'` (ya `rejected` = hecho). Si estaba aprobado, borra `job-{id}`, recalcula km y sus mantenimientos vuelven a como estaban antes de él |
| `deleteJob(actor, ctx, job)` | O; M (no `viewer`) propios no aprobados | `Job` | Borra el trabajo + `applyJobChange`: si estaba aprobado, borra `job-{id}`, recalcula km y sus mantenimientos vuelven al trabajo anterior o a la base (un cumplido vuelve a estar activo) |
| `restoreJob(actor, ctx, job)` | igual | `Job` | "Deshacer": el trabajo y, si estaba aprobado, su lectura y sus mantenimientos (`ctx` puede ser el de antes de borrar) |

`applyJobChange(actor, ctx, before, after, writeJob)` (interna): camino único para crear, editar, aprobar, rechazar, borrar y restaurar. El trabajo y su lectura vinculada van en un batch (la lectura no se toca si el trabajo sigue aprobado con el mismo km y la misma fecha); cada mantenimiento que cambia (`jobChangeDiff`) va en su propio batch (un mantenimiento borrado en otro dispositivo no tira abajo el trabajo). Los batches de los mantenimientos se commitean recién cuando el servidor confirma el del trabajo (`saved.then`): si las reglas rechazan el trabajo (aprobación de una versión vieja) o no existe, no quedan mantenimientos reiniciados. Sin conexión esperan la confirmación (si la app se cierra antes, no se escriben); la UI usa la proyección en memoria y la reconciliación escribe lo que falte. La promesa espera sólo el batch del trabajo. Ningún trabajo borra un mantenimiento. Si quien escribe no es el dueño (un `trusted` que crea un trabajo aprobado), no hay batches de mantenimientos: las reglas no lo dejan, y los escribe la reconciliación cuando el dueño abre la app; mientras tanto `useData` los muestra con la proyección en memoria.

Permisos de UI: `canEditJob(car, uid, job)` (un `viewer`, nada; un trabajo aprobado del miembro, sólo el dueño); sólo cuentan en gastos/reportes `approvedJobs()` (`lib/sharing.ts`). `useJobReview()` (`job-form`) aprueba o rechaza con `settle(p, 'No se pudo aprobar' | 'No se pudo rechazar')`: el error `REVIEW_CHANGED` sale en un toast, también si llega después del timeout (sin conexión).

`job-form`: a un `trusted`, un trabajo nuevo se confirma como "Guardar" (cuenta al instante, sin la aprobación del dueño, y después sólo el dueño lo corrige o borra) y no ofrece "Volver al taller". El km arranca vacío. Si se marca un mantenimiento por km (`kmRulesOf`) y el km queda vacío, el campo muestra el estimado (`jobDoneKm`) como sugerencia y el trabajo se guarda con `km: null` (la proyección usa el estimado); sin estimación, el km es obligatorio. La confirmación dice "Km (estimado)". Para marcar ofrece los mantenimientos activos y el que cumplió ese mismo trabajo (marcado). Al editar o borrar un trabajo aprobado, la confirmación lista cómo queda cada mantenimiento que cambia (`jobChangeDiff`, `describeProjectionChange`).

#### Combustible — `cars/{carId}/fuel/{id}`

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `saveFuel(actor, { car, readings }, data: FuelInput, existing?: FuelLoad, fuelId?)` (`fuelId`: id de un alta generado antes, para la bandeja) | O; M (no `viewer`) propias | `FuelInput = { carId, date, km, fuelType, grade, quantity, unitPrice, total, fullTank, station }`; calcular montos con `resolveFuelAmounts()` (`lib/fuel.ts`); `existing`: la carga como la abrió el formulario | Crear: `set` con autoría + lectura vinculada `fuel-{id}` a nombre del autor (o la borra si no tiene km) + km recalculado. Editar: `update` de lo que cambió (`changedFields`); la lectura y el km del auto sólo si cambió `km` o `date`. → `WriteOutcome` |
| `deleteFuel(actor, { car, readings }, load)` | O; M (no `viewer`) propias | `FuelLoad` | Borra la carga y `fuel-{id}`, recalcula km |
| `restoreFuel(actor, { car, readings }, load)` | igual | `FuelLoad` | "Deshacer": la carga y su lectura |

Permisos de UI: `canEditEntry(car, uid, record)` (un `viewer`, nada).

#### Usuario — `users/{uid}/…` (sólo U)

| Función | Input | Escribe |
|---|---|---|
| `saveSettings(uid, Partial<UserSettings>)` | `{ reminder: { enabled, weekday 0-6 }, timezone, sharedCars?: boolean }` | `users/{uid}` merge |
| `savePushSubscription(uid, sub.toJSON())` | `PushSubscriptionJSON` | `pushSubscriptions/{sha256(endpoint)}` `{ endpoint, keys{p256dh,auth}, userAgent, createdAt }` |
| `deletePushSubscription(uid, endpoint)` | — | — |
| `unlockAchievements(uid, [{ id, carId }])` | ids de `ACHIEVEMENTS` | Transacción idempotente `achievements/{id}` `{ carId, unlockedAt, celebratedAt: null }` → creados |
| `markAchievementsCelebrated(uid, ids)` | — | `celebratedAt = now` |

Wrappers de cliente: `enablePush(uid)` / `disablePush(uid)` / `pushSupport()` en `lib/push-client.ts`.

### 2.3 Rutas de UI (`app/`)

| Ruta | Pantalla | Params |
|---|---|---|
| `/login` | Login Google | `?next=/ruta` |
| `/` | Inicio: autos y pendientes (sin "Cargar km" ni km pedidos en los autos donde soy `viewer`) | — |
| `/autos/nuevo` | Alta de auto (`car-form`) | `?borrador=<id>` (entrada de la bandeja: precarga los datos y los km) |
| `/autos/[carId]` | Detalle del auto; salir de un auto compartido (`leaveCar`); al dueño, con quién lo comparte (nombres de `memberProfiles`). Un `viewer` no ve "Cargar km", "+ Trabajo", "+ Carga" ni agregar en las pestañas vacías (`canWrite`) | `?tab=estado\|trabajos\|combustible\|km` |
| `/autos/[carId]/editar` | Editar auto (`car-form`), compartir: miembros (`removeMember`; "Pasarle el auto" a uno con uid, `transferCar`, con confirmación, y vuelve a `/autos/[carId]`) e invitaciones (`inviteMember`, `revokeInvite`; compartir o copiar el link; volver a invitar las rechazadas o vencidas); rol de cada miembro con uid, segmentado "Puede cargar" (`editor`) / "Sin aprobación" (`trusted`) / "Solo mira" (`viewer`), con confirmación (`setMemberRole`) | `?borrador=<id>` (cambios de la bandeja) |
| `/autos/[carId]/km` | Cargar km (`km-form`, también como diálogo): fecha opcional, hoy por defecto. Un `viewer` ve `ViewerOnly` (`components/common.tsx`) | `?borrador=<id>` (km y fecha de la bandeja) |
| `/autos/[carId]/mantenimientos/nuevo` · `/[ruleId]` | Alta / edición de mantenimiento | `?borrador=<id>` |
| `/autos/[carId]/trabajos/nuevo` · `/[jobId]` | Alta / edición de trabajo (alta: un `viewer` ve `ViewerOnly`) | `?regla=<ruleId>` (precarga), `?borrador=<id>` |
| `/autos/[carId]/combustible/nuevo` · `/[fuelId]` | Alta / edición de carga (alta: un `viewer` ve `ViewerOnly`) | `?borrador=<id>` |
| `/trabajos` | Historial de trabajos (todos los autos) | — |
| `/gastos` | Resumen de gastos por año/mes | `?auto=<carId>` |
| `/logros` | Logros | — |
| `/invitaciones/[inviteId]` | Link de una invitación (`getInvite`): Aceptar / Rechazar con confirmación (`useInviteResponse`, `components/invites/invite-card.tsx`); al aceptar va a `/autos/{carId}`. Vencida, cancelada o respondida: lo dice. De otra cuenta (`permission-denied`): "Esta invitación es para j•••@gmail.com…" (`maskEmail` del id) | `inviteId` = `{carId}_{emailKey}` (URL-encoded) |
| `/novedades` | Changelog para usuarios (`lib/novedades.ts`). Entrar marca todo como visto. Fuera de esta pantalla, `NovedadesHost` anuncia con una ventana todas las versiones sin ver (después de los logros por festejar) | — |
| `/ajustes` | Recordatorio semanal, avisos de autos compartidos (`sharedCars`), zona horaria, push, versión | — |

`?borrador=<id>`: lo lee `useDraft(kind, carId, recordId?)` (`components/outbox/outbox.tsx`, con `useSearchParams`, por eso esas páginas van dentro de un `Suspense`), que devuelve null si la entrada no es de ese auto o, al editar, de ese registro (`draftMatches`; `carId` null en `/autos/nuevo`). El formulario arranca con `draftSeed`: los datos de la entrada (`data`) o, al editar un registro que existe, el registro actual más lo que la entrada cambió, y se mide contra el registro actual; lo vuelve a guardar con la misma entrada y el mismo `recordId`. Una edición cuyo registro ya no existe abre el alta (`outboxEditHref`).

En todas las pantallas (`AppShell`): `OutboxIndicator`, el aviso "1 carga sin sincronizar" (`useOutboxStatus`: `outboxSummary` de las `pending` que llevan más de `OFFLINE_GRACE_MS`, `visiblePending`). No flota: en el celular va en la barra de navegación, arriba de los íconos (y el `main` suma ese alto a su margen inferior); en el escritorio, en la barra lateral, arriba de la cuenta. En la campanita, las `failed` (`failed-write`): Reintentar (no en las `conflict`), Editar, Descartar (ver `pending.ts`).

### 2.4 Receta: pantalla nueva

```tsx
'use client'
const { actor, uid, cars, today } = useData()          // o useCar(carId)
const confirm = useConfirm()                            // components/confirm-provider: confirmar TODA acción importante
const { saving, error, run } = useSaver()               // lib/use-saver
await run(async () => toastSaved('Guardado', await settle(saveFuel(actor, ctx, data))))
removeWithUndo({ message, remove: () => deleteFuel(actor, ctx, load), restore: () => restoreFuel(actor, ctx, load) })
```
Layout: `PageHeader`, `PageBody`, `SectionTitle`, `EmptyState`, `Loading`, `NotFound`, `CarAvatar` (`components/common.tsx`). Nada de `window.confirm/alert`; preferir chips/segmented a selects.

---

## 3. Modelos de datos (Firestore)

```
allowlist/{emailLower}            { uid, createdAt }                      sólo Admin SDK
usage/{uid}                       { day: ISODate, photos: number }        sólo Admin SDK
cronRuns/{YYYY-MM-DD}             { startedAt, runningSince, finishedAt, runs, candidates, processed, skipped, errors, sent, cursor, failures[≤20] }  sólo Admin SDK (sin match)
notices/{jobId}_{event}_{revision} { carId, jobId, event, revision, createdAt }  sólo Admin SDK (sin match; idempotencia de /api/notify/job)
invites/{carId}_{emailKey}        Invite                                  O crea/reenvía/cancela/borra · invitado lee y responde
users/{uid}                       UserSettings + createdAt                U
  ├─ pushSubscriptions/{sha256}   { endpoint, keys, userAgent, createdAt } U
  ├─ achievements/{achievementId} { carId, unlockedAt, celebratedAt }     U
  ├─ ruleNotices/{ruleId}         { status: 'soon'|'overdue'|null, at }   U read · sólo Admin SDK escribe (estado de avisado por persona)
  └─ cars|rules|jobs|fuel|odometer  LEGADO (pre-migración 1.1.2), sólo lectura/limpieza; la app no los usa
cars/{carId}                      Car                                     O rw (miembros: sólo sacar, cambiarles el rol, o pasarle el auto a uno; borrar = marcar `deletedAt` una vez, el resto lo borra el servidor; `purgeAttempts`, `photoFailedAt`: sólo Admin SDK, en un auto marcado cuya foto no se pudo borrar, no están en `Car` ni en `validCar`) · M read + update km (no `viewer`)/salir · invitado: sumarse
  ├─ rules/{id}                   MaintenanceRule                         O rw · M read
  ├─ jobs/{id}                    Job                                     O rw (revisar: ver reglas) · M ver §2.2 (`viewer`: sólo lee)
  ├─ fuel/{id}                    FuelLoad                                O rw · M propias (`viewer`: sólo lee)
  └─ odometer/{id}                OdometerReading                         O rw · M propias (vinculadas: ver reglas; `viewer`: sólo lee)
```

Relaciones:
- User 1:N Car (owner, `cars.ownerUid`). User N:M Car (member, `cars.memberUids[]` por uid, máx. 2, con `memberProfiles`). El mail no da acceso: el campo viejo `cars.members[]` lo borra `scripts/remove-member-emails.mjs`.
- Car 1:N Invite (`invites.carId`, una por mail canónico). Aceptar una invitación suma `acceptedUid` a `memberUids`.
- Car 1:N MaintenanceRule / Job / FuelLoad / OdometerReading (subcolecciones; cada hijo repite `carId`).
- Job N:M MaintenanceRule vía `job.ruleIds[]`: el estado de cada mantenimiento se deriva de sus trabajos aprobados (`projectRule`); `rule.lastDoneJobId` / `rule.completedByJobId` apuntan al trabajo que manda.
- FuelLoad / Job aprobado 1:0..1 OdometerReading vía `odometer/{fuel|job}-{id}` con `sourceId` (sólo si el registro tiene km).
- User 1:N AchievementRecord, 1:N PushSubscription.

### Entidades (`lib/types.ts`)

| Entidad | Campos (tipo app; en Firestore `Date`→`Timestamp`) |
|---|---|
| `Car` | `id, brand, model, version?, year?, plate?, fuelTypes: ('nafta'\|'gasoil'\|'gnc')[], currentKm, kmUpdatedAt?, avgKmPerDay?, photoUrl?, photoPublicId?, createdAt, ownerUid, ownerName?, memberUids: string[], memberProfiles: { [uid]: { email, name, role?: 'editor'\|'trusted'\|'viewer' } }` (sin `role` = `editor`), `deletedAt?: Date \| null` (marca de borrado: `markCarDeleted`; falta o null = vivo) |
| `Invite` | `id ({carId}_{emailKey}), carId, ownerUid, ownerName?, carLabel ("Ford Ka 2015"), email (como lo escribió el dueño, en minúscula), emailKey (canonicalEmail), status: 'pending'\|'accepted'\|'declined'\|'revoked', createdAt, expiresAt (+14 días), respondedAt?, acceptedUid? (uid de quien respondió)` |
| `MaintenanceRule` | `id, carId, name, intervalKm?, intervalTime?: { amount, unit: 'day'\|'week'\|'month'\|'year' }, repeat: bool`; declarado: `baseKm?, baseDate?: ISODate` (la "última vez" a mano; sin los campos = `lastDone*`, ver lectura tolerante); proyección (caché de `projectRule`): `lastDoneKm?, lastDoneKmEstimated: bool (lastDoneKm salió de las lecturas; falta = false), lastDoneDate?: ISODate, lastDoneJobId?, completedByJobId?` (de una vez cumplido); `warnKm (500), warnDays (30), lastNotifiedAt?, lastNotifiedStatus?: 'soon'\|'overdue'` |
| `Job` | `id, carId, date: ISODate, km?, title, category: JobCategory, cost, workshop?, notes?, ruleIds: string[], status: 'approved'\|'pending'\|'rejected' (falta = approved), reviewedAt?, revision: number (falta = 0; M la sube en 1 al editar, O aprueba/rechaza con la que vio), createdBy?, createdByName?, createdAt` |
| `FuelLoad` | `id, carId, date: ISODate, km?, fuelType, grade?: 'super'\|'premium' (null en GNC), quantity (L o m³), unitPrice, total, fullTank, station?, createdBy?, createdByName?, createdAt` |
| `OdometerReading` | `id, carId, km, date: Date, source: 'initial'\|'manual'\|'job'\|'fuel', sourceId: string \| null (id de la carga o del trabajo; null en alta, manual y viejas), createdBy?, createdByName?, createdAt: Date \| null (cuándo se cargó en la app; null en las viejas)` |
| `AchievementRecord` | `id (= id del logro), carId?, unlockedAt, celebratedAt?` |
| `UserSettings` | `reminder: { enabled (true), weekday (0 = domingo) }, timezone ('America/Argentina/Buenos_Aires'), sharedCars?: boolean (true; falta = true)` |
| `RuleNotice` | `status: 'soon'\|'overdue'\|null, at: Date \| null` (`users/{uid}/ruleNotices/{ruleId}`) |
| `Actor` | `{ uid, name? }` — autor de una escritura |

Enums: `JobCategory = service|reparacion|cubiertas|frenos|electricidad|carroceria|documentacion|otros`. Combinaciones válidas de `fuelTypes`: `['nafta']`, `['nafta','gnc']`, `['gasoil']`. Presets: `RULE_PRESETS`, `INTERVAL_PRESETS`.

### Validación en `firestore.rules`

- Cada colección tiene una **allowlist de campos** (`validCar`, `validRule`, `validJob`, `validFuel`, `validReading`, `validSettings`, `validPushSubscription`, `validAchievement`, `validInvite`) con tipos y topes de largo.
- **Campo nuevo ⇒** agregarlo en `lib/types.ts`, en el mapper `xxxFrom` de `lib/db.ts` (y en `app/api/cron/daily` si el cron lo lee), en la función `validXxx` de `firestore.rules`, y **publicar las reglas a mano** (paso manual del usuario) antes de deployar la app.
- Colección o ruta nueva ⇒ `match` nuevo; cualquier ruta no listada se deniega.
- `validRule` acepta `lastDoneKmEstimated` (`optBool`) y `validReading` acepta `createdAt` (`optTime`); los dos pueden faltar (lo que escribe la 1.3.0).
- `validRule` acepta `baseKm` (`optNum`), `baseDate` (`optText` 30), `lastDoneJobId` (`optText` 100) y `completedByJobId` (`optText` 100); pueden faltar (lo que escribe la 1.4.1). Los permisos no cambian: sólo el dueño escribe `rules`.
- **Trabajos** (`jobs`): `validJob` acepta `revision` (`optNum`; falta en lo que escribe la 1.4.1). `update` del dueño: `ownerJobUpdate()` — editar sin revisar (mismo `status` y mismo `reviewedAt`) no tiene condiciones extra; revisar (cambia `status` o `reviewedAt`) sólo vale `pending` → `approved`/`rejected` o `approved` → `rejected`, con `revision` igual a la guardada (falta = 0). Así no se aprueba una versión vieja, ni algo ya aprobado o rechazado, ni un rechazado sin que el miembro lo vuelva a mandar. `update` del miembro: además de lo de antes (suyo, `pending`/`rejected` → `pending`, `reviewedAt` igual), `memberJobRevision()`: `revision` = anterior + 1 (la 1.4.1 no la manda: un miembro con esa versión no edita hasta recargar la app). Crear y borrar no cambian.
- **Miembros e invitaciones** (`cars`, `invites`): `validCar` acepta `memberUids` (hasta 2, distintos) y `memberProfiles` (`validMembers`: un perfil `{ email, name, role? }` por uid, con las mismas claves; `validProfile`: `role` en `editor`\|`trusted`\|`viewer`, o sin `role`). `members` (los mails viejos) ya no da acceso: `validCar` lo acepta ausente, null o con la forma vieja (hasta 2 mails en minúscula), así un auto al que todavía le quedan mails se sigue pudiendo escribir (también `memberJoin`). `create` exige `members` vacío o sin el campo (`memberEmails(d).size() == 0`), y todo `update` exige `membersNotGrown()` (los mails de después son parte de los de antes): la versión anterior de la PWA lo escribe como `[]` o le saca mails (`arrayRemove` sobre un campo que no existe lo deja en `[]`), y nadie suma uno. `isMember(car)` = mi uid en `memberUids` (el mail no cuenta; ya no hay `myEmail()`). `update` del dueño: `ownerMembersUpdate()`, de los miembros sólo saca (no suma uids ni perfiles), `ownerRoleUpdate()` (cambiar un rol: sólo cambia `memberProfiles`, un solo perfil de un miembro que ya estaba, y de él sólo `role`; con otro campo o un valor inválido, se deniega), o `ownerTransfer()` (pasarle el auto: `ownerUid` nuevo en `memberUids` y no el mío; `memberUids` = el anterior sin el nuevo dueño más el mío, `size() <= 2`; en `memberProfiles` sale la clave del nuevo dueño, y con ella su rol, y entra la mía con `validProfile` y sin `role`; `ownerName` = el `name` de su perfil; cambian sólo `ownerUid`, `ownerName`, `memberUids`, `memberProfiles` y `members`, que sólo puede achicarse). Miembro: km (no `viewer`) o `memberLeave()` (saca su uid y su perfil; la PWA anterior también le saca su mail a `members`). Ya no hay `legacyMemberLeave()`. Invitado: `memberJoin(carId)` (agrega sólo su uid al final, `size() <= 2`, y su perfil sin `role`; la invitación `carId + '_' + myEmailKey()` está `pending` antes y `accepted` con su uid después). `invites`: leen el dueño o el invitado (`emailKey == myEmailKey()`); `create` = `freshInvite()` (dueño del auto, id = `carId + '_' + emailKey`, `emailKey == canonicalEmail(email)`, `pending`, `expiresAt <= request.time + 15d`, no a su propio mail, sin respuesta); `update`: `ownerResend()` (lo mismo que crear, mismo auto, dueño y mail, si estaba `declined`/`revoked`, `pending` vencida o `accepted` y `acceptedUid` ya no está en `memberUids`), `ownerRevoke()` (sólo `pending` → `revoked`) o `inviteeResponse()` (para mi `emailKey`, `pending` sin vencer → `accepted`/`declined`, `respondedAt == request.time`, `acceptedUid == uid`; si acepta, `getAfter` del auto tiene su uid); `delete`: el dueño. `myEmailKey()` / `canonicalEmail(e)` usan `let`, ternario, `split` y `replace` (verificar en el simulador).
- **Roles** (`jobs`, `fuel`, `odometer`, `cars`): `memberRoleOf(car)` = `car.memberProfiles[uid].role` (falta = `editor`). Las ramas del miembro usan `writerOfCar(carId)` (borrar, `get`) y `writerOfCarAfter(carId)` (crear y editar, `getAfter`): miembro y no `viewer`, con una sola lectura del auto (reemplazan a `memberOfCarAfter`; `memberOfCar` queda para leer). Crear un trabajo: `memberJobCreate(carId)` — a su nombre, `pending`/`rejected`, o `approved` sólo si es `trusted`, con `reviewedAt` null y `revision` 0. Un `trusted` no escribe `rules`. `memberCarUpdate()` deniega el km a un `viewer`; salir sigue valiendo.
- **Borrado de autos** (`cars` y sus hijos, `invites`): `validCar` acepta `deletedAt` (`optTime`). `carAlive(car)` = `deletedAt` falta o es null. `update` del auto: el dueño puede `ownerMarkDeleted()` (sólo si no estaba marcado; cambia sólo `deletedAt`, igual a `request.time`; no se puede volver a marcar ni desmarcar); todas las demás ramas (dueño, miembro, `memberJoin`) exigen `carAlive` antes y después del pedido. `create` del auto exige `carAlive`. `ownsCarAfter`, `writerOfCarAfter` y `memberJobCreate` exigen `carAlive` del auto después del pedido: en un auto marcado nadie crea ni edita `rules`, `jobs`, `fuel` ni `odometer` (`permission-denied`). `freshInvite` usa `ownsLiveCar` (no se invita a un auto marcado). Borrar sigue igual, para la versión anterior de la PWA, que borra los hijos y después el auto desde la app.
- **Lecturas vinculadas** (`odometer`): `linkedOk` exige, si viene `sourceId`, `source` en `fuel`\|`job`, id = `{source}-{sourceId}` y que el registro exista después del batch (`existsAfter(linkedParent)`; la ruta usa `jobs` si `source == 'job'`). `sourceId` no cambia al editar. Borrar: el dueño, cualquier lectura sin consultar el registro (la versión anterior de la PWA borra el auto desde la app); el miembro que no es `viewer`, una que no existe (`resource == null`) o una suya sin `sourceId` o cuyo registro ya no existe o no tiene km (`linkedReleased`).

### Lógica de dominio pura (sin I/O)

| Módulo | Funciones clave |
|---|---|
| `maintenance.ts` | `getRuleState`, `rulesWithState`, `describeRemaining`, `defaultWarnings`, `projectRule(rule, jobs, readings)`, `projectRules`, `projectionPatch`, `projectionDiff`, `jobChangeDiff`, `describeProjectionChange`, `isCompleted`, `activeRules`, `rulingJob` (proyección: ver §2.2), `jobDoneKm(job, readings)` (km del trabajo o estimado a su fecha, sin la lectura `job-{id}`), `kmRulesOf`, `formatLastDoneKm`, `missingLastKm` |
| `odometer.ts` | `computeAvgKmPerDay`, `topReading`, `carKmFrom` (km del auto desde sus lecturas), `kmCorrection(car, readings)` (`carKmFrom` si el `currentKm` guardado no es el de la lectura más alta, en los dos sentidos; null si coincide o no hay lecturas), `carKmForNotifications(car, top)` (el auto con `currentKm`/`kmUpdatedAt` de la lectura más alta, para el cron), `linkedReadingId`, `readingDateOf`, `withLinkedReading`, `readingOrigin` (texto y link de la pestaña Km), `kmAtDate(readings, date)` (km a una fecha: el del día, interpolado o el de la última; `estimated`), `neighborsAt(readings, date)` (lectura de más km de ese día o antes / de menos km después, por día local), `validateKmReading(km, date, readings)`, `entryKmWarning(entry, car, readings)` (salto, km del último registro en fecha anterior y coherencia con la serie, sin la lectura propia `entry.readingId`) |
| `fuel.ts` | `resolveFuelAmounts`, `computeFuelStats`, `computeCostPerKm`, `lastPrices` |
| `expenses.ts` | `summarizeExpenses(jobs, fuel, year, today)`, `expenseYears` |
| `pending.ts` | `pendingItems({ ..., invites, outbox?, now })` → `PendingItem` (`failed-write`\|`km`\|`rule`\|`review`\|`rejected`\|`invite`; `failed-write` = una entrada `failed` de la bandeja, primero, con su auto o null (`FailedWriteRow`: Reintentar vuelve a llamar la función de `lib/db.ts` con el `payload` y los datos actuales de `useData`; Editar abre el formulario con `?borrador=`; Descartar, con confirmación; sin el auto, sólo los datos y Descartar; `conflict`, sin Reintentar); `invite` = una invitación pendiente sin vencer de `myInvites`; sin los recordatorios cumplidos; `km` no en los autos donde soy `viewer`), `urgentCount` |
| `achievements.ts` | `ACHIEVEMENTS`, `evaluateAchievements`, `pendingUnlocks`, `pendingCelebrations`. Rachas y seguimiento usan la fecha en que se cargó cada lectura: `createdAt` del registro en las vinculadas, el de la lectura en las demás, o `date` si falta |
| `sharing.ts` | `isCarOwner`, `isSharedCar` (miembros en `memberUids`, o me lo compartieron), `memberRole(car, uid)` (falta = `editor`), `canWrite(car, uid)` (dueño, o miembro no `viewer`), `approvesOwnJobs(car, uid)` (miembro `trusted`), `setRolePatch(uid, role)`, `canEditEntry`, `canEditJob` (los dos con `canWrite`), `approvedJobs`, `memberError(car, invites, email, { ownerEmail, now })` (mail válido, no el mío ni el de un miembro ni el de una invitación pendiente, comparando con `canonicalEmail`; el tope cuenta `memberUids` + invitaciones pendientes sin vencer), `canonicalEmail` (minúscula; en Gmail/googlemail sin puntos ni "+algo"), `maskEmail`, `inviteId(carId, email)`, `inviteEmailKey(id)`, `isInviteOpen(invite, now)`, `inviteCarLabel`, `carMembers(car)` (`CarMember[]` = `{ uid, email, name }`: los de `memberUids`, en orden, con su perfil), `transferPatch(car, to, me)` (lo que cambia del auto al pasárselo a un miembro: `ownerUid`, `ownerName`, `memberUids`, `memberProfiles`; tira error si `to` no está en `memberUids` o soy yo), `INVITE_DAYS = 14`, `authorLabel`, `mineForAchievements` (sin mantenimientos de autos ajenos ni recordatorios cumplidos), `jobEdit(job, changes, member)` (el `update` de un trabajo editado: cambios + `status:'pending'` y `revision + 1` del miembro; null = nada que escribir), `reviewAlreadyDone(target, current)` (una revisión denegada que ya quedó hecha), `MAX_MEMBERS = 2` |
| `outbox.ts` | Bandeja (ver §2.2): `outboxKey(uid)`, `outboxEntry`, `outboxLabel`, `outboxDetails`, `originalFields`, `parseOutbox`/`serializeOutbox`, `withEntry`, `withoutEntry`, `withFailure`, `withoutExpired` (`OUTBOX_DAYS = 30`), `visiblePending`, `outboxSummary`, `outboxDocPath`, `expectedFields`, `checkServer` (`ServerCheck`), `deniedReason`, `draftSeed`, `draftMatches`, `outboxEditHref`, `isEdit`; textos `NOT_SAVED`, `CHANGED_ELSEWHERE`, `NO_ACCESS`. I/O mínimo: `readOutbox`, `addOutboxEntry`, `removeOutboxEntry`, `failOutboxEntry`, `pruneOutbox`, `useOutbox(uid)`, `setWaiting`/`isWaiting` |
| `utils.ts` | `changedFields(original, draft)` (los campos del borrador que cambiaron: null = undefined, listas en orden, mapas por contenido), `isUnchanged`, `safeNextPath`, `cn` |
| `report.ts` | `buildServiceReport` (PDF de historial), `reportFileName` |
| `notifications.ts` | `planDailyNotifications` (recibe `uid`, `notices` y `pendingReview`; saltea recordatorios cumplidos, autos compartidos si `sharedCars === false` y pedido de km si `viewer`; reserva lugar para `REVIEW_TAG`), `updatesToPersist`, `orphanNoticeIds`, `ruleAlertRecipients(car, callerUid)` (destinatarios de `/api/notify/rules`: dueño y miembros sin quien llamó; null = 403), `isPushEndpoint`, `REVIEW_TAG`, `effectiveRuleNotice` (usa `rule.lastNotified*` como semilla inicial del dueño si aún no tiene `ruleNotices/{ruleId}`), `didRuleEscalate`, `ruleAlertMessage`, `planRuleAlerts`, `escalatedRules`, `planJobNotification` |
| `notify-client.ts` | Helpers de cliente fire-and-forget: `notifyJobInBackground`, `notifyRulesInBackground`, `announceRuleEscalations`, `checkCarRuleEscalations`, `readingsWithLinked` |
| `cron-run.ts` | Corridas del cron: `runDateOf(now)` (id de `cronRuns`, fecha UTC), `candidateUids(paths)`, `runIsDone(previous)`, `runIsBusy(previous, now)` (`RUN_LOCK_MS = 60_000`), `queueFrom(uids, previous)` (los uids después del cursor), `tally(reports)`, `summarizeRun({ queue, next, reports, candidates, previous })` (métricas acumuladas del día y cursor), `MAX_FAILURES = 20` |
| `cars.ts` | Borrado de autos: `carDeleteDecision(car, uid)` (`gone`\|`forbidden`\|`mark`\|`purge`, lo que hace `DELETE /api/cars/[carId]`), `purgeCutoff(now)` y `PURGE_DELAY_MS` (1 h, el barrido del cron), `isCarId`, `purgePhotoId(car)` (la foto sólo si es de la carpeta del dueño), `photoFailureAction(previous, now)` (`retry`\|`give-up`; `MAX_PURGE_ATTEMPTS = 3`, `PHOTO_GIVE_UP_MS` = 7 días). Servidor: `purgeCar` en `cars-server.ts`; cliente: `purgeCarInBackground` en `cars-client.ts` |
| `by-car.ts` | `groupByCar(carIds, { rules, jobs, fuel, readings })` → `Map<carId, CarRecords>` (`CarRecords = { rules, jobs, fuel, readings }`): una pasada por lista, cada auto de `carIds` con su entrada (vacía si no tiene registros), orden de la lista completa conservado, los de un auto desconocido afuera. Lo usa `DataProvider` (`byCar`) |
| `dates.ts` / `format.ts` | `ISODate` helpers / formato es-AR (`formatKm`, `formatMoney`, `formatDate`, `formatDayMonth`) |

---

## 4. Servicios externos y jobs

| Servicio | Uso | Config (env) |
|---|---|---|
| Firebase Auth | Login Google; ID token para las API routes. `/__/auth/*` reescrito al dominio de la app (Safari/iOS) | `NEXT_PUBLIC_FIREBASE_*` |
| Firestore | Datos, caché offline multi-pestaña. `waitForServerWrites` (`waitForPendingWrites`) y `serverDocData` (`getDocFromServer`) para la bandeja | ídem |
| Firebase Admin | API routes y cron (no pasa por las reglas) | `FIREBASE_ADMIN_PROJECT_ID`, `_CLIENT_EMAIL`, `_PRIVATE_KEY` |
| Cloudinary | Fotos de autos en `autocar/{uid}/{uuid}`, 1600 px, 10 fotos/día; URLs con `cloudinaryUrl(url, transform)` | `CLOUDINARY_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` |
| Web Push | VAPID; payload `{ title, body, url, tag }`; `public/sw.js` abre `url` al tocar | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Vercel Cron | `GET /api/cron/daily` 12:00 UTC y 14:00 UTC (la segunda retoma lo que quedó, ver `cronRuns`); también barre los autos marcados como borrados hace más de 1 h | `CRON_SECRET` |
| Vercel Analytics / Speed Insights | Métricas | — |
| GitHub Actions | `ci.yml`: `next typegen` + typecheck + tests | — |

Seguridad HTTP: CSP y headers en `next.config.mjs`. Un dominio externo nuevo (img, connect, frame) ⇒ agregarlo a la CSP.

Sin webhooks entrantes ni colas. Scripts manuales (Admin SDK, los corre el usuario; sin `--apply` son un simulacro):
- `scripts/migrate-cars.mjs [--apply]`: `users/{uid}/…` → `cars/…` (1.1.2).
- `scripts/link-readings.mjs [--apply]` (lógica pura en `scripts/link-readings-plan.mjs`): crea `baseline-{carId}` (`source:'initial'`) en los autos sin lecturas o con `currentKm` mayor que sus lecturas, vincula las lecturas viejas de cargas y trabajos con un solo candidato del mismo km (copia a `{source}-{id}` y borra la vieja), completa las que faltan e informa las ambiguas y las sin candidato. Idempotente. Orden: publicar las reglas → simulacro → `--apply` → deploy de la app → `--apply` otra vez (vincula lo que escribió la PWA vieja; una tercera corrida da 0 cambios). Va antes del deploy porque la app nueva recalcula el km desde las lecturas y un auto viejo bajaría sin su baseline.
- `scripts/members-to-uids.mjs [--apply]` (lógica pura en `scripts/members-to-uids-plan.mjs`): por cada mail de `members` busca la cuenta (`getUserByEmail`). Con cuenta: suma su uid a `memberUids` y su perfil (mail y `displayName`) a `memberProfiles`; el mail queda en `members` para la PWA vieja. Sin cuenta (nunca vio el auto): crea la invitación pendiente (`create`, si no existe) y saca el mail de `members`. Ambiguos (la cuenta del dueño, una lectura de Auth que falló, más de 2 miembros por uid): no se tocan y se informan. Un batch por auto. Idempotente. Orden: publicar las reglas → deploy de la app → simulacro → `--apply` (una segunda corrida da 0 cambios). Mientras tanto nadie pierde el acceso: las reglas y la app de esa versión siguen leyendo `members`.
- `scripts/remove-member-emails.mjs [--apply]` (lógica pura en `scripts/remove-member-emails-plan.mjs`): borra el campo `members` (`FieldValue.delete()`) de cada auto en el que cada mail es el `email` del perfil (`memberProfiles`, por `canonicalEmail`) de un uid de `memberUids`, o el del dueño (`getUser(ownerUid)`, sólo si hace falta). Un auto con algún mail sin uid no se toca y se informa ("No se toca: sin uid …"). Cada auto se escribe con la precondición `lastUpdateTime` del documento leído: si cambió (`FAILED_PRECONDITION`, código 9) se informa como conflicto; otro error, como error. Informa por auto los mails con uid, los del dueño y los que no tienen uid. Sale con código 1 si queda algún auto sin tocar, en conflicto o con error. Idempotente: un auto sin `members` no se toca. Va al menos una release después de `members-to-uids` (la PWA ya actualizada). Orden: simulacro → resolver los autos que no se tocan (que esa persona acepte una invitación, o sacar el mail con la app de antes de este cambio, Compartir → Sacar, o desde la consola de Firebase) → `--apply` → publicar las reglas → deploy de la app → `--apply` otra vez (la PWA anterior que siga abierta puede volver a escribir `members: []`; una tercera corrida da "Sin cambios"). Un auto con mails que quedan no se traba: las reglas lo aceptan sin darle acceso a nadie y no dejan sumar mails, así que publicarlas antes no es peligroso; igual, para cerrar #66 no tiene que quedar ninguno.
- `scripts/rebase-rules.mjs [--apply]` (lógica pura en `scripts/rebase-rules-plan.mjs`): a cada mantenimiento sin `baseKm`/`baseDate` (ausentes, no null) le escribe la base con `update`: null si su `lastDoneDate` es la de un trabajo aprobado del auto que lo tiene en `ruleIds` (la "última vez" la puso el trabajo), y si no, `baseKm = lastDoneKm`, `baseDate = lastDoneDate`. No escribe la proyección (`lastDoneJobId`, `completedByJobId`): la guarda la reconciliación de la app cuando el dueño la abre; mientras tanto el cron sigue con los `lastDone*` guardados, que no cambian. Informa por auto cuántos quedaron con base propia y cuántos con base null. Idempotente. Orden: publicar las reglas → simulacro → `--apply` → deploy de la app → `--apply` otra vez (completa lo que creó o editó la PWA vieja, que reescribe el documento sin la base; una tercera corrida da 0 cambios). Va antes del deploy porque la app nueva, sin base, usa la "última vez" guardada como base, y borrar o corregir el trabajo que la puso no la haría volver atrás.
