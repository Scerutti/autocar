# Cambios

Las versiones siguen [SemVer](https://semver.org/lang/es/). Cada versión también tiene su [release en GitHub](https://github.com/Scerutti/autocar/releases).

## 1.4.0

Los mantenimientos se dan por hechos con el km real del trabajo. Antes de publicar hay que subir las reglas de Firestore (ver "Mantenimiento"). No hace falta migrar datos.

### Arreglos

- **Un trabajo sin km ya no usa el km de hoy**: si cargabas hoy un service de hace 8 meses sin km, el service quedaba hecho con los km de hoy y el próximo aviso llegaba tarde. Ahora toma el km de esa fecha según tus registros de km (entre el anterior y el posterior, o el último si es más nuevo), y en el mantenimiento se ve como "≈ 48.300 km (estimado)". Al aprobar el trabajo de otra persona pasa lo mismo: cuenta el km de la fecha del trabajo, no el del día en que lo aprobás.
- **Formulario de trabajo**: el km arranca vacío. Si marcás un mantenimiento por km y no ponés el km, te mostramos el estimado ("≈ estimado con tus registros; corregilo si lo sabés"), y si la fecha es anterior a tu primer registro de km, el km es obligatorio. La confirmación dice "Km (estimado)".
- **Falta el km de la última vez**: si un mantenimiento por km se queda sin ese dato, se calcula sólo por fecha y lo dice en su tarjeta y en su ficha, para que lo completes.
- **"Volver al taller"** ya no guarda un km (no se cuenta por km).
- **Km con fecha pasada**: al cargar km podés elegir la fecha (por defecto, hoy). Tienen que entrar entre los registros de antes y de después; si no, el error dice la fecha y los km del registro con el que no cierra. No bajan el km del auto.
- **Aviso de km que no cierran**: una carga o un trabajo con más km que un registro posterior (o menos que uno anterior) muestra un aviso al confirmar, sin bloquear.
- **Logros**: un km cargado hoy con fecha pasada cuenta para las rachas y el tiempo de seguimiento el día en que lo cargaste, no el de su fecha.

### Mantenimiento

- **Km a una fecha**: `kmAtDate` y `neighborsAt` en `lib/odometer.ts` (por día local; el mismo día manda el km más alto, entre dos lecturas se interpola, después de la última da la última; si la serie no cierra da la anterior, que es la cota baja). `validateKmReading(km, date, readings)` y `entryKmWarning(entry, car, readings)` cambian de firma; al editar, `entryKmWarning` no cuenta la lectura del propio registro (`entry.readingId`). `recordKm(actor, car, readings, km, date)` suma la fecha.
- **Efectos de un trabajo**: la parte de mantenimientos de `addJobEffects` pasa a `jobRuleUpdates` (`lib/maintenance.ts`, con pruebas), con el km de `jobDoneKm` (el del trabajo o `kmAtDate` a su fecha, sin la lectura `job-{id}` del propio trabajo). Nunca usa `car.currentKm`.
- **Campos nuevos**: `MaintenanceRule.lastDoneKmEstimated` (falta = `false`; `saveRule` lo reescribe y rule-form lo conserva mientras no cambies el km) y `OdometerReading.createdAt` (lo graban todas las lecturas nuevas: manuales, de alta y vinculadas; al pisar una vinculada se conserva el original; falta = `null`).
- **Reglas de Firestore**: `validRule` acepta `lastDoneKmEstimated` (bool) y `validReading` acepta `createdAt` (timestamp). Siguen aceptando lo que escribe la 1.3.0, que no los manda.
- **Paso manual**: publicar las reglas antes del deploy de la app. Con las reglas de la 1.3.0, la app nueva no podría guardar mantenimientos, autos nuevos, registros de km ni cargas o trabajos con km (todos escriben uno de los campos nuevos).

## 1.3.0

Cada registro de km sabe de qué carga o trabajo salió. Antes de publicar hay que subir las reglas de Firestore y correr una migración de datos (ver "Mantenimiento").

### Arreglos

- **Corregir el km de una carga o un trabajo corrige el km del auto**: si cargabas 150.000 en vez de 15.000 y después lo corregías, el auto seguía en 150.000, y los mantenimientos por km aparecían vencidos. Ahora cada carga y cada trabajo aprobado tiene un solo registro de km: al corregirlo se corrige, al sacarle el km o borrarlo se borra, y el km del auto se vuelve a calcular (puede bajar). "Deshacer" lo devuelve.
- **Las cargas y los trabajos con menos km que el actual** (por ejemplo, una carga vieja que cargás tarde) también quedan en el gráfico de km, sin bajar el km del auto.
- **Pestaña Km**: el registro de una carga dice "Carga del 12/03" y el de un trabajo "Trabajo: <título>", y tocarlo abre ese registro. Ya no se puede borrar desde ahí: se corrige editando o borrando la carga o el trabajo.
- **Trabajos**: el registro de km aparece cuando el trabajo queda aprobado. Uno pendiente o rechazado no deja registro, y borrar uno aprobado borra también el suyo.

### Mantenimiento

- **Lecturas vinculadas**: `OdometerReading.sourceId` guarda el id de la carga o del trabajo, y el id de la lectura es `fuel-{id}` o `job-{id}` (`linkedReadingId`), así reintentar o editar la pisa en vez de duplicarla. La fecha es la del registro al mediodía (`readingDateOf`) y el autor es el del registro, aunque edite el dueño. `saveFuel`, `deleteFuel`, `restoreFuel`, `rejectJob`, `deleteJob` y `restoreJob` cambian de firma: reciben `{ car, readings }` y el registro. Los km manuales y de alta siguen con id al azar y sin `sourceId`.
- **Logros**: las rachas y el tiempo de seguimiento cuentan la lectura de una carga o un trabajo con la fecha en que se cargó en la app (`createdAt` del registro), no con la del registro. Así cargar historia vieja (o la migración) no desbloquea logros de golpe.
- **Reglas de Firestore** (`cars/{carId}/odometer`): aceptan `sourceId`; si viene, el id tiene que ser el determinístico, `source` tiene que ser `fuel` o `job`, y la carga o el trabajo tiene que existir después del batch. El miembro borra una lectura suya vinculada sólo junto con su registro o si el registro se quedó sin km; el dueño borra cualquiera (así `deleteCar` no pasa el tope de llamadas por pedido). Borrar una lectura que no existe ya no tira abajo el batch. Las lecturas sin `sourceId` que sigue escribiendo la versión anterior de la PWA se aceptan como siempre.
- **Migración** `scripts/link-readings.mjs` (lógica en `scripts/link-readings-plan.mjs`, con pruebas): crea la lectura `baseline-{carId}` en los autos con más km que sus lecturas, vincula las lecturas viejas de cargas y trabajos (si hay un solo registro con ese km), completa las que faltan e informa las ambiguas y las sin candidato. Simulacro por defecto, `--apply` para escribir; se puede volver a correr.
- **Pasos manuales, en este orden**: 1) publicar las reglas; 2) simulacro: `node --env-file=.env.local scripts/link-readings.mjs`; 3) `node --env-file=.env.local scripts/link-readings.mjs --apply`; 4) deploy de la app; 5) `--apply` otra vez, para vincular lo que haya escrito la PWA vieja (una tercera corrida tiene que dar 0 cambios). La migración va antes del deploy porque la app nueva recalcula el km del auto desde sus lecturas: sin la lectura baseline, un auto viejo con más km que sus lecturas bajaría.

