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
| Server | 5 Route Handlers (Node runtime) con `firebase-admin` | `app/api/**/route.ts` |
| Fotos | Cloudinary, subida firmada directa desde el navegador | `lib/cloudinary-*.ts` |
| Push | Web Push (VAPID, `web-push`), service worker `public/sw.js` | `lib/push-*.ts` |
| PDF | `@react-pdf/renderer` en el cliente | `components/report/` |
| Hosting | Vercel + Vercel Cron (1/día) + Analytics + Speed Insights | `vercel.json` |
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
| `components/achievements/`, `novedades/`, `pending/`, `report/` | Features transversales |
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
- Cliente: `deleteImage(publicId, idToken)` (traga errores; la foto queda huérfana).

#### `POST /api/push/test`
- Propósito: notificación de prueba a los dispositivos del usuario.
- Auth: `authorize`.
- Input: sin body.
- 200: `{ sent: number }` · 401 · 403 · 500.
- Interno: `sendToUser(uid, [payload])` → lee `users/{uid}/pushSubscriptions` (5 más recientes), borra las que dan 404/410. Lo llama `app/(app)/ajustes/page.tsx`.

#### `GET /api/cron/daily`
- Propósito: avisos push diarios de mantenimientos por vencer/vencidos y recordatorio semanal de km.
- Auth: `Authorization: Bearer $CRON_SECRET` (comparación en tiempo constante). Si no → 401.
- Schedule: `0 12 * * *` UTC (`vercel.json`). `maxDuration = 60`, presupuesto 40 s, 5 usuarios en paralelo, orden aleatorio.
- 200: `{ ok: true, users: number, skipped: number, report: { uid, messages, sent, error? }[] }`
- Interno: por cada `users/{uid}` → `cars where ownerUid == uid` → `cars/{id}/rules` (tope 1000 docs) y, en paralelo, la lectura de más km de cada auto (`cars/{id}/odometer` `orderBy('km', 'desc').limit(1)`, índice simple automático; una por auto, dentro del tope) → el km de cada auto para los avisos es esa lectura (`carKmForNotifications`: `currentKm` y `kmUpdatedAt` de la lectura, o lo guardado si no tiene; `avgKmPerDay` del auto), no el `currentKm` guardado → `planDailyNotifications()` (`lib/notifications.ts`, máx. 6 mensajes; saltea los recordatorios cumplidos, `completedByJobId != null`) → `sendToUser()` → `bulkWriter` actualiza `rules.lastNotifiedAt/lastNotifiedStatus` sólo de lo entregado (`updatesToPersist`). **Sólo avisa al dueño**, no a los miembros. Usa la proyección guardada de cada mantenimiento (`lastDone*`, `completedByJobId`), sin leer trabajos: si una escritura falló y el dueño no volvió a abrir la app, trabaja con la proyección vieja (lo mismo que el km). `ruleFrom` del cron tiene la misma lectura tolerante de la base que el de `lib/db.ts`.

### 2.2 Data layer (Firestore desde el cliente, `lib/db.ts`)

Estos son los "endpoints" reales del CRUD. Todas son `async`, resuelven cuando el servidor confirma (offline quedan pendientes; envolver con `settle()` de `lib/use-saver.ts`). Errores de permisos: `FirebaseError` `code: 'permission-denied'`.

Leyenda Auth: **O** = dueño del auto (`car.ownerUid == uid`), **M** = miembro (`emailLower in car.members`), **U** = el propio usuario (`users/{uid}`).

#### Lectura

| Función | Input | Output / efecto |
|---|---|---|
| `subscribeUserData(uid, email, onChange, onError)` | `email` en minúscula o null | Listeners: `users/{uid}`, `users/{uid}/achievements`, `cars where ownerUid==uid` ∪ `cars where members array-contains email`, y por auto `rules`, `jobs`, `fuel`, `odometer`. Emite `Partial<UserData>` por parte. Crea `users/{uid}` con `DEFAULT_SETTINGS` si no existe. Auto revocado (`permission-denied`) → se quita sin error. |
| `useData()` | — | `UserData` + `{ uid, email, actor, loading, error, today, carById: Map, rulesByCar: Map<carId, RuleWithState[]> }`. `rules` son todos los mantenimientos (también los cumplidos) con la proyección calculada en memoria (`projectRules` con los trabajos y las lecturas), así la UI no espera a que se guarde; `rulesByCar`, sólo los activos (`activeRules`). Jobs/fuel ordenados por fecha desc. `car.currentKm`/`kmUpdatedAt` = los de la lectura más alta (`topReading`) aunque el guardado sea mayor o menor; sin lecturas, lo guardado. |
| `useCar(carId)` | — | `{ car: Car \| null, rules: RuleWithState[] (activos), completed: MaintenanceRule[] (cumplidos), allRules: MaintenanceRule[] (todos), jobs, fuel, readings }` |

