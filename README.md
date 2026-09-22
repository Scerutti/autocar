# AutoCar

App personal para llevar el mantenimiento de tus autos: vencimientos por km o por fecha (lo que ocurra primero), recordatorio semanal para cargar los km, trabajos con su costo, cargas de combustible (Nafta / GNC) y resumen de gastos.

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
4. **Firestore → Reglas**: pegar el contenido de [`firestore.rules`](firestore.rules) y publicar.
5. **Configuración del proyecto → General → Tus apps → Web (`</>`)**: registrar la app y copiar los valores de `firebaseConfig` a las variables `NEXT_PUBLIC_FIREBASE_*`.
6. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**: del JSON, copiar `project_id`, `client_email` y `private_key` a `FIREBASE_ADMIN_*` (la clave entre comillas dobles, con los `\n`).

### 2. Cloudinary

Completar `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET` (Dashboard de Cloudinary). El secret sólo lo usa el servidor para firmar las subidas; las fotos quedan en la carpeta `autocar/<uid>`.

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

## UI: avisos y diálogos

- **Toasts** (`lib/toast.ts`): `toast.success|error|warning|info(title, { description, action, id })`. Se pueden usar desde cualquier lado; los dibuja `<Toaster />` (Base UI). Los errores se anuncian con prioridad a lectores de pantalla.
- **Borrar**: para cosas frecuentes y recuperables (trabajos, cargas, mantenimientos, registros de km) se borra al toque y el toast ofrece **Deshacer** (`removeWithUndo`). Sólo borrar un auto (irreversible, se lleva todo el historial) pide confirmación con un `AlertDialog`.
- **Errores de formularios**: junto al botón, con `<FormError>` (`role="alert"`).
- **Diálogos** (`components/ui/dialog.tsx`, `alert-dialog.tsx`) y menús (`dropdown-menu.tsx`) usan Base UI: foco atrapado y devuelto, Escape, bloqueo de scroll y ARIA.
- Sin conexión, los guardados muestran "se sincroniza cuando vuelva la señal" y un aviso global indica cuando se corta o vuelve la red.

## Modelo de datos (Firestore)

Todo cuelga de `users/{uid}`; las colecciones hijas tienen `carId` para consultar entre autos.

| Colección | Qué guarda |
|---|---|
| `users/{uid}` | ajustes: `reminder { enabled, weekday }`, `timezone` |
| `cars` | marca, modelo, versión, año, patente, combustibles, km actual, promedio km/día, foto |
| `rules` | mantenimientos: intervalo en km y/o meses, última vez (km/fecha), márgenes de aviso |
| `jobs` | trabajos: fecha, km, título, categoría, costo, taller, notas, mantenimientos que cumple |
| `fuel` | cargas: fecha, km, tipo, cantidad (L o m³), precio por unidad, total, tanque lleno |
| `odometer` | lecturas del odómetro (manual, desde trabajos o cargas) |
| `pushSubscriptions` | dispositivos suscriptos a notificaciones |
