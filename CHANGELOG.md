# Cambios

Las versiones siguen [SemVer](https://semver.org/lang/es/). Cada versión también tiene su [release en GitHub](https://github.com/Scerutti/autocar/releases).

## Sin publicar

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