## 1.2.2

Para el usuario la app funciona igual.

### Mantenimiento

- **Sin App Check**: se quita el código de App Check, que nunca se activó porque faltaba la clave de reCAPTCHA. Se decidió no usar reCAPTCHA para no pagarlo. Salen también de la CSP los dominios de reCAPTCHA y la variable `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`.

## 1.2.1

Actualización de seguridad de dependencias. Para el usuario la app funciona igual.

### Mantenimiento

- **Next 16.4.3** (antes 16.3.8): cierra dos ejecuciones remotas de código (Image Optimization con SVG y funciones `use cache` que devuelven typed arrays) y un DoS en Server Actions. La app no usaba ninguna de esas tres funciones, pero la versión anterior quedaba expuesta si se activaban.
- **`npm audit fix`** en las dependencias transitivas: `hono`, `ip-address`, `undici`, `body-parser`, `fast-uri`, `qs` y `zod` (vienen del CLI de `shadcn`, que pasa a 4.22.1; no llegan al bundle). `npm audit` queda en 0.

## 1.2.0

Compartir un auto con hasta 2 personas, con aprobación de los trabajos que cargan. Las reglas de Firestore nuevas se publican antes del deploy (son compatibles con la 1.1.2). No hace falta migrar datos.

### Novedades

- **Compartir un auto**: en "Editar auto", el dueño suma hasta 2 mails (el de Google de cada persona) y los puede sacar. El auto le aparece a esa persona apenas entra, con "Compartido por <dueño>", sin aceptar nada. **Avisarle** abre el menú de compartir del celular con el link de la app (o copia el mensaje). No se mandan mails.
- **Qué puede hacer cada uno**: quien tiene el auto compartido ve todo y carga combustible, km y trabajos; edita o borra sólo lo que cargó, y puede salir del auto. No edita ni borra el auto, no cambia la foto ni el plan de mantenimiento, y no ve "Volver al taller". El dueño sigue pudiendo todo.
- **Trabajos para aprobar**: un trabajo que carga otra persona queda pendiente, sin marcar mantenimientos ni registrar km. El dueño lo aprueba o lo rechaza desde la campanita o desde el trabajo; al aprobarlo se aplican sus efectos. Uno rechazado se puede corregir y volver a mandar, o borrar.
- **Campanita**: al dueño le muestra los trabajos para revisar, y a quien tiene un auto compartido, sus trabajos rechazados y los autos que le compartieron (una vez por auto).
- **Cargado por**: en un auto compartido, cada trabajo, carga y registro de km dice quién lo cargó. Lo que no se puede editar se ve en modo solo lectura.
- **Gastos, reporte en PDF y totales** cuentan sólo los trabajos aprobados. **Los logros** de cada persona cuentan sólo lo que cargó ella (en trabajos, sólo lo aprobado).

