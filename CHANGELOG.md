# Cambios

Las versiones siguen [SemVer](https://semver.org/lang/es/). Cada versión también tiene su [release en GitHub](https://github.com/Scerutti/autocar/releases).

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