`UserData = { settings: UserSettings, cars: Car[], rules: MaintenanceRule[], jobs: Job[], fuel: FuelLoad[], odometer: OdometerReading[], achievements: AchievementRecord[] }`

#### Autos — `cars/{carId}`

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `newCarId()` | — | — | `string` (id antes de crear, para la foto) |
| `createCar(actor, data: CarInput, initialKm, carId?)` | U (queda O) | `CarInput = { brand, model, version, year, plate, fuelTypes, photoUrl?, photoPublicId? }` | batch: `cars/{id}` (`ownerUid`, `ownerName`, `members: []`, `currentKm`, `kmUpdatedAt`, `avgKmPerDay: null`, `createdAt`) + `odometer` `source:'initial'`, `sourceId: null`, `createdAt`. → `carId` |
| `updateCar(actor, carId, Partial<CarInput>)` | O | — | `cars/{id}` |
| `deleteCar(actor, carId, known?)` | O | `known: { rules?, jobs?, fuel?, odometer?: string[] }` | Borra hijos (tandas de 450) y al final el auto. Las reglas dejan al dueño borrar lecturas sin consultar su registro, por el tope de llamadas por pedido |
| `addMember(actor, carId, email)` | O | email normalizado; validar antes con `memberError()` (`lib/sharing.ts`) | `members: arrayUnion` (máx. 2) |
| `removeMember(actor, carId, email)` | O | — | `members: arrayRemove` |
| `leaveCar(actor, carId, email)` | M | su propio email | `members: arrayRemove` |

#### Km — `cars/{carId}/odometer/{id}`

Dos tipos de lectura:
- **Sin `sourceId`** (`initial`, `manual` y las viejas): id al azar. Se cargan con `recordKm` y se borran con `deleteReading`. Una manual de hoy lleva la hora en que se cargó; una con fecha pasada, el mediodía de ese día (`readingDateOf`).
- **Vinculadas** (`source` `'fuel'` o `'job'` + `sourceId`): una por carga o trabajo aprobado con km, con id `fuel-{id}` / `job-{id}` (`linkedReadingId`), fecha = la del registro a las 12:00 (`readingDateOf`) y `createdBy` = autor del registro. Las escribe `writeLinkedReading` (interna de `lib/db.ts`) en el mismo batch que la carga o el trabajo: con km la pone o la pisa (aunque sea menor al km actual), sin km o al borrar el registro la borra, y actualiza `currentKm`, `kmUpdatedAt`, `avgKmPerDay` con `carKmFrom` sobre las lecturas resultantes (el km puede bajar). No se borran desde la pestaña Km.
- Toda lectura nueva graba `createdAt` (cuándo se cargó en la app, para los logros). Al pisar una vinculada se conserva el `createdAt` que tenía en memoria. Las de la 1.3.0 o anteriores no lo tienen (`null`).

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `recordKm(actor, car, readings, km, date: ISODate)` | O, M | validar antes con `validateKmReading(km, date, lecturas del auto)` (`lib/odometer.ts`); `date` = hoy por defecto en `km-form`, nunca futura | lectura `source:'manual'`, `sourceId: null`, id al azar, `createdAt` (`addManualReading`); fecha = ahora si `date` es hoy, si no `readingDateOf(date)` + km del auto recalculado con `carKmFrom` (una lectura vieja con menos km no lo baja) |
| `deleteReading(actor, car, readings, readingId)` | O; M sólo propias | sólo lecturas sin `sourceId` (con `sourceId` tira error) | Borra y recalcula km. Error si es la única lectura |
| `restoreReading(actor, car, readings, reading)` | igual | `OdometerReading` sin `sourceId` | "Deshacer" |
| `syncCarKm(actor, carId, readings)` | O, M | — | Escribe `currentKm`, `kmUpdatedAt`, `avgKmPerDay` con `carKmFrom` (sube o baja a la lectura más alta). Lo llama `DataProvider` solo cuando `kmCorrection(car, readings)` no es null, sólo con `cars` y `odometer` confirmados por el servidor (no caché), 2 s después del último cambio; una corrección que falló no se reintenta |