### Mantenimiento

- **Reglas de Firestore**: los miembros de un auto (su mail en minúscula en `members`) lo leen con sus mantenimientos, trabajos, cargas y lecturas; cambian del auto sólo el km o su propio mail (para salir); crean a su nombre y editan o borran sólo lo suyo. Un miembro nunca puede crear ni dejar un trabajo `approved`. `members` tiene que estar en minúscula, y los trabajos suman `reviewedAt`. Las reglas de `users/{uid}/…` no cambian. **Publicarlas antes de mergear**: con las reglas de la 1.1.2 la consulta de autos compartidos se rechaza (la app sigue andando, sin autos compartidos) y las escrituras nuevas fallan.
- **Lectura**: `subscribeUserData` suma una consulta `where('members', 'array-contains', <mail en minúscula>)` a la de `ownerUid` y escucha la unión. Si esa consulta falla con `permission-denied`, sigue sin autos compartidos en lugar de mostrar el error.
- **Permisos en el cliente** en `lib/sharing.ts` (con tests): quién edita qué, la validación de los mails y el filtro de los logros.
- **`saveJob`** graba `pending` sin efectos si escribe un miembro; `approveJob` aplica los efectos con los datos del dueño y `rejectJob` lo deja `rejected`.

## 1.1.2

Los autos pasan a una estructura que se puede compartir, como base del grupo familiar. Para el usuario la app funciona igual. Antes de publicar hay que subir las reglas de Firestore y migrar los datos (ver `INSTRUCTIONS.md`, "Migración a `cars/`").

### Mantenimiento

- **Los autos pasan a `cars/{carId}`**: cada auto, con sus mantenimientos, trabajos, cargas y lecturas de km, deja `users/{uid}` y vive en su propio documento, con `ownerUid`, `ownerName` y `members` (vacío por ahora). Es la base para compartir un auto con otras personas. Para el usuario no cambia nada.
- **Autoría**: los trabajos, las cargas y las lecturas de km guardan quién los cargó (`createdBy`, `createdByName`), y los trabajos un `status` (siempre `approved` por ahora).
- **Reglas de Firestore** para `cars/**`: solo el dueño lee y escribe. Las reglas de `users/{uid}/cars|rules|jobs|fuel|odometer` quedan, sin usarse, para poder volver atrás.
- **Borrar un auto** borra primero todo lo que cuelga de él y el auto al final, para no dejar documentos huérfanos.
- **Cron diario**: lee los autos por `ownerUid` y los mantenimientos de cada auto.
- **Migración**: `scripts/migrate-cars.mjs` copia los datos existentes a la estructura nueva (simulacro por defecto, `--apply` para escribir, no pisa ni borra nada). El procedimiento está en `INSTRUCTIONS.md`, sección "Migración a `cars/`".

## 1.1.1

Arreglo del historial en PDF.

### Arreglos

- **Exportar historial en PDF**: el PDF se quedaba en "Armando el PDF…" y no se generaba. La política de seguridad del sitio (CSP) bloqueaba dos cosas que usa la librería del PDF: la carga de su WebAssembly (`connect-src data:`) y el worker que descomprime las imágenes (`worker-src blob:`).

## 1.1.0

Pendientes, novedades y avisos que se pueden ocultar.

### Novedades

- **Pendientes**: una campanita en la cabecera de las pantallas principales junta lo que hay para hacer: los km del recordatorio semanal, los mantenimientos vencidos y los por vencer. El número cuenta los vencidos y los km. Sale de los datos, no de las notificaciones: lo resuelto desaparece solo, aunque se haya descartado el aviso del celular.
- **Km de la semana en el Inicio**: si faltan los km del recordatorio, el Inicio lo avisa con un botón para cargarlos, y la tarjeta del auto lo marca.
- **Novedades**: sección nueva (desde Ajustes o la campanita) con lo nuevo de cada versión contado para el usuario. Las versiones destacadas se anuncian una vez con una ventana. Lo visto se guarda en el dispositivo, y a una cuenta nueva no se le anuncia lo que ya encontró hecho.
- **Avisos que se pueden ocultar**: el consejo para instalar la app en iPhone tiene "No mostrar más", con opción de deshacer.

