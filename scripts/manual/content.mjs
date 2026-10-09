// Contenido del manual de usuario (npm run manual lo convierte en docs/manual-de-usuario.pdf).
// Al cambiar la app: actualizar el texto y las capturas (375 px de ancho, con la patente pixelada), subir
// manualVersion, apuntar appVersion a la versión descripta y sumar una fila a history.
// Bloques: p (párrafo), steps (pasos numerados), bullets, fig (imagen con epígrafe), table, note, qa.
// **texto** = negrita (nombres de botones y opciones).

export const META = {
  title: 'Manual de usuario',
  manualVersion: '1.0',
  appVersion: '1.0.0',
  date: 'Octubre de 2026',
  history: [['1.0', 'Octubre de 2026', 'Primera versión, para AutoCar 1.0.0.']],
  url: 'autocar-xi.vercel.app',
}

export const CHAPTERS = [
  {
    id: 'intro',
    title: 'Introducción',
    blocks: [
      { p: 'AutoCar es una aplicación para llevar al día el mantenimiento de uno o más vehículos. Permite registrar el kilometraje, programar avisos de mantenimiento, guardar los trabajos realizados y las cargas de combustible, y consultar los gastos.' },
      { p: 'La aplicación avisa con anticipación cuando un mantenimiento está próximo a vencer, ya sea por kilometraje o por fecha, y conserva un historial completo del vehículo.' },
      { h: 'Requisitos' },
      {
        bullets: [
          'Un celular o una computadora con conexión a internet.',
          'Un navegador actualizado: Chrome en Android o Safari en iPhone.',
          'Una cuenta de Google (la misma que se usa para Gmail).',
        ],
      },
      { h: 'Convenciones de este manual' },
      {
        bullets: [
          'Los nombres de botones, pestañas y opciones de la aplicación se indican en **negrita**.',
          'Las imágenes corresponden a AutoCar 1.0.0 en un celular. Pueden variar levemente según el dispositivo y los datos cargados.',
          'Los datos que se ven en las imágenes son de ejemplo.',
        ],
      },
    ],
  },
  {
    id: 'inicio',
    title: 'Primeros pasos',
    blocks: [
      { h: 'Ingresar a la aplicación' },
      {
        steps: [
          'Abrir el navegador del celular.',
          `Escribir la dirección **${'autocar-xi.vercel.app'}** en la barra de direcciones.`,
          'Tocar **Entrar con Google** y elegir la cuenta.',
          'La primera vez, la aplicación muestra el mensaje "Preparando tu cuenta…" durante unos segundos y luego abre la pantalla de inicio.',
        ],
      },
      { p: 'La sesión queda iniciada en ese dispositivo. No es necesario volver a ingresar cada vez que se abre la aplicación.' },
      { h: 'Agregar el acceso directo al celular' },
      { p: 'AutoCar no se descarga desde una tienda de aplicaciones. Para abrirla desde un ícono, como cualquier otra aplicación, se agrega un acceso directo a la pantalla del celular. Este paso se realiza una sola vez.' },
      {
        table: {
          head: ['Dispositivo', 'Pasos'],
          rows: [
            ['Android (Chrome)', 'Tocar el menú (los tres puntos de arriba a la derecha), luego **Agregar a la pantalla principal** o **Instalar app**, y confirmar con **Agregar**.'],
            ['iPhone (Safari)', 'Tocar **Compartir** (el cuadrado con una flecha hacia arriba), luego **Agregar a inicio**, y confirmar con **Agregar**.'],
          ],
          widths: [30, 70],
        },
      },
      { note: 'En iPhone, las notificaciones solo funcionan si la aplicación se abre desde este acceso directo.' },
      { h: 'Registrar un vehículo' },
      {
        steps: [
          'En la pantalla de inicio, tocar **Agregar auto** o el botón **+** de arriba a la derecha.',
          'Completar **Marca** y **Modelo**. Los campos **Versión**, **Año** y **Patente** son opcionales, aunque se recomienda completarlos.',
          'En **Km actuales**, escribir el kilometraje que indica el tablero.',
          'En **Combustible**, elegir **Sólo nafta**, **Nafta + GNC** o **Gasoil**.',
          'Opcionalmente, tocar **Agregar foto del auto**.',
          'Tocar **Agregar auto**, revisar el resumen y confirmar con **Sí, agregar**.',
        ],
      },
      { p: 'Se pueden registrar varios vehículos. Cada uno tiene su propio kilometraje, sus mantenimientos y sus gastos.' },
    ],
  },
  {
    id: 'pantalla',
    title: 'Pantalla de inicio',
    blocks: [
      { p: 'La pantalla de inicio resume el estado de cada vehículo.' },
      { fig: 'inicio.jpg', caption: 'Pantalla de inicio.', width: 150 },
      {
        defs: [
          ['Vehículo', 'Nombre y foto del vehículo. Al tocarlo se abre su detalle.'],
          ['Kilometraje actual', 'Último kilometraje registrado y cuándo se registró.'],
          ['Próximo', 'Mantenimiento que vence primero, con una barra que indica cuánto falta.'],
          ['Cargar km', 'Botón para registrar el kilometraje (ver capítulo 4).'],
          ['Para revisar', 'Aparece solo si hay mantenimientos vencidos o próximos a vencer.'],
          ['Logros', 'Cantidad de logros obtenidos (ver capítulo 9).'],
          ['Actividad reciente', 'Últimos trabajos y cargas de combustible registrados.'],
        ],
      },
      { h: 'Menú inferior' },
      { p: 'El menú de la parte inferior está disponible en todas las pantallas y permite moverse entre las secciones de la aplicación.' },
      { fig: 'barra.jpg', caption: 'Menú inferior.', width: 300 },
      {
        defs: [
          ['Inicio', 'Vuelve a la pantalla de inicio.'],
          ['Trabajos', 'Historial de trabajos y cargas de combustible de todos los vehículos.'],
          ['Gastos', 'Resumen de gastos del año.'],
          ['Logros', 'Logros obtenidos y pendientes.'],
          ['Ajustes', 'Notificaciones, recordatorio semanal y cuenta.'],
        ],
      },
      { p: 'Para volver a la pantalla anterior se usa la flecha de la esquina superior izquierda.' },
    ],
  },
  {
    id: 'km',
    title: 'Registro del kilometraje',
    blocks: [
      { p: 'Registrar el kilometraje una vez por semana permite a la aplicación calcular el uso del vehículo y anticipar los vencimientos que dependen de los kilómetros. No es necesario hacerlo todos los días.' },
      {
        steps: [
          'En la pantalla de inicio, tocar **Cargar km**.',
          'Escribir el kilometraje que indica el tablero, sin puntos ni comas. Debajo se muestra la diferencia con el registro anterior.',
          'Tocar **Continuar**.',
          'Verificar el número que muestra la aplicación. Si es correcto, tocar **Sí, guardar**; si no, tocar **Corregir**.',
        ],
      },
      { width: 140, figs: [
        { fig: 'km-1.jpg', caption: 'Ventana de carga.' },
        { fig: 'km-2.jpg', caption: 'Kilometraje escrito.' },
        { fig: 'km-3.jpg', caption: 'Confirmación.' },
      ] },
      { p: 'Al guardar, la aplicación muestra un mensaje de confirmación con el tiempo o los kilómetros que faltan para el próximo mantenimiento.' },
      { note: 'Los kilómetros indicados al registrar un trabajo o una carga de combustible también actualizan el kilometraje del vehículo.' },
    ],
  },
  {
    id: 'mantenimientos',
    title: 'Mantenimientos',
    blocks: [
      { p: 'Un mantenimiento es una tarea que se repite cada cierto tiempo o kilometraje: service, VTV, seguro, correa de distribución, entre otras. La aplicación calcula su vencimiento y avisa con anticipación.' },
      { h: 'Estado de los mantenimientos' },
      { p: 'Para ver los mantenimientos de un vehículo, tocarlo en la pantalla de inicio y abrir la pestaña **Estado**.' },
      { fig: 'estado.jpg', caption: 'Pestaña Estado de un vehículo.', width: 175 },
      { p: 'Cada mantenimiento muestra una etiqueta de estado, una barra de avance y lo que falta para el vencimiento.' },
      {
        table: {
          head: ['Estado', 'Significado', 'Acción sugerida'],
          rows: [
            ['**Al día** (verde)', 'Falta tiempo para el vencimiento.', 'Ninguna.'],
            ['**Próximo** (amarillo)', 'El vencimiento está cerca.', 'Programar el turno.'],
            ['**Vencido** (rojo)', 'Se superó la fecha o el kilometraje.', 'Realizarlo a la brevedad.'],
            ['**Sin datos** (gris)', 'Falta la fecha de la última vez.', 'Completar el dato.'],
          ],
          widths: [26, 40, 34],
        },
      },
      { p: 'Cuando un mantenimiento tiene fecha y kilometraje, vence por lo que ocurra primero.' },
      { h: 'Agregar un mantenimiento' },
      {
        steps: [
          'Tocar el vehículo en la pantalla de inicio y luego **+ Mantenimiento**.',
          'Elegir uno de los mantenimientos frecuentes (por ejemplo, **Service** o **VTV**). La aplicación completa el nombre y el intervalo habitual. Si no figura en la lista, escribirlo en **Nombre**.',
          'Revisar **¿Cada cuánto tiempo?** y, si corresponde, **¿Cada cuántos km?**.',
          'En **Última vez que se hizo**, indicar la fecha y, si se solicita, el kilometraje. Si no se conocen con exactitud, se puede indicar un valor aproximado.',
          'Tocar **Agregar** y confirmar con **Sí, agregar**.',
        ],
      },
      { figs: [
        { fig: 'auto-acciones.jpg', caption: 'Accesos del vehículo.' },
        { fig: 'mant-1.jpg', caption: 'Mantenimientos frecuentes.' },
      ] },
      { figs: [
        { fig: 'mant-2.jpg', caption: 'Intervalo de tiempo y kilometraje.' },
        { fig: 'mant-3.jpg', caption: 'Última vez y próximo vencimiento.' },
      ] },
      { p: 'La sección **Cuándo avisar** es opcional; la aplicación propone valores adecuados.' },
      { h: 'Recordatorios de una sola vez' },
      { p: 'Para un recordatorio que no se repite, como volver al taller para un control, elegir **Volver al taller** o, en **¿Se repite?**, seleccionar **No, una sola vez**. Una vez realizado, el recordatorio se elimina automáticamente.' },
      { h: 'Registrar que un mantenimiento se realizó' },
      { p: 'No es necesario modificar el mantenimiento. Basta con registrar el trabajo correspondiente y marcar ese mantenimiento (ver capítulo 6). El plazo vuelve a contarse desde la fecha del trabajo.' },
      { h: 'Modificar o eliminar un mantenimiento' },
      { p: 'Tocar el mantenimiento en la pestaña **Estado**. Se abre con sus datos para modificarlos; al final de la pantalla se encuentra el botón **Borrar mantenimiento**.' },
    ],
  },
  {
    id: 'trabajos',
    title: 'Trabajos realizados',
    blocks: [
      { p: 'Cada trabajo realizado en el vehículo (service, cubiertas, frenos, chapa, VTV, etc.) se registra con su fecha, kilometraje y costo. Así se conforma el historial del vehículo. Se recomienda tener a mano la factura o el comprobante.' },
      {
        steps: [
          'Tocar el vehículo en la pantalla de inicio y luego **+ Trabajo**.',
          'En **Qué se hizo**, describir brevemente el trabajo (por ejemplo, "Cambio de aceite y filtros") y elegir la **Categoría**.',
          'Completar **Fecha**, **Km** y **Costo**. El campo **Taller** es opcional.',
          'Si el trabajo incluye alguno de los mantenimientos programados, marcarlo. El mantenimiento se da por realizado en esa fecha y kilometraje.',
          'Si corresponde volver al taller, marcar **¿Tenés que volver al taller?** e indicar en cuánto tiempo. La aplicación lo recordará.',
          'Opcionalmente, agregar **Notas**. Tocar **Guardar trabajo** y confirmar con **Sí, guardar**.',
        ],
      },
      { figs: [
        { fig: 'trabajo-1.jpg', caption: 'Descripción y categoría.' },
        { fig: 'trabajo-2.jpg', caption: 'Mantenimientos incluidos.' },
      ] },
      { h: 'Historial e informe en PDF' },
      { p: 'Los trabajos se consultan en **Trabajos**, en el menú inferior, o en la pestaña **Trabajos** de cada vehículo. Desde esa pestaña, **Exportar PDF** genera un informe con el historial del vehículo, útil por ejemplo al momento de venderlo.' },
    ],
  },
  {
    id: 'combustible',
    title: 'Cargas de combustible',
    blocks: [
      { p: 'Registrar las cargas de combustible permite conocer el consumo y el costo por kilómetro. Las cargas se pueden registrar aun sin conexión a internet.' },
      {
        steps: [
          'Tocar el vehículo en la pantalla de inicio y luego **+ Carga**.',
          'Elegir el combustible (**Nafta**, **GNC** o **Gasoil**) y, si corresponde, **Súper** o **Premium**. La fecha y el último kilometraje se completan automáticamente; corregir el kilometraje si es necesario.',
          'En **Cantidad**, indicar los litros (o metros cúbicos de GNC) cargados.',
          'En **¿Cuánto pagaste?**, elegir **Precio por L** o **Total pagado** e indicar el importe. La aplicación calcula el otro valor y sugiere el último precio registrado.',
          'Dejar marcado **Llené el tanque** si se completó el tanque; desmarcarlo en caso contrario.',
          'Tocar **Guardar carga** y confirmar con **Sí, guardar**.',
        ],
      },
      { figs: [
        { fig: 'carga-1.jpg', caption: 'Tipo de combustible, fecha y km.' },
        { fig: 'carga-2.jpg', caption: 'Cantidad e importe.' },
      ] },
      { p: 'La pestaña **Combustible** de cada vehículo muestra el consumo, el costo por kilómetro y el último precio pagado. El consumo se calcula a partir de dos cargas con tanque lleno y kilometraje registrado.' },
    ],
  },
  {
    id: 'gastos',
    title: 'Gastos',
    blocks: [
      { p: 'La sección **Gastos**, en el menú inferior, resume lo invertido en el vehículo. No requiere carga adicional: se calcula a partir de los trabajos y las cargas de combustible registrados.' },
      { fig: 'gastos.jpg', caption: 'Resumen de gastos del año.', width: 150 },
      {
        bullets: [
          'Total del año, promedio mensual y división entre trabajos y combustible.',
          'Gráfico mensual: en azul los trabajos y en naranja el combustible. Al tocar una barra se ve el detalle del mes.',
          'Selector de año en la esquina superior derecha.',
          'Gastos por categoría y, si hay más de un vehículo, por vehículo.',
        ],
      },
    ],
  },
  {
    id: 'logros',
    title: 'Logros',
    blocks: [
      { p: 'Los logros reconocen el uso constante de la aplicación: registrar el kilometraje cada semana, anotar los trabajos y las cargas, y mantener los avisos al día. Se obtienen automáticamente.' },
      { fig: 'logros.jpg', caption: 'Sección Logros.', width: 150 },
      {
        bullets: [
          'Al obtener un logro, la aplicación muestra una ventana de felicitación. Se cierra con **¡Genial!** (o **Siguiente**, si se obtuvieron varios a la vez).',
          'La sección **Logros** muestra todos los logros: los obtenidos, con su fecha, y los pendientes, con lo que falta para conseguirlos.',
          'Los logros de **Constancia** requieren registrar el kilometraje varias semanas seguidas. Si una semana no se registra, la cuenta se reinicia; los logros ya obtenidos se conservan.',
        ],
      },
      { note: 'Los logros premian el registro de la información, no el gasto ni el uso del vehículo.' },
    ],
  },
  {
    id: 'notificaciones',
    title: 'Notificaciones',
    blocks: [
      { p: 'AutoCar puede enviar notificaciones al celular cuando un mantenimiento está próximo a vencer o vencido, y un recordatorio semanal para registrar el kilometraje. Las notificaciones se activan una vez en cada dispositivo.' },
      { h: 'Activar las notificaciones' },
      {
        steps: [
          'En iPhone, abrir la aplicación desde el acceso directo (ver capítulo 2). En Android este paso no es necesario.',
          'Tocar **Ajustes** en el menú inferior.',
          'Tocar **Activar notificaciones** y confirmar con **Sí, activar**.',
          'Cuando el celular lo solicite, tocar **Permitir**.',
          'Para verificar el funcionamiento, tocar **Probar**: se recibe una notificación de prueba.',
        ],
      },
      { fig: 'ajustes.jpg', caption: 'Notificaciones y recordatorio semanal en Ajustes.', width: 175 },
      { h: 'Recordatorio semanal' },
      { p: 'Con la opción **Recordatorio semanal de km** activada, la aplicación envía un aviso el día elegido en **¿Qué día te lo mandamos?**, alrededor de las 9 de la mañana. Al tocar el aviso se abre la aplicación.' },
      { h: 'Avisos de mantenimiento' },
      { p: 'Se envían automáticamente cuando un mantenimiento pasa a **Próximo** o a **Vencido**, y se repiten cada 7 días mientras se mantenga en ese estado.' },
    ],
  },
  {
    id: 'errores',
    title: 'Corrección de errores',
    blocks: [
      {
        defs: [
          ['Confirmación previa', 'Antes de guardar, la aplicación muestra un resumen de los datos. Solo se guarda al tocar el botón que comienza con **Sí**. Para corregir, tocar **Cancelar**.'],
          ['Modificar un registro', 'Tocar el trabajo o la carga en la lista correspondiente. Se abre con sus datos para modificarlos y guardarlos nuevamente.'],
          ['Eliminar un registro', 'Abrir el trabajo, la carga o el mantenimiento y tocar el botón **Borrar** al final de la pantalla. Inmediatamente después aparece la opción **Deshacer**, que lo restaura.'],
          ['Kilometraje incorrecto', 'Tocar el vehículo, abrir la pestaña **Km**, tocar el ícono de papelera junto al registro incorrecto y confirmar. Luego registrar el valor correcto.'],
          ['Eliminar un vehículo', 'Elimina también todo su historial y no se puede deshacer. La aplicación lo advierte antes de continuar.'],
        ],
      },
    ],
  },
  {
    id: 'faq',
    title: 'Preguntas frecuentes',
    blocks: [
      { qa: ['¿Se puede usar sin conexión a internet?', 'Sí. Los datos se guardan en el celular y se envían automáticamente cuando se recupera la conexión. Mientras tanto, la aplicación muestra el aviso "Sin conexión".'] },
      { qa: ['¿Se pierden los datos al cambiar de celular?', 'No. La información queda guardada en la cuenta. Basta con ingresar con la misma cuenta de Google en el nuevo dispositivo.'] },
      { qa: ['No llegan las notificaciones.', 'En **Ajustes**, verificar que se muestre el botón **Desactivar en este dispositivo**, que indica que están activas, y tocar **Probar**. En iPhone, abrir la aplicación desde el acceso directo y no desde Safari.'] },
      { qa: ['¿Se puede registrar más de un vehículo?', 'Sí. En la pantalla de inicio, tocar el botón **+** de arriba a la derecha.'] },
      { qa: ['¿Qué datos indicar si no se recuerdan con exactitud?', 'Para el kilometraje, el valor actual del tablero. Para la última vez que se realizó un mantenimiento, una fecha y un kilometraje aproximados.'] },
      { qa: ['¿Quién puede ver la información?', 'Solamente el titular de la cuenta.'] },
      { qa: ['La aplicación no responde o se ve de forma incorrecta.', 'Cerrar la aplicación por completo y volver a abrirla. Si el problema continúa, comunicarse con quien administra la aplicación.'] },
    ],
  },
]