#### Mantenimientos — `cars/{carId}/rules/{id}` (plan del dueño; M sólo lee)

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `saveRule(actor, { jobs, readings }, data: RuleInput, ruleId?)` | O | `RuleInput = { carId, name, intervalKm, intervalTime, repeat, baseKm, baseDate, warnKm, warnDays }` (lo declarado; la "última vez" es la base); defaults de aviso: `defaultWarnings()` | Crear: `set` de lo declarado + la proyección (`projectRule` con los trabajos de `ctx`). Editar: `update` de lo declarado + la proyección recalculada con la base nueva, borra `intervalMonths`. Nunca escribe `lastDone*` del formulario. Resetea `lastNotified*`. → `ruleId` |
| `syncRuleProjection(actor, change: ProjectionChange)` | O | `{ ruleId, carId, patch }` de `projectionDiff` | `update` de la proyección (y `lastNotified*: null` si el patch lo trae). Lo llama la reconciliación de `DataProvider` |
| `deleteRule(actor, carId, ruleId)` | O | — | — |
| `restoreRule(actor, rule)` | O | `MaintenanceRule` | "Deshacer": `set` con lo declarado y la proyección que tenía |

**Proyección** (`lib/maintenance.ts`, pura). Lo declarado (`baseKm`, `baseDate`, la "última vez" que carga el dueño) se separa de lo derivado de los trabajos aprobados (`lastDoneKm`, `lastDoneDate`, `lastDoneKmEstimated`, `lastDoneJobId`, `completedByJobId`), que se guarda sólo como caché para el cron.
- `projectRule(rule, jobs, readings)`: manda el trabajo aprobado más reciente del auto que marca el mantenimiento y no es anterior a la base (`>=`: uno de la misma fecha le gana); empate de fecha entre trabajos → `createdAt`, después id. Periódico: fecha del trabajo y, si tiene intervalo de km, `jobDoneKm` (el del trabajo o el estimado, `lastDoneKmEstimated: true`); sin intervalo de km, `lastDoneKm: null`. De una vez: `completedByJobId` = el trabajo, conserva su base. Sin trabajos: la base.
- `projectionPatch(stored, next)` / `projectionDiff(rules, jobs, readings)` → `ProjectionChange { ruleId, carId, patch }[]`. El patch pone `lastNotifiedAt/lastNotifiedStatus: null` si cambia `lastDoneDate`, `completedByJobId` o el `lastDoneKm` de uno por km que no es estimado antes y después; un estimado que se ajusta se guarda sin volver a avisar. Aplicar el diff y recalcular da vacío.
- `jobChangeDiff({ rules, jobs, readings, readingsAfter?, before, after })`: los cambios de un trabajo que pasa de `before` a `after` (null = no existe), comparando la proyección con el trabajo como estaba contra como queda (sirve con datos de antes de borrar, para "Deshacer"). `describeProjectionChange(rule, next)` arma el texto de las confirmaciones.
- `isCompleted`, `activeRules`, `projectRules`, `projectionKey`.

**Reconciliación** (`DataProvider`): en los autos propios (`isCarOwner`), con `cars`, `rules`, `jobs` y `odometer` confirmados por el servidor, 2 s después del último cambio, `projectionDiff` con lo guardado y `syncRuleProjection` de cada cambio. Una clave `ruleId:patch` (`projectionKey`) en un `useRef` evita repetirlo; uno que falló no se reintenta. Es determinística: dos pestañas escriben lo mismo y no compiten. Arregla un batch de un trabajo que falló, lo que escribe la versión anterior de la PWA y los estimados que se mueven.

