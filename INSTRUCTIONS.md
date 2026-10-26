# AutoCar: instrucciones técnicas

Cómo correr, configurar y publicar AutoCar, y las decisiones técnicas que conviene conocer antes de tocar el código. Para saber qué es la app y qué hace, mirá el [README](README.md).

**Stack:** Next.js 16 (App Router) · Tailwind 4 · Firebase Auth (Google) + Firestore · Cloudinary (fotos) · Web Push (VAPID) · Vercel Cron.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # tests de la lógica (vencimientos, combustible, gastos, avisos, logros)
npm run typecheck
npm run build
npm run manual     # regenera el manual de usuario en PDF (docs/manual-de-usuario.pdf)
```

Las variables van en `.env.local` (ver `.env.local.example`).

GitHub Actions (`.github/workflows/ci.yml`) corre `typecheck` y `npm test` en cada PR y en cada push a `main`. Vercel publica igual aunque fallen: el aviso está en el PR o en el commit.

### Ramas y versiones

- `main` es producción: Vercel publica cada push.
- `develop` junta lo que va a salir. Cada cambio se hace en una rama que sale de `develop` y vuelve con un PR.
- Para publicar, se abre un PR de `develop` a `main`. La versión está en `package.json` (se ve al final de Ajustes) y los cambios de cada versión, en [CHANGELOG.md](CHANGELOG.md).

### Detalles del build

`npm run build` usa **webpack** a propósito (`next build --webpack`); `npm run dev` sigue con Turbopack. El build de producción con Turbopack carga `firebase-admin` con un alias con hash (`firebase-admin-<hash>`) que es un symlink absoluto a la máquina del build: en Vercel no existe y **todas las API routes (y el cron) responden 500 vacío**. Para comprobarlo localmente: build con `output: 'standalone'` y correr `.next/standalone/server.js` sin el `node_modules` del proyecto.

`package.json` fuerza `jose` 5 para `jwks-rsa` (`overrides`). `firebase-admin` usa `jwks-rsa`, y `jwks-rsa` hace `require('jose')`. `jose` 6 es sólo ESM, y el runtime de funciones de Vercel no acepta `require()` de ESM, aunque use Node 24. Sin el override, todas las API routes fallan con `ERR_REQUIRE_ESM` y responden 500 vacío. `jwks-rsa` sólo usa `importJWK` y `exportSPKI`, que funcionan igual en `jose` 5, y `jose` 5 todavía trae una versión CommonJS.

## Puesta en marcha

### 1. Firebase

1. Crear un proyecto en <https://console.firebase.google.com> (Analytics no hace falta).
2. **Authentication → Comenzar → Google** → habilitar.
3. **Firestore Database → Crear base de datos** → ubicación `southamerica-east1` → modo producción.
4. **Cuentas**: no hay que crear nada. La app está abierta a cualquier cuenta de Google con mail verificado: la primera vez que alguien entra, el servidor lo registra en la colección `allowlist` (`allowlist/{mail}`), que es lo que piden las reglas.
5. **Firestore → Reglas**: pegar el contenido de [`firestore.rules`](firestore.rules) y publicar.
6. **Configuración del proyecto → General → Tus apps → Web (`</>`)**: registrar la app y copiar los valores de `firebaseConfig` a las variables `NEXT_PUBLIC_FIREBASE_*`.
7. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**: del JSON, copiar `project_id`, `client_email` y `private_key` a `FIREBASE_ADMIN_*` (la clave entre comillas dobles, con los `\n`). Después borrá el JSON: con las variables alcanza.

### 2. Cloudinary

Completar `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` (Dashboard de Cloudinary). El secret sólo lo usa el servidor para firmar las subidas; las fotos quedan en la carpeta `autocar/<uid>`.

Fotos (`lib/photo-limits.ts`): se aceptan archivos de hasta 25 MB y el navegador los achica a JPG de 1600 px (quedan en unos cientos de KB) antes de subirlos. La firma del servidor además limita los formatos (JPG/PNG/WebP) y achica al guardar, por si alguien saltea el navegador. Cada cuenta puede subir hasta 10 fotos por día (contador en `usage/{uid}`, que sólo toca el servidor). El contador suma al firmar, antes de subir, así que permite 15 firmas por día: una subida que falla por la señal se puede reintentar sin gastar el cupo. El plan gratis de Cloudinary no acepta imágenes de más de 10 MB.

### 3. Web Push

Las claves VAPID se generan con:

```bash
npx web-push generate-vapid-keys
```

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` = pública, `VAPID_PRIVATE_KEY` = privada. En iPhone las notificaciones funcionan sólo con la app agregada a la pantalla de inicio (iOS 16.4+).