### Mantenimiento

- Lo nuevo para el usuario vive en `lib/novedades.ts`, aparte de este CHANGELOG. Cada versión con cambios visibles suma ahí su entrada.

## 1.0.3

Arreglos de la auditoría de código: datos que se podían perder o quedar mal, y una app más robusta ante errores. Para el usuario la app funciona igual, salvo el botón "Reintentar".

### Arreglos

- **Km del auto**: el km sale de la lectura más alta. Una carga sin señal o dos dispositivos a la vez ya no lo dejan más bajo de lo real. No se puede borrar el único registro de km de un auto.
- **Trabajos**: si un mantenimiento marcado se borró en otro dispositivo, el trabajo se guarda igual. Antes se perdía entero.
- **Foto del auto**: la foto anterior se borra recién cuando se confirma el cambio. Si el cambio no se guarda, se borra la foto nueva y no queda una foto rota.
- **Avisos diarios**: si se borra un mantenimiento mientras salen los avisos, los demás se registran igual y no se repiten al día siguiente.
- **Error al cargar los datos**: la pantalla de error tiene un botón "Reintentar" y un mensaje claro, en lugar del error técnico.
- **Fotos**: un error de red al borrar una foto queda registrado. Una subida que falla por la señal se puede reintentar sin gastar el cupo de 10 fotos por día.

### Seguridad

- **App Check** (reCAPTCHA Enterprise): el código queda listo para que Firestore solo acepte pedidos que vienen de la app. Se activa con `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`; sin esa variable no cambia nada. Los pasos para activarlo están en [INSTRUCTIONS.md](INSTRUCTIONS.md#5-app-check).

### Mantenimiento

- Se eliminaron los comentarios inline que no son documentación. Lo que explicaban pasó a la documentación de cada función.

## 1.0.2

Actualización de dependencias. Para el usuario la app funciona igual.

### Seguridad

- **Dependencias de Firebase**: `@grpc/grpc-js` 1.14 y `uuid` 11 (con `overrides`, hasta que Firebase las actualice). Cierran tres alertas de Dependabot.

### Mantenimiento

- Dependencias al día: `@vercel/analytics` 2, `firebase-admin` 14.5, `lucide-react`, `vite` y `vitest`.
- El CI usa `actions/checkout` v7 y `actions/setup-node` v6.
- Dependabot propone actualizaciones una vez por mes, en lugar de cada semana.

## 1.0.1

Arreglos de seguridad. Para el usuario la app funciona igual.

### Seguridad

- **Next.js 16.3.8**: corrige vulnerabilidades conocidas de 16.3.3, entre ellas una crítica.
- **Fotos**: cada firma de subida sirve para una sola foto, así el límite de 10 por día no se puede saltear. El borrado valida mejor de qué foto se trata.
- **Avisos diarios**: hasta 6 avisos por cuenta y por día (si hay más, llega un resumen) y hasta 5 dispositivos por cuenta. Así nadie puede trabar los avisos de los demás. El pedido de km llega siempre.
- **Reglas de Firestore**: sólo aceptan los datos que guarda la app, con un largo máximo para los textos.
- **Headers**: Content-Security-Policy, HSTS y Permissions-Policy.
- **Mantenimiento**: el CI corre con permisos de sólo lectura y Dependabot propone las actualizaciones a `develop`.

### Documentación

- Manual de usuario en PDF ([docs/manual-de-usuario.pdf](docs/manual-de-usuario.pdf)), para AutoCar 1.0.0. Se regenera con `npm run manual`.

## 1.0.0

Primera versión estable.

### Novedades

- **Logros**: 23 medallas que premian la constancia (cargar los km cada semana, registrar trabajos y cargas, tener los avisos al día). Tienen su propia sección, una tarjeta en el Inicio y una celebración cuando se desbloquean. Son permanentes y se guardan en la cuenta, así que se ven en cualquier dispositivo.
- **Pestañas del auto más rápidas**: cambiar entre Estado, Trabajos, Combustible y Km ya no espera al servidor, y abrir un auto muestra un indicador de carga.

### Documentación

- El README cuenta qué es AutoCar y qué hace, con capturas nuevas. Lo técnico (desarrollo, puesta en marcha, seguridad, modelo de datos) pasó a [INSTRUCTIONS.md](INSTRUCTIONS.md).
- Licencia [MIT](LICENSE) y [código de conducta](CODE_OF_CONDUCT.md).

## 0.2.0

- Versión y commit del deploy al pie de Ajustes.
- Avisos de km sospechosos en cargas y trabajos.
- Speed Insights de Vercel.
- Arreglos en cargas con 3 decimales, en el consumo y el costo por km con cargas sin km, y en los reintentos del cron.