**Lectura tolerante** (`ruleFrom` en `lib/db.ts` y en el cron): si el documento no tiene `baseDate` (lo creó o editó la versión anterior de la PWA, que reescribe el documento), la base es `lastDone*`; si tiene `baseKm`/`baseDate` en null, la base es null.

**Cumplidos** (`completedByJobId != null`): no son mantenimientos activos. No están en `rulesByCar` (ni en la pantalla de inicio, `car-card`, `km-form`, el PDF ni `pendingItems`, que además los filtra), ni en los logros (`mineForAchievements`), ni en el cron. La pestaña Estado los muestra en "Cumplidos", plegados, con link al trabajo; `job-form` muestra marcado el que cumplió ese mismo trabajo, para poder desmarcarlo. La página del mantenimiento los busca en `allRules`.

Estado calculado (no se guarda, con la proyección en memoria): `getRuleState()` / `rulesWithState()` en `lib/maintenance.ts` → `RuleState { status: 'ok'|'soon'|'overdue'|'unknown', nextKm, nextDate, remainingKm, remainingDays, dueBy: 'km'|'date'|null, estimatedKmDate, daysUntilDue, progress: 0-100+ }`. Un mantenimiento por km con `lastDoneKm == null` (`missingLastKm`) se calcula sólo por fecha, y la tarjeta (pestaña Estado) y la ficha dicen "Falta el km de la última vez". Un `lastDoneKm` estimado se muestra "≈ 48.300 km (estimado)" (`formatLastDoneKm`). `rule-form` edita la base ("Última vez (si no hay trabajos)"); si un trabajo manda, muestra "Según el trabajo «X» del dd/mm" con link (o "Cumplido con…"), y exige el km y la fecha de la base sólo si no hay un trabajo que mande.

#### Trabajos — `cars/{carId}/jobs/{id}`

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `saveJob(actor, ctx, data: JobInput, existing?: Job, followUp?)` | O; M crea/edita propios no aprobados | `ctx = { car, rules, jobs, readings }` (`rules`: todos los del auto, también los cumplidos); `JobInput = { carId, date, km, title, category, cost, workshop, notes, ruleIds }`; `existing`: el `Job` anterior completo; `followUp = { name, intervalTime }` | `set merge` del trabajo; O sobre uno nuevo o aprobado: `status:'approved'` y `applyJobChange` (lectura vinculada `job-{id}` a nombre del autor del trabajo o, sin km, la borra; recalcula los mantenimientos que marca antes o después; crea regla de una vez si `followUp`, con `baseDate` = fecha del trabajo). M, o O sobre uno sin aprobar: sin lectura ni cambios en los mantenimientos (M lo deja `pending`). → `jobId` |
| `approveJob(actor, ctx, job)` | O | `Job` pendiente | `status:'approved'`, `reviewedAt` + `applyJobChange` (lectura `job-{id}` a nombre del autor; sin km, el estimado a la fecha del trabajo, no el de hoy) |
| `rejectJob(actor, ctx, job)` | O | `Job` | `status:'rejected'`, `reviewedAt` + `applyJobChange`: si estaba aprobado, borra `job-{id}`, recalcula km y sus mantenimientos vuelven a como estaban antes de él |
| `deleteJob(actor, ctx, job)` | O; M propios no aprobados | `Job` | Borra el trabajo + `applyJobChange`: si estaba aprobado, borra `job-{id}`, recalcula km y sus mantenimientos vuelven al trabajo anterior o a la base (un cumplido vuelve a estar activo) |
| `restoreJob(actor, ctx, job)` | igual | `Job` | "Deshacer": el trabajo y, si estaba aprobado, su lectura y sus mantenimientos (`ctx` puede ser el de antes de borrar) |

`applyJobChange(actor, ctx, before, after, writeJob)` (interna): camino único para crear, editar, aprobar, rechazar, borrar y restaurar. El trabajo y su lectura vinculada van en un batch; cada mantenimiento que cambia (`jobChangeDiff`) va en su propio batch (un mantenimiento borrado en otro dispositivo no tira abajo el trabajo). El trabajo se commitea primero y los mantenimientos no se esperan; si alguno falla, lo corrige la reconciliación. Ningún trabajo borra un mantenimiento.

