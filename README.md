# AutoCar

App personal para llevar el mantenimiento de tus autos: vencimientos por km o por fecha (lo que ocurra primero), recordatorios de una sola vez ("volver al taller en 3 semanas"), recordatorio semanal para cargar los km, trabajos con su costo, cargas de combustible (nafta, nafta + GNC o gasoil; súper o premium) y resumen de gastos.

**Stack:** Next.js 16 (App Router) · Tailwind 4 · Firebase Auth (Google) + Firestore · Cloudinary (fotos) · Web Push (VAPID) · Vercel Cron.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # tests de la lógica (vencimientos, combustible, gastos, avisos)
npm run build
```

Las variables van en `.env.local` (ver `.env.local.example`).

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

Fotos (`lib/photo-limits.ts`): se aceptan archivos de hasta 25 MB y el navegador los achica a JPG de 1600 px (quedan en unos cientos de KB) antes de subirlos. La firma del servidor además limita los formatos (JPG/PNG/WebP) y achica al guardar, por si alguien saltea el navegador. Cada cuenta puede subir hasta 10 fotos por día (contador en `usage/{uid}`, que sólo toca el servidor). El plan gratis de Cloudinary no acepta imágenes de más de 10 MB.

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

## Marca

- `assets/brand/autocar-logo.png` es el logo original (fuente, no se sirve).
- `npm run brand` regenera desde ese archivo el logo con fondo transparente (`public/brand/*.webp`), los íconos de la PWA (`public/icon-*.png`) y `app/apple-icon.png`.
- `app/favicon.ico` es el favicon provisto por diseño.
- Colores: azul del logo `#1A9CFB` como acento (`primary`); verde/amarillo/rojo quedan reservados para los estados (`success`, `warning`, `destructive`). Todo está en tokens en `app/globals.css`.

## Seguridad

- **Acceso**: abierto a cualquier cuenta de Google con mail verificado. La primera vez, `app/api/access` la registra en `allowlist`; las reglas de Firestore y las API routes (`authorize()` en `lib/firebase/admin.ts`) exigen ese registro. Si algún día hay que cerrar la app (con invitación o aprobación), alcanza con cambiar esa ruta.
- **Riesgo que queda por estar abierta**: alguien con un script podría gastar la cuota diaria gratis de Firestore escribiendo en su propia cuenta. Si pasa, las salidas son App Check (reCAPTCHA) o cerrar el acceso.
- **Datos**: cada cuenta sólo lee y escribe `users/{su uid}`. La configuración `NEXT_PUBLIC_FIREBASE_*` es pública por diseño: lo que protege son las reglas.
- **API routes**: todas piden el ID token de Firebase (`Authorization: Bearer …`); el cron pide `CRON_SECRET` y sin esa variable no corre. Borrar fotos sólo funciona dentro de la carpeta propia.
- **Push**: el servidor sólo manda a servicios de push conocidos (FCM, Mozilla, Windows, Apple), con timeout para que un servicio colgado no frene el cron.
- **Secretos**: `.env.local` y el JSON de la service account no se suben (`.gitignore`). El repo es público: nunca pegues claves en el código ni en el README.
- Recomendado, desde las consolas: restringir la API key de Firebase a tus dominios (Google Cloud → Credenciales → la "Browser key" → Restricciones de aplicaciones → Sitios web): el de Vercel, `localhost:3000` y `<proyecto>.firebaseapp.com` (lo usa el login con Google).

## UI: avisos y diálogos

- **Toasts** (`lib/toast.ts`): `toast.success|error|warning|info(title, { description, action, id })`. Se pueden usar desde cualquier lado; los dibuja `<Toaster />` (Base UI). Los errores se anuncian con prioridad a lectores de pantalla.
- **Confirmaciones** (`useConfirm()` en `components/confirm-provider.tsx`): toda acción importante (guardar un auto, un mantenimiento, un trabajo, una carga o los km; activar notificaciones; cambiar el día del recordatorio; salir) muestra un resumen y pide "Sí, …" antes de hacerla. Los borrados usan el tono de peligro, con el foco en "Cancelar".
- **Borrar**: además de confirmar, lo que se puede recuperar (trabajos, cargas, mantenimientos, registros de km) ofrece **Deshacer** en el toast (`removeWithUndo`). Borrar un auto no se puede deshacer.
- **Errores de formularios**: junto al botón, con `<FormError>` (`role="alert"`); los de la foto, debajo de la foto.
- **Diálogos** (`components/ui/dialog.tsx`, `alert-dialog.tsx`) y menús (`dropdown-menu.tsx`) usan Base UI: foco atrapado y devuelto, Escape, bloqueo de scroll y ARIA.
- Sin conexión, los guardados muestran "se sincroniza cuando vuelva la señal" y un aviso global indica cuando se corta o vuelve la red.

## Modelo de datos (Firestore)

Todo cuelga de `users/{uid}`; las colecciones hijas tienen `carId` para consultar entre autos.

| Colección | Qué guarda |
|---|---|
| `users/{uid}` | ajustes: `reminder { enabled, weekday }`, `timezone` |
| `cars` | marca, modelo, versión, año, patente, combustibles (`nafta`, `nafta + gnc` o `gasoil`), km actual, promedio km/día, foto |
| `rules` | mantenimientos: cada cuántos km y/o cada cuánto tiempo (`intervalTime { amount, unit }`), si se repite o es de una sola vez, última vez (km/fecha), márgenes de aviso |
| `jobs` | trabajos: fecha, km, título, categoría, costo, taller, notas, mantenimientos que cumple |
| `fuel` | cargas: fecha, km, combustible (`nafta`, `gasoil`, `gnc`) y calidad (`super`/`premium`), cantidad (L o m³), precio por unidad, total, tanque lleno |
| `odometer` | lecturas del odómetro (manual, desde trabajos o cargas) |
| `pushSubscriptions` | dispositivos suscriptos a notificaciones |

Fuera de `users`, y sólo accesibles desde el servidor: `allowlist/{mail}` (cuentas registradas, se completa sola) y `usage/{uid}` (fotos subidas en el día).