### 4. Deploy en Vercel

1. Subir el repo a GitHub e importarlo en Vercel.
2. Cargar todas las variables de `.env.local` en *Settings → Environment Variables* (incluido `CRON_SECRET`).
3. En Firebase **Authentication → Configuración → Dominios autorizados**, agregar el dominio de Vercel.
4. Opcional (recomendado para iPhone): poner `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` = dominio de Vercel y agregar `https://<dominio>/__/auth/handler` como URI de redirección autorizada del cliente OAuth en Google Cloud Console. La app ya redirige `/__/auth/*` a Firebase.
5. El cron (`vercel.json`) corre todos los días a las 12:00 UTC (9:00 en Argentina) y:
   - el día elegido en Ajustes, pide los km de cada auto;
   - avisa de los mantenimientos que entran en "Próximo" o "Vencido" (y repite cada 7 días si siguen así).

Para probarlo a mano:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/daily
```

Después de publicar, `curl -X POST https://<dominio>/api/access` tiene que responder 401 con JSON (no 500): así se sabe que las API routes cargan bien.

## Marca

- `assets/brand/autocar-logo.png` es el logo original (fuente, no se sirve).
- `npm run brand` regenera desde ese archivo el logo con fondo transparente (`public/brand/*.webp`), los íconos de la PWA (`public/icon-*.png`) y `app/apple-icon.png`.
- `app/favicon.ico` es el favicon provisto por diseño.
- Colores: azul del logo `#1A9CFB` como acento (`primary`); verde/amarillo/rojo quedan reservados para los estados (`success`, `warning`, `destructive`). Todo está en tokens en `app/globals.css`.
- Las capturas del README están en `docs/screenshots/` (375 × 812, con la patente pixelada).

## Manual de usuario

`npm run manual` genera [`docs/manual-de-usuario.pdf`](docs/manual-de-usuario.pdf) (A4, para imprimir) con `@react-pdf/renderer`, la misma librería del historial en PDF.

- El texto está en `scripts/manual/content.mjs`: capítulos con bloques (párrafos, pasos, tablas, notas, figuras). Los nombres de botones van entre `**`.
- Las capturas están en `scripts/manual/img/`: 375 px de ancho, sacadas del celular o del navegador en modo celular, con la patente pixelada (el repo es público).
- El índice se arma en varias pasadas: cada título anota en qué página cayó y se vuelve a generar hasta que los números no cambian.
- Cuando cambia la app: actualizar el texto y las capturas, subir `manualVersion`, poner en `appVersion` la versión que describe el manual y sumar una fila a `history`.

## Historial en PDF

- Se genera en el navegador con `@react-pdf/renderer` (`components/report/`), que se descarga recién al exportar. Los datos salen de `lib/report.ts` (con tests).
- Usa Helvetica, que alcanza para el castellano; `pdfText()` saca lo que no puede dibujar (emojis). El logo va en PNG (`public/brand/*.png`, lo genera `npm run brand`).
- En el celular, **Compartir** abre el menú del sistema (WhatsApp, mail…); si el navegador no puede, queda **Descargar**.
- react-pdf: no poner `lineHeight` en la página ni en textos sueltos (el pie con `fixed` deja de dibujarse o aparecen huecos).

## Seguridad