Permisos de UI: `canEditJob(car, uid, job)`; sólo cuentan en gastos/reportes `approvedJobs()` (`lib/sharing.ts`).

`job-form`: el km arranca vacío. Si se marca un mantenimiento por km (`kmRulesOf`) y el km queda vacío, el campo muestra el estimado (`jobDoneKm`) como sugerencia y el trabajo se guarda con `km: null` (la proyección usa el estimado); sin estimación, el km es obligatorio. La confirmación dice "Km (estimado)". Para marcar ofrece los mantenimientos activos y el que cumplió ese mismo trabajo (marcado). Al editar o borrar un trabajo aprobado, la confirmación lista cómo queda cada mantenimiento que cambia (`jobChangeDiff`, `describeProjectionChange`).

#### Combustible — `cars/{carId}/fuel/{id}`

| Función | Auth | Input clave | Escribe |
|---|---|---|---|
| `saveFuel(actor, { car, readings }, data: FuelInput, existing?)` | O; M propias | `FuelInput = { carId, date, km, fuelType, grade, quantity, unitPrice, total, fullTank, station }`; calcular montos con `resolveFuelAmounts()` (`lib/fuel.ts`); `existing: Pick<FuelLoad, 'id' \| 'createdBy' \| 'createdByName'>` al editar | `set merge` + lectura vinculada `fuel-{id}` a nombre del autor de la carga (o la borra si no tiene km) + km recalculado. → `fuelId` |
| `deleteFuel(actor, { car, readings }, load)` | O; M propias | `FuelLoad` | Borra la carga y `fuel-{id}`, recalcula km |
| `restoreFuel(actor, { car, readings }, load)` | igual | `FuelLoad` | "Deshacer": la carga y su lectura |

Permisos de UI: `canEditEntry(car, uid, record)`.

#### Usuario — `users/{uid}/…` (sólo U)

| Función | Input | Escribe |
|---|---|---|
| `saveSettings(uid, Partial<UserSettings>)` | `{ reminder: { enabled, weekday 0-6 }, timezone }` | `users/{uid}` merge |
| `savePushSubscription(uid, sub.toJSON())` | `PushSubscriptionJSON` | `pushSubscriptions/{sha256(endpoint)}` `{ endpoint, keys{p256dh,auth}, userAgent, createdAt }` |
| `deletePushSubscription(uid, endpoint)` | — | — |
| `unlockAchievements(uid, [{ id, carId }])` | ids de `ACHIEVEMENTS` | Transacción idempotente `achievements/{id}` `{ carId, unlockedAt, celebratedAt: null }` → creados |
| `markAchievementsCelebrated(uid, ids)` | — | `celebratedAt = now` |

Wrappers de cliente: `enablePush(uid)` / `disablePush(uid)` / `pushSupport()` en `lib/push-client.ts`.

### 2.3 Rutas de UI (`app/`)

| Ruta | Pantalla | Params |
|---|---|---|
| `/login` | Login Google | `?next=/ruta` |
| `/` | Inicio: autos y pendientes | — |
| `/autos/nuevo` | Alta de auto (`car-form`) | — |
| `/autos/[carId]` | Detalle del auto; salir de un auto compartido (`leaveCar`) | `?tab=estado\|trabajos\|combustible\|km` |
| `/autos/[carId]/editar` | Editar auto (`car-form`), compartir: `addMember`/`removeMember` | — |
| `/autos/[carId]/km` | Cargar km (`km-form`, también como diálogo): fecha opcional, hoy por defecto | — |
| `/autos/[carId]/mantenimientos/nuevo` · `/[ruleId]` | Alta / edición de mantenimiento | — |
| `/autos/[carId]/trabajos/nuevo` · `/[jobId]` | Alta / edición de trabajo | `?regla=<ruleId>` (precarga) |
| `/autos/[carId]/combustible/nuevo` · `/[fuelId]` | Alta / edición de carga | — |
| `/trabajos` | Historial de trabajos (todos los autos) | — |
| `/gastos` | Resumen de gastos por año/mes | `?auto=<carId>` |
| `/logros` | Logros | — |
| `/novedades` | Changelog para usuarios (`lib/novedades.ts`). Entrar marca todo como visto. Fuera de esta pantalla, `NovedadesHost` anuncia con una ventana todas las versiones sin ver (después de los logros por festejar) | — |
| `/ajustes` | Recordatorio semanal, zona horaria, push, versión | — |

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
users/{uid}                       UserSettings + createdAt                U
  ├─ pushSubscriptions/{sha256}   { endpoint, keys, userAgent, createdAt } U
  ├─ achievements/{achievementId} { carId, unlockedAt, celebratedAt }     U
  └─ cars|rules|jobs|fuel|odometer  LEGADO (pre-migración 1.1.2), sólo lectura/limpieza; la app no los usa
