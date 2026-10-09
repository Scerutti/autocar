# Cambios

Las versiones siguen [SemVer](https://semver.org/lang/es/). Cada versión también tiene su [release en GitHub](https://github.com/Scerutti/autocar/releases).

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