- **Acceso**: abierto a cualquier cuenta de Google con mail verificado. La primera vez, `app/api/access` la registra en `allowlist`; las reglas de Firestore y las API routes (`authorize()` en `lib/firebase/admin.ts`) exigen ese registro. Si algún día hay que cerrar la app (con invitación o aprobación), alcanza con cambiar esa ruta.
- **Riesgo que queda por estar abierta**: alguien con un script podría gastar la cuota diaria gratis de Firestore escribiendo en su propia cuenta. Es un riesgo aceptado: la app no usa App Check, porque en la web depende de reCAPTCHA y se decidió no pagarlo (ver [#36](https://github.com/Scerutti/autocar/issues/36)). Si alguien abusa, queda cerrar el acceso.
- **Datos**: cada cuenta sólo lee y escribe `users/{su uid}` (ajustes, push y logros), los autos de los que es dueña (`cars/{carId}` con `ownerUid` igual a su uid, y sus subcolecciones) y, con permisos acotados, los autos que le compartieron (su mail en minúscula en `members`; ver [Autos compartidos](#autos-compartidos)). La configuración `NEXT_PUBLIC_FIREBASE_*` es pública por diseño: lo que protege son las reglas.
- **Reglas de Firestore**: sólo aceptan las colecciones y los campos que guarda la app, con largo máximo en los textos (funciones `valid*` en [`firestore.rules`](firestore.rules)). **Si agregás un campo o una colección, sumalo ahí y volvé a publicar las reglas**: si no, esa escritura falla con `permission-denied` en producción.
- **API routes**: todas piden el ID token de Firebase (`Authorization: Bearer …`); el cron pide `CRON_SECRET` (comparado en tiempo constante) y sin esa variable no corre. Borrar fotos sólo funciona dentro de la carpeta propia.
- **Fotos**: la firma de subida incluye un `public_id` único y `overwrite=false`, así cada firma sirve para una sola foto y el límite diario no se saltea.
- **Push**: el servidor sólo manda a servicios de push conocidos (FCM, Mozilla, Windows, Apple), con timeout para que un servicio colgado no frene el cron. Por cuenta: hasta 6 avisos por corrida y 5 dispositivos; el cron procesa de a 5 cuentas con un tope de 40 s.
- **Headers** (`next.config.mjs`): Content-Security-Policy, HSTS y Permissions-Policy. Si la app empieza a usar un servicio externo nuevo, hay que sumar su dominio a la CSP: si no, el navegador lo bloquea (en la consola aparece "Refused to …").
- **Cloudinary**: con *Strict transformations* activado (Settings → Security), sólo se pueden pedir los tamaños que usa la app. Si cambiás un tamaño en el código, permitilo también ahí.
- **Secretos**: `.env.local` y el JSON de la service account no se suben (`.gitignore`). El repo es público: nunca pegues claves en el código ni en la documentación.
- Recomendado, desde las consolas: restringir la API key de Firebase a tus dominios (Google Cloud → Credenciales → la "Browser key" → Restricciones de aplicaciones → Sitios web): el de Vercel, `localhost:3000` y `<proyecto>.firebaseapp.com` (lo usa el login con Google).

## UI: avisos y diálogos

- **Toasts** (`lib/toast.ts`): `toast.success|error|warning|info(title, { description, action, id })`. Se pueden usar desde cualquier lado; los dibuja `<Toaster />` (Base UI). Los errores se anuncian con prioridad a lectores de pantalla.
- **Confirmaciones** (`useConfirm()` en `components/confirm-provider.tsx`): toda acción importante (guardar un auto, un mantenimiento, un trabajo, una carga o los km; activar notificaciones; cambiar el día del recordatorio; salir) muestra un resumen y pide "Sí, …" antes de hacerla. Los borrados usan el tono de peligro, con el foco en "Cancelar".
- **Borrar**: además de confirmar, lo que se puede recuperar (trabajos, cargas, mantenimientos, registros de km) ofrece **Deshacer** en el toast (`removeWithUndo`). Borrar un auto no se puede deshacer.
- **Errores de formularios**: junto al botón, con `<FormError>` (`role="alert"`); los de la foto, debajo de la foto.
- **Diálogos** (`components/ui/dialog.tsx`, `alert-dialog.tsx`) y menús (`dropdown-menu.tsx`) usan Base UI: foco atrapado y devuelto, Escape, bloqueo de scroll y ARIA.
- Sin conexión, los guardados muestran "se sincroniza cuando vuelva la señal" y un aviso global indica cuando se corta o vuelve la red.

## Logros

- **Catálogo y reglas** en `lib/achievements.ts` (con tests): cada logro tiene un id estable, su condición y cómo medir el progreso. Para sumar uno, agregarlo ahí y darle ícono en `components/achievements/medal.tsx`.
- **Alcance**: los logros son de la cuenta, pero cada condición se mide auto por auto (no se suman trabajos de autos distintos). Se guarda con qué auto se consiguió. Sólo cuentan registros válidos: con fecha no futura, trabajos con título, cargas con cantidad.
- **Semanas**: van de lunes a domingo; una semana cuenta si tiene al menos un registro de km. Una semana sin registro corta la racha (lo ya conseguido queda).
- **Desbloqueo**: `AchievementsProvider` evalúa con los datos que ya están en Firestore cada vez que cambian y crea los que faltan con una transacción idempotente (`unlockAchievements`): un reintento, un doble evento u otro dispositivo no lo duplican. Necesita conexión; si falla, reintenta más tarde. Son permanentes: editar o borrar registros no los quita ni los repite.
- **Celebraciones**: `celebratedAt` en null = pendiente (se ve en cualquier dispositivo hasta que se muestre). 1 logro: solo; de 2 a 4: de a uno ("1 de 3"); 5 o más: primero un resumen. Lo que se desbloquea con la ventana abierta queda para la tanda siguiente. Respeta "reducir movimiento".
- **Usuarios existentes**: no hace falta migración. La primera vez que entran se desbloquea todo lo que ya cumplían (con fecha de hoy) y ven el resumen.
- Las reglas de Firestore no cambian: `achievements` cuelga de `users/{uid}` como el resto.

## Modelo de datos (Firestore)

Cada auto es un documento de primer nivel, `cars/{carId}`, y sus mantenimientos, trabajos, cargas y lecturas de km son subcolecciones suyas. Los ajustes, las suscripciones push y los logros siguen colgando de `users/{uid}`. Los documentos hijos conservan el campo `carId` (aunque ya esté en la ruta): el cliente agrupa y filtra por ese campo, y las reglas exigen que coincida con el de la ruta. Los ids son los mismos que tenían antes de la migración.

| Colección | Qué guarda |
|---|---|
| `users/{uid}` | ajustes: `reminder { enabled, weekday }`, `timezone` |
| `cars/{carId}` | marca, modelo, versión, año, patente, combustibles (`nafta`, `nafta + gnc` o `gasoil`), km actual, promedio km/día, foto, y el dueño: `ownerUid`, `ownerName` y `members` (hasta 2 mails en minúscula de las personas con las que se compartió; el dueño no figura) |
| `cars/{carId}/rules` | mantenimientos: cada cuántos km y/o cada cuánto tiempo (`intervalTime { amount, unit }`), si se repite o es de una sola vez, la última vez cargada a mano (`baseKm`/`baseDate`), la proyección que sale de los trabajos aprobados (`lastDone*`, `lastDoneJobId`, `completedByJobId`: un recordatorio cumplido), márgenes de aviso |
| `cars/{carId}/jobs` | trabajos: fecha, km, título, categoría, costo, taller, notas, mantenimientos que cumple, `status` (`approved`, `pending` o `rejected`; un trabajo sin el campo cuenta como aprobado) y `reviewedAt` (cuándo el dueño aprobó o rechazó el trabajo de un miembro) |
| `cars/{carId}/fuel` | cargas: fecha, km, combustible (`nafta`, `gasoil`, `gnc`) y calidad (`super`/`premium`), cantidad (L o m³), precio por unidad, total, tanque lleno |
| `cars/{carId}/odometer` | lecturas del odómetro (manual, desde trabajos o cargas) |
| `users/{uid}/pushSubscriptions` | dispositivos suscriptos a notificaciones |
| `users/{uid}/achievements` | logros conseguidos: el id del documento es el del logro; `carId`, `unlockedAt`, `celebratedAt` (null = celebración pendiente) |

- **Autoría**: los trabajos, las cargas y las lecturas guardan `createdBy` (uid) y `createdByName` (nombre de Google o null). Se graban al crear y no cambian al editar; "Deshacer" los conserva. Los mantenimientos no la llevan: el plan de mantenimiento es del dueño. En el cliente, las escrituras de `lib/db.ts` reciben un `actor { uid, name }` (lo da `useData()`).
- **Lectura**: `subscribeUserData` escucha los autos con dos consultas, `where('ownerUid', '==', uid)` y `where('members', 'array-contains', <mail en minúscula>)` (la regla de lectura depende de esos campos), une los resultados y abre 4 listeners por auto. No hacen falta índices compuestos.
- **Reglas**: el permiso de un hijo se decide con el documento del auto: `get()` para leer y borrar, `getAfter()` para crear y editar (así `createCar` puede crear el auto y su primera lectura en el mismo batch). Para los miembros, lo mismo con `memberOfCar` y `memberOfCarAfter`.
- **Borrar un auto**: `deleteCar` borra primero los hijos y el auto al final. Sin el auto, las reglas ya no dejan leer ni borrar sus hijos, y quedarían huérfanos.
- **Estructura vieja**: `users/{uid}/cars|rules|jobs|fuel|odometer` y sus reglas siguen en pie, sin usarse, por si hay que volver atrás. Se borran en un cambio aparte, cuando todo esté confirmado en producción.

Fuera de `users` y `cars`, y sólo accesibles desde el servidor: `allowlist/{mail}` (cuentas registradas, se completa sola) y `usage/{uid}` (fotos subidas en el día).

### Autos compartidos

El dueño comparte un auto desde "Editar auto" → Compartir, con hasta 2 mails (el mail de Google de cada persona). No hay invitación ni mails: el auto le aparece a la persona apenas entra a la app con ese mail, y **Avisarle** abre el menú de compartir del celular con el link. Los permisos del cliente viven en `lib/sharing.ts` (con tests); las reglas de Firestore dicen lo mismo.

| | Dueño | Miembro |
|---|---|---|
| Ver el auto, sus mantenimientos, trabajos, cargas, km y gastos | sí | sí |
| Editar o borrar el auto, cambiar la foto, compartir | sí | no |
| Agregar, editar o borrar mantenimientos | sí | no (los ve en solo lectura) |
| Cargar km y cargas de combustible | sí | sí (el km del auto sube enseguida) |
| Editar o borrar cargas y registros de km | todos | sólo los suyos |
| Cargar trabajos | sí, quedan `approved` | sí, quedan `pending`, sin "Volver al taller" |
| Editar o borrar trabajos | todos | sólo los suyos `pending` o `rejected` |
| Aprobar o rechazar trabajos | sí | no |
| Salir del auto | no | sí (saca su mail de `members`) |

- **Estados de un trabajo**: lo crea el dueño → `approved`. Lo crea un miembro → `pending`. El dueño aprueba → `approved` con `reviewedAt`, y recién ahí se aplican los efectos (`approveJob`: mantenimientos hechos y lectura de km a nombre del miembro, con los datos que tiene la app del dueño). El dueño rechaza → `rejected` con `reviewedAt`, sin efectos. El miembro edita un trabajo `pending` o `rejected` → vuelve a `pending`. Un trabajo `pending` o `rejected` no cuenta en gastos, reportes, totales ni logros, pero se ve en las listas con su etiqueta.
- **Cargado por**: en un auto compartido (con miembros, o que me compartieron) cada registro dice quién lo cargó. Un registro sin `createdBy` cuenta como del dueño. En un auto sin compartir no se ve nada nuevo.
- **Campanita**: al dueño, los trabajos para revisar (con Aprobar y Rechazar); al miembro, sus trabajos rechazados y "<dueño> te compartió su <auto>", una vez por auto (lo visto se guarda en el dispositivo).
- **Logros**: cada persona suma sólo lo que cargó ella, y en trabajos sólo lo aprobado. En los autos que le compartieron no cuentan los mantenimientos (el plan es del dueño).
- **Si la consulta de compartidos falla con `permission-denied`** (la app publicada antes que las reglas), la app sigue sin autos compartidos y deja un aviso en la consola.
- **Avisos push para los miembros**: todavía no. Los vencimientos y el pedido de km le llegan sólo al dueño.

## Migración a `cars/`

El script [`scripts/migrate-cars.mjs`](scripts/migrate-cars.mjs) copia los datos de `users/{uid}/…` a `cars/…` con el Admin SDK. Usa las variables `FIREBASE_ADMIN_*` de `.env.local`.

- **Sin `--apply` es un simulacro**: no escribe nada. Imprime, por cuenta, cuántos autos y cuántos hijos copia, saltea u omite.
- **Solo crea**: si el documento destino ya existe, lo saltea. Se puede correr de nuevo sin pisar lo que se cargó con la app nueva.
- **Agrega** `ownerUid`, `ownerName` y `members: []` a los autos; `createdBy` y `createdByName` (el dueño) a los trabajos, cargas y lecturas; y `status: 'approved'` a los trabajos.
- **Informa y no copia**: los hijos cuyo `carId` no es de un auto de esa cuenta (huérfanos) y un `cars/{carId}` que ya existe con otro dueño (conflicto; el script sale con código 1).
- **No borra nada** de `users/{uid}/…`.
- La lógica está en `scripts/migrate-cars-plan.mjs`, con sus pruebas al lado.

Procedimiento de salida (lo hace una persona, en este orden; publicar este cambio solo, sin mezclarlo con otros):

1. Avisar a los otros usuarios que no usen la app unos minutos.
2. Probar las reglas nuevas en el Simulador de reglas (Firebase → Firestore → Reglas → Zona de pruebas) y publicarlas: `npx firebase-tools deploy --only firestore:rules` o desde la consola.
3. Correr el simulacro y revisar los números: `node --env-file=.env.local scripts/migrate-cars.mjs`. Si informa conflictos, parar.
4. Migrar: `node --env-file=.env.local scripts/migrate-cars.mjs --apply`.
5. Mergear y esperar que Vercel publique.
6. Correr `--apply` otra vez, para levantar lo que se cargó con la app vieja mientras tanto.
7. Verificar con la cuenta del dueño: mismos autos, fotos, km y mantenimientos; mismos registros de trabajos, combustible y km, y mismos gastos; cargar km, una carga (editarla y borrarla con "Deshacer") y un trabajo que marque un mantenimiento; crear un auto de prueba con una carga y borrarlo (no tiene que quedar nada en `cars/{id}` ni en sus subcolecciones); ningún logro nuevo. Al día siguiente, revisar los logs del cron en Vercel.