cars/{carId}                      Car                                     O rw · M read + update km/salir
  ├─ rules/{id}                   MaintenanceRule                         O rw · M read
  ├─ jobs/{id}                    Job                                     O rw · M ver §2.2
  ├─ fuel/{id}                    FuelLoad                                O rw · M propias
  └─ odometer/{id}                OdometerReading                         O rw · M propias (vinculadas: ver reglas)
```

Relaciones:
- User 1:N Car (owner, `cars.ownerUid`). User N:M Car (member, `cars.members[]` por email, máx. 2).
- Car 1:N MaintenanceRule / Job / FuelLoad / OdometerReading (subcolecciones; cada hijo repite `carId`).
- Job N:M MaintenanceRule vía `job.ruleIds[]`: el estado de cada mantenimiento se deriva de sus trabajos aprobados (`projectRule`); `rule.lastDoneJobId` / `rule.completedByJobId` apuntan al trabajo que manda.
- FuelLoad / Job aprobado 1:0..1 OdometerReading vía `odometer/{fuel|job}-{id}` con `sourceId` (sólo si el registro tiene km).
- User 1:N AchievementRecord, 1:N PushSubscription.

### Entidades (`lib/types.ts`)

| Entidad | Campos (tipo app; en Firestore `Date`→`Timestamp`) |
|---|---|
| `Car` | `id, brand, model, version?, year?, plate?, fuelTypes: ('nafta'\|'gasoil'\|'gnc')[], currentKm, kmUpdatedAt?, avgKmPerDay?, photoUrl?, photoPublicId?, createdAt, ownerUid, ownerName?, members: string[]` |
| `MaintenanceRule` | `id, carId, name, intervalKm?, intervalTime?: { amount, unit: 'day'\|'week'\|'month'\|'year' }, repeat: bool`; declarado: `baseKm?, baseDate?: ISODate` (la "última vez" a mano; sin los campos = `lastDone*`, ver lectura tolerante); proyección (caché de `projectRule`): `lastDoneKm?, lastDoneKmEstimated: bool (lastDoneKm salió de las lecturas; falta = false), lastDoneDate?: ISODate, lastDoneJobId?, completedByJobId?` (de una vez cumplido); `warnKm (500), warnDays (30), lastNotifiedAt?, lastNotifiedStatus?: 'soon'\|'overdue'` |
| `Job` | `id, carId, date: ISODate, km?, title, category: JobCategory, cost, workshop?, notes?, ruleIds: string[], status: 'approved'\|'pending'\|'rejected' (falta = approved), reviewedAt?, createdBy?, createdByName?, createdAt` |
| `FuelLoad` | `id, carId, date: ISODate, km?, fuelType, grade?: 'super'\|'premium' (null en GNC), quantity (L o m³), unitPrice, total, fullTank, station?, createdBy?, createdByName?, createdAt` |
| `OdometerReading` | `id, carId, km, date: Date, source: 'initial'\|'manual'\|'job'\|'fuel', sourceId: string \| null (id de la carga o del trabajo; null en alta, manual y viejas), createdBy?, createdByName?, createdAt: Date \| null (cuándo se cargó en la app; null en las viejas)` |
| `AchievementRecord` | `id (= id del logro), carId?, unlockedAt, celebratedAt?` |
| `UserSettings` | `reminder: { enabled (true), weekday (0 = domingo) }, timezone ('America/Argentina/Buenos_Aires')` |
| `Actor` | `{ uid, name? }` — autor de una escritura |

Enums: `JobCategory = service|reparacion|cubiertas|frenos|electricidad|carroceria|documentacion|otros`. Combinaciones válidas de `fuelTypes`: `['nafta']`, `['nafta','gnc']`, `['gasoil']`. Presets: `RULE_PRESETS`, `INTERVAL_PRESETS`.

### Validación en `firestore.rules`

- Cada colección tiene una **allowlist de campos** (`validCar`, `validRule`, `validJob`, `validFuel`, `validReading`, `validSettings`, `validPushSubscription`, `validAchievement`) con tipos y topes de largo.
- **Campo nuevo ⇒** agregarlo en `lib/types.ts`, en el mapper `xxxFrom` de `lib/db.ts` (y en `app/api/cron/daily` si el cron lo lee), en la función `validXxx` de `firestore.rules`, y **publicar las reglas a mano** (paso manual del usuario) antes de deployar la app.
- Colección o ruta nueva ⇒ `match` nuevo; cualquier ruta no listada se deniega.
- `validRule` acepta `lastDoneKmEstimated` (`optBool`) y `validReading` acepta `createdAt` (`optTime`); los dos pueden faltar (lo que escribe la 1.3.0).
- `validRule` acepta `baseKm` (`optNum`), `baseDate` (`optText` 30), `lastDoneJobId` (`optText` 100) y `completedByJobId` (`optText` 100); pueden faltar (lo que escribe la 1.4.1). Los permisos no cambian: sólo el dueño escribe `rules`.
- **Lecturas vinculadas** (`odometer`): `linkedOk` exige, si viene `sourceId`, `source` en `fuel`\|`job`, id = `{source}-{sourceId}` y que el registro exista después del batch (`existsAfter(linkedParent)`; la ruta usa `jobs` si `source == 'job'`). `sourceId` no cambia al editar. Borrar: el dueño, cualquier lectura sin consultar el registro (`deleteCar`); el miembro, una que no existe (`resource == null`) o una suya sin `sourceId` o cuyo registro ya no existe o no tiene km (`linkedReleased`).

### Lógica de dominio pura (sin I/O)

| Módulo | Funciones clave |
|---|---|
| `maintenance.ts` | `getRuleState`, `rulesWithState`, `describeRemaining`, `defaultWarnings`, `projectRule(rule, jobs, readings)`, `projectRules`, `projectionPatch`, `projectionDiff`, `jobChangeDiff`, `describeProjectionChange`, `isCompleted`, `activeRules`, `rulingJob` (proyección: ver §2.2), `jobDoneKm(job, readings)` (km del trabajo o estimado a su fecha, sin la lectura `job-{id}`), `kmRulesOf`, `formatLastDoneKm`, `missingLastKm` |
| `odometer.ts` | `computeAvgKmPerDay`, `topReading`, `carKmFrom` (km del auto desde sus lecturas), `kmCorrection(car, readings)` (`carKmFrom` si el `currentKm` guardado no es el de la lectura más alta, en los dos sentidos; null si coincide o no hay lecturas), `carKmForNotifications(car, top)` (el auto con `currentKm`/`kmUpdatedAt` de la lectura más alta, para el cron), `linkedReadingId`, `readingDateOf`, `withLinkedReading`, `readingOrigin` (texto y link de la pestaña Km), `kmAtDate(readings, date)` (km a una fecha: el del día, interpolado o el de la última; `estimated`), `neighborsAt(readings, date)` (lectura de más km de ese día o antes / de menos km después, por día local), `validateKmReading(km, date, readings)`, `entryKmWarning(entry, car, readings)` (salto, km del último registro en fecha anterior y coherencia con la serie, sin la lectura propia `entry.readingId`) |
| `fuel.ts` | `resolveFuelAmounts`, `computeFuelStats`, `computeCostPerKm`, `lastPrices` |
| `expenses.ts` | `summarizeExpenses(jobs, fuel, year, today)`, `expenseYears` |
| `pending.ts` | `pendingItems()` → `PendingItem` (`km`\|`rule`\|`review`\|`rejected`\|`shared`; sin los recordatorios cumplidos), `urgentCount` |
| `achievements.ts` | `ACHIEVEMENTS`, `evaluateAchievements`, `pendingUnlocks`, `pendingCelebrations`. Rachas y seguimiento usan la fecha en que se cargó cada lectura: `createdAt` del registro en las vinculadas, el de la lectura en las demás, o `date` si falta |
| `sharing.ts` | `isCarOwner`, `isSharedCar`, `canEditEntry`, `canEditJob`, `approvedJobs`, `memberError`, `authorLabel`, `mineForAchievements` (sin mantenimientos de autos ajenos ni recordatorios cumplidos), `MAX_MEMBERS = 2` |
| `report.ts` | `buildServiceReport` (PDF de historial), `reportFileName` |
| `notifications.ts` | `planDailyNotifications` (saltea los recordatorios cumplidos), `updatesToPersist`, `isPushEndpoint` |
| `dates.ts` / `format.ts` | `ISODate` helpers / formato es-AR (`formatKm`, `formatMoney`, `formatDate`, `formatDayMonth`) |

---

## 4. Servicios externos y jobs

| Servicio | Uso | Config (env) |
|---|---|---|
| Firebase Auth | Login Google; ID token para las API routes. `/__/auth/*` reescrito al dominio de la app (Safari/iOS) | `NEXT_PUBLIC_FIREBASE_*` |
| Firestore | Datos, caché offline multi-pestaña | ídem |
| Firebase Admin | API routes y cron (no pasa por las reglas) | `FIREBASE_ADMIN_PROJECT_ID`, `_CLIENT_EMAIL`, `_PRIVATE_KEY` |
| Cloudinary | Fotos de autos en `autocar/{uid}/{uuid}`, 1600 px, 10 fotos/día; URLs con `cloudinaryUrl(url, transform)` | `CLOUDINARY_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` |
| Web Push | VAPID; payload `{ title, body, url, tag }`; `public/sw.js` abre `url` al tocar | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Vercel Cron | `GET /api/cron/daily` 12:00 UTC | `CRON_SECRET` |
| Vercel Analytics / Speed Insights | Métricas | — |
| GitHub Actions | `ci.yml`: `next typegen` + typecheck + tests | — |

Seguridad HTTP: CSP y headers en `next.config.mjs`. Un dominio externo nuevo (img, connect, frame) ⇒ agregarlo a la CSP.

Sin webhooks entrantes ni colas. Scripts manuales (Admin SDK, los corre el usuario; sin `--apply` son un simulacro):
- `scripts/migrate-cars.mjs [--apply]`: `users/{uid}/…` → `cars/…` (1.1.2).
- `scripts/link-readings.mjs [--apply]` (lógica pura en `scripts/link-readings-plan.mjs`): crea `baseline-{carId}` (`source:'initial'`) en los autos sin lecturas o con `currentKm` mayor que sus lecturas, vincula las lecturas viejas de cargas y trabajos con un solo candidato del mismo km (copia a `{source}-{id}` y borra la vieja), completa las que faltan e informa las ambiguas y las sin candidato. Idempotente. Orden: publicar las reglas → simulacro → `--apply` → deploy de la app → `--apply` otra vez (vincula lo que escribió la PWA vieja; una tercera corrida da 0 cambios). Va antes del deploy porque la app nueva recalcula el km desde las lecturas y un auto viejo bajaría sin su baseline.
- `scripts/rebase-rules.mjs [--apply]` (lógica pura en `scripts/rebase-rules-plan.mjs`): a cada mantenimiento sin `baseKm`/`baseDate` (ausentes, no null) le escribe la base con `update`: null si su `lastDoneDate` es la de un trabajo aprobado del auto que lo tiene en `ruleIds` (la "última vez" la puso el trabajo), y si no, `baseKm = lastDoneKm`, `baseDate = lastDoneDate`. No escribe la proyección (`lastDoneJobId`, `completedByJobId`): la guarda la reconciliación de la app cuando el dueño la abre; mientras tanto el cron sigue con los `lastDone*` guardados, que no cambian. Informa por auto cuántos quedaron con base propia y cuántos con base null. Idempotente. Orden: publicar las reglas → simulacro → `--apply` → deploy de la app → `--apply` otra vez (completa lo que creó o editó la PWA vieja, que reescribe el documento sin la base; una tercera corrida da 0 cambios). Va antes del deploy porque la app nueva, sin base, usa la "última vez" guardada como base, y borrar o corregir el trabajo que la puso no la haría volver atrás.
