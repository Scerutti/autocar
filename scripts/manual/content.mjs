/**
 * Contenido del manual de usuario (npm run manual lo convierte en docs/manual-de-usuario.pdf).
 * Al cambiar la app: actualizar el texto y las capturas (375 px de ancho, con la patente pixelada), subir
 * manualVersion, apuntar appVersion a la versión descripta y sumar una fila a history.
 * Bloques: p (párrafo), steps (pasos numerados), bullets, fig (imagen con epígrafe), table, note, qa.
 * **texto** = negrita (nombres de botones y opciones).
 */

export const META = {
  title: 'Manual de usuario',
  manualVersion: '2.0',
  appVersion: '1.5.0',
  date: 'Octubre de 2026',
  history: [
    ['1.0', 'Octubre de 2026', 'Primera versión, para AutoCar 1.0.0.'],
    ['2.0', 'Octubre de 2026', 'Para AutoCar 1.5.0: autos compartidos y aprobación de trabajos, pendientes, novedades, km de otro día, km estimados y mantenimientos cumplidos.'],
  ],
  url: 'autocar-xi.vercel.app',
}

export const CHAPTERS = [
  {
    id: 'intro',
    title: 'Introducción',
    blocks: [
      { p: 'AutoCar es una aplicación para llevar al día el mantenimiento de uno o más vehículos. Permite registrar el kilometraje, programar avisos de mantenimiento, guardar los trabajos realizados y las cargas de combustible, y consultar los gastos.' },
      { p: 'La aplicación avisa con anticipación cuando un mantenimiento está próximo a vencer, ya sea por kilometraje o por fecha, y conserva un historial completo del vehículo. Un vehículo se puede compartir con hasta dos personas, que también registran lo que le hacen.' },
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
          'Las imágenes corresponden a AutoCar 1.5.0 en un celular. Pueden variar levemente según el dispositivo y los datos cargados.',
          'Los datos que se ven en las imágenes son de ejemplo.',
          'Se llama **dueño** a quien registró el vehículo, y **persona invitada** a quien lo tiene compartido (ver capítulo 8).',
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
      { note: 'Si otra persona compartió su vehículo con esta cuenta, aparece en la pantalla de inicio sin hacer nada más. No es necesario registrarlo de nuevo.' },
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
          ['Encabezado', 'Saludo y fecha del día. A la derecha, el botón **+** para agregar un vehículo y la campana de **Pendientes**.'],
          ['Aviso de km', 'Si falta registrar el kilometraje de la semana, un aviso "Te faltan los km de tu…" con el botón **Cargar**.'],
          ['Tus autos', 'Una tarjeta por vehículo, con su foto, el kilometraje actual y cuándo se registró. Al tocarla se abre su detalle.'],
          ['Próximo', 'Mantenimiento que vence primero, con una barra que indica cuánto falta.'],
          ['Cargar km', 'Botón para registrar el kilometraje (ver capítulo 4).'],
          ['Para revisar', 'Aparece solo si hay mantenimientos vencidos o próximos a vencer.'],
          ['Logros', 'Cantidad de logros obtenidos y el próximo por conseguir (ver capítulo 10).'],
          ['Actividad reciente', 'Últimos trabajos y cargas de combustible registrados. **Ver todos** abre el historial completo.'],
        ],
      },
      { h: 'Pendientes' },
      { p: 'La campana de la parte superior junta todo lo que hay para hacer en los vehículos. El número indica cuántas cosas esperan atención. Al tocarla se abre la lista **Pendientes**; si no hay nada, muestra "Todo al día".' },
      { fig: 'pendientes.jpg', caption: 'Lista de pendientes.', width: 175 },
      {
        defs: [
          ['Cargar los km', 'Falta el kilometraje de la semana. El botón **Cargar** abre la ventana para registrarlo.'],
          ['Mantenimiento', 'Un mantenimiento vencido o próximo a vencer, con lo que falta.'],
          ['Revisar', 'Un trabajo que registró una persona invitada y espera la aprobación del dueño, con los botones **Aprobar** y **Rechazar** (ver capítulo 8).'],
          ['Rechazado', 'Un trabajo propio que el dueño rechazó. Se puede corregir y volver a mandar, o borrar.'],
          ['Auto compartido', 'Otra persona compartió su vehículo con esta cuenta. Se muestra una sola vez.'],
          ['Novedades', 'La aplicación tiene funciones nuevas para conocer.'],
        ],
      },
      { p: 'Un pendiente desaparece de la lista cuando se resuelve: por ejemplo, al registrar el kilometraje o el trabajo del mantenimiento vencido. Aunque se descarte la notificación del celular, el pendiente sigue en la lista.' },
      { h: 'Menú inferior' },
      { p: 'El menú de la parte inferior está disponible en todas las pantallas y permite moverse entre las secciones de la aplicación.' },
      { fig: 'barra.jpg', caption: 'Menú inferior.', width: 300 },
      {
        defs: [
          ['Inicio', 'Vuelve a la pantalla de inicio.'],
          ['Trabajos', 'Abre el **Historial**: trabajos y cargas de combustible de todos los vehículos, agrupados por mes.'],
          ['Gastos', 'Resumen de gastos del año.'],
          ['Logros', 'Logros obtenidos y pendientes.'],
          ['Ajustes', 'Cuenta, notificaciones, recordatorio semanal y novedades.'],
        ],
      },
      { p: 'Para volver a la pantalla anterior se usa la flecha de la esquina superior izquierda.' },
      { h: 'Novedades' },
      { p: 'Cuando la aplicación se actualiza con algo nuevo, al abrirla se muestra una ventana que lo cuenta. Se cierra con **Entendido**; **Ver todas** abre la lista completa. Las novedades de todas las versiones también se consultan en **Ajustes**, en **Novedades**.' },
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
          'Dejar la **Fecha** de hoy, salvo que el kilometraje sea de otro día.',
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
      { h: 'Kilometraje de otro día' },
      { p: 'Si se olvidó registrar el kilometraje, se puede cargar con la fecha en que se leyó. En **Fecha**, elegir ese día; el campo pasa a llamarse **Kilómetros de ese día**. No se aceptan fechas futuras.' },
      { p: 'El valor tiene que encajar con los registros de antes y de después de esa fecha. Si no encaja, la aplicación lo indica: por ejemplo, "El 12 de mar de 2026 ya tenía 45.000 km: no puede ser menos".' },
      { h: 'Registros de km' },
      { p: 'Para ver todos los registros de un vehículo, tocarlo en la pantalla de inicio y abrir la pestaña **Km**. Muestra los kilómetros actuales, el uso promedio por semana, un gráfico y la lista **Registros de km**.' },
      { fig: 'km-registros.jpg', caption: 'Registros de km de un vehículo.', width: 175 },
      {
        defs: [
          ['Carga manual', 'Kilometraje registrado con **Cargar km**. Se puede borrar con el ícono de papelera.'],
          ['Alta del auto', 'Kilometraje indicado al registrar el vehículo.'],
          ['Carga del dd/mm', 'Sale de una carga de combustible. Al tocarlo se abre la carga.'],
          ['Trabajo: …', 'Sale de un trabajo. Al tocarlo se abre el trabajo.'],
        ],
      },
      { p: 'El kilometraje de una carga o de un trabajo se corrige desde ese registro, no desde la pestaña **Km**. Al corregirlo, o al borrar la carga o el trabajo, el kilometraje del vehículo se vuelve a calcular.' },
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
      { p: 'Cuando un mantenimiento tiene fecha y kilometraje, vence por lo que ocurra primero. Si falta el kilometraje de la última vez, el mantenimiento indica "Falta el km de la última vez" y se calcula solo por fecha hasta que se complete.' },
      { h: 'Agregar un mantenimiento' },
      {
        steps: [
          'Tocar el vehículo en la pantalla de inicio y luego **+ Mantenimiento**.',
          'Elegir uno de los mantenimientos frecuentes (por ejemplo, **Service** o **VTV**). La aplicación completa el nombre y el intervalo habitual. Si no figura en la lista, escribirlo en **Nombre**.',
          'Revisar **¿Cada cuánto tiempo?** y, si corresponde, **¿Cada cuántos km?**.',
          'En **Última vez (si no hay trabajos)**, indicar la fecha y, si se solicita, el kilometraje. Si no se conocen con exactitud, se puede indicar un valor aproximado.',
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
      { p: 'La sección **Cuándo avisar (opcional)** permite elegir con cuántos kilómetros o días de anticipación avisar. Si se deja vacía, la aplicación propone valores adecuados.' },
      { h: 'Registrar que un mantenimiento se realizó' },
      { p: 'No es necesario modificar el mantenimiento. Basta con registrar el trabajo correspondiente y marcar ese mantenimiento (ver capítulo 6). El plazo vuelve a contarse desde la fecha y el kilometraje del trabajo. Al abrir el mantenimiento, el botón **Lo hice: registrar el trabajo** abre un trabajo nuevo con ese mantenimiento ya marcado.' },
      { p: 'Mientras haya un trabajo que lo incluya, el mantenimiento indica "Según el trabajo «…» del dd/mm", con un enlace a ese trabajo. La fecha y el kilometraje de **Última vez (si no hay trabajos)** se usan solo si no hay ningún trabajo, o si se borra el trabajo o se le quita este mantenimiento.' },
      { p: 'Si el trabajo no tiene kilometraje, la aplicación usa el que tenía el vehículo ese día según sus registros y lo muestra como estimado, por ejemplo "≈ 43.000 km (estimado)".' },
      { h: 'Recordatorios de una sola vez' },
      { p: 'Para un recordatorio que no se repite, como volver al taller para un control, elegir **Volver al taller** o, en **¿Se repite?**, seleccionar **No, una sola vez**. En ese caso se indica **¿Dentro de cuánto tiempo?** y **Desde cuándo se cuenta**.' },
      { p: 'Cuando se registra el trabajo que lo incluye, el recordatorio queda cumplido: deja de avisar y pasa a la sección **Cumplidos**, al final de la pestaña **Estado**. Tocar **Cumplidos** para desplegarla; cada uno indica con qué trabajo se cumplió. Si ese trabajo se borra, o se le quita el recordatorio, vuelve a estar activo.' },
      { h: 'Modificar o eliminar un mantenimiento' },
      { p: 'Tocar el mantenimiento en la pestaña **Estado**. Se abre con sus datos para modificarlos; al final de la pantalla se encuentra el botón **Borrar mantenimiento**. Borrar un mantenimiento no borra los trabajos ya registrados.' },
      { note: 'Solo el dueño del vehículo agrega, modifica o borra mantenimientos. Una persona invitada los ve, pero no los puede cambiar.' },
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
          'Completar **Fecha** y **Costo ($)**. El **Km** es opcional, salvo en el caso que se explica más abajo. Los campos **Taller** y **Notas** también son opcionales.',
          'En **¿Este trabajo incluye algún mantenimiento?**, marcar los mantenimientos programados que se hicieron. Los que se repiten vuelven a contar desde ese día; los de una sola vez quedan cumplidos.',
          'Si corresponde volver al taller, marcar **¿Tenés que volver al taller?** e indicar en cuánto tiempo. La aplicación lo recordará.',
          'Tocar **Guardar trabajo**, revisar el resumen y confirmar con **Sí, guardar**.',
        ],
      },
      { figs: [
        { fig: 'trabajo-1.jpg', caption: 'Descripción y categoría.' },
        { fig: 'trabajo-2.jpg', caption: 'Mantenimientos incluidos.' },
      ] },
      { h: 'El kilometraje del trabajo' },
      { p: 'Si se marca un mantenimiento que vence por kilometraje y el campo **Km** queda vacío, la aplicación estima el kilometraje de ese día con los registros del vehículo y lo muestra en el campo como sugerencia ("≈ estimado con tus registros; corregilo si lo sabés"). En el resumen figura como **Km (estimado)**. Si no puede estimarlo, el kilometraje es obligatorio.' },
      { p: 'Si el kilometraje no encaja con los otros registros del vehículo (por ejemplo, un cero de más), la aplicación lo advierte en el resumen antes de guardar.' },
      { h: 'Corregir o borrar un trabajo' },
      { p: 'Tocar el trabajo en el historial para abrirlo, modificarlo y tocar **Guardar cambios**. Si el cambio afecta a algún mantenimiento (otra fecha, otro kilometraje o un mantenimiento desmarcado), el resumen indica cómo queda cada uno; por ejemplo, "Service vuelve a 12 de mar de 2026 · 40.000 km".' },
      { p: 'Al borrar un trabajo con **Borrar trabajo**, sus mantenimientos vuelven a como estaban antes de él: al trabajo anterior que los incluía o a la **Última vez** cargada en el mantenimiento.' },
      { h: 'Historial e informe en PDF' },
      { p: 'Los trabajos se consultan en **Trabajos**, en el menú inferior (pantalla **Historial**), o en la pestaña **Trabajos** de cada vehículo, que muestra también el total histórico.' },
      { p: 'Desde la pestaña **Trabajos** del vehículo, **Exportar PDF** genera un informe con su historial, útil por ejemplo al momento de venderlo. Se elige el período y si se muestra el costo de cada trabajo; luego tocar **Generar PDF** y, cuando está listo, **Compartir** o **Descargar PDF**.' },
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
      { p: 'Si el kilometraje no encaja con los otros registros del vehículo, la aplicación lo advierte en el resumen antes de guardar.' },
      { p: 'La pestaña **Combustible** de cada vehículo muestra el consumo, el costo por kilómetro y el último precio pagado. El consumo se calcula a partir de dos cargas con tanque lleno y kilometraje registrado.' },
    ],
  },
  {
    id: 'compartir',
    title: 'Autos compartidos',
    blocks: [
      { p: 'El dueño de un vehículo lo puede compartir con hasta dos personas, por ejemplo con quienes también lo manejan. Cada persona usa su propia cuenta de Google.' },
      { h: 'Compartir un vehículo' },
      {
        steps: [
          'Tocar el vehículo en la pantalla de inicio y luego el lápiz de arriba a la derecha (**Editar auto**).',
          'En la sección **Compartir**, escribir en **Mail** la dirección con la que la otra persona entra con Google, en minúsculas.',
          'Tocar **Compartir** y confirmar con **Sí, compartir**.',
          'Tocar **Avisarle** para mandarle a la persona el enlace de la aplicación por WhatsApp u otro medio.',
        ],
      },
      { fig: 'compartir.jpg', caption: 'Sección Compartir de Editar auto.', width: 175 },
      { p: 'La persona ve el vehículo apenas entra a la aplicación con ese mail, sin tener que aceptar nada. Para dejar de compartirlo, tocar la **X** junto a su mail y confirmar con **Sí, sacar**. Lo que registró queda en el historial.' },
      { h: 'Qué puede hacer cada uno' },
      {
        table: {
          head: ['Acción', 'Dueño', 'Persona invitada'],
          rows: [
            ['Ver todo el vehículo', 'Sí', 'Sí'],
            ['Registrar km, cargas y trabajos', 'Sí', 'Sí (los trabajos esperan aprobación)'],
            ['Modificar o borrar registros', 'Todos', 'Solo los propios (un trabajo, mientras no esté aprobado)'],
            ['Mantenimientos', 'Agregar, modificar y borrar', 'Solo ver'],
            ['Editar, compartir o borrar el vehículo', 'Sí', 'No'],
          ],
          widths: [36, 24, 40],
        },
      },
      { p: 'En un vehículo compartido, cada trabajo, carga y registro de km indica quién lo cargó ("Cargado por…"). La pantalla del vehículo indica "Compartido por…" a la persona invitada, y "Compartido con…" al dueño.' },
      { h: 'Aprobar o rechazar un trabajo' },
      { p: 'Los trabajos que registra una persona invitada quedan **Pendiente** hasta que el dueño los aprueba. Hasta entonces no cuentan en los gastos ni marcan los mantenimientos.' },
      {
        steps: [
          'Tocar la campana de **Pendientes** o abrir el trabajo, que muestra "Este trabajo espera tu aprobación".',
          'Revisar los datos y tocar **Aprobar** o **Rechazar**.',
          'Confirmar con **Sí, aprobar** o **Sí, rechazar**.',
        ],
      },
      { p: 'Un trabajo rechazado queda con la etiqueta **Rechazado**. Quien lo cargó lo puede corregir y tocar **Volver a mandar**, o borrarlo. Si la persona corrige el trabajo mientras el dueño lo está revisando, la aplicación avisa que cambió para que se revise de nuevo.' },
      { h: 'Salir de un vehículo compartido' },
      { p: 'La persona invitada puede dejar de ver el vehículo con el botón **Salir de este auto**, en la pantalla del vehículo, y confirmar con **Sí, salir**. Lo que cargó queda en el historial. Para volver, el dueño la tiene que agregar de nuevo.' },
      { note: 'Las notificaciones de mantenimiento y el recordatorio semanal de km de un vehículo le llegan solo a su dueño.' },
    ],
  },
  {
    id: 'gastos',
    title: 'Gastos',
    blocks: [
      { p: 'La sección **Gastos**, en el menú inferior, resume lo invertido en el vehículo. No requiere carga adicional: se calcula a partir de los trabajos y las cargas de combustible registrados. Los trabajos pendientes de aprobación o rechazados no se cuentan.' },
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
          'En un vehículo compartido, los logros de cada persona cuentan solo lo que registró ella.',
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
      { p: 'Se envían automáticamente cuando un mantenimiento pasa a **Próximo** o a **Vencido**, y se repiten cada 7 días mientras se mantenga en ese estado. Lo mismo queda en la lista de **Pendientes** (ver capítulo 3), aunque se descarte la notificación.' },
    ],
  },
  {
    id: 'errores',
    title: 'Corrección de errores',
    blocks: [
      {
        defs: [
          ['Confirmación previa', 'Antes de guardar, la aplicación muestra un resumen de los datos. Solo se guarda al tocar el botón que comienza con **Sí**. Para corregir, tocar **Cancelar**.'],
          ['Modificar un registro', 'Tocar el trabajo o la carga en la lista correspondiente. Se abre con sus datos para modificarlos y guardarlos nuevamente. Si no se cambió nada, la aplicación indica "Sin cambios".'],
          ['Eliminar un registro', 'Abrir el trabajo, la carga o el mantenimiento y tocar el botón **Borrar** al final de la pantalla. Inmediatamente después aparece la opción **Deshacer**, que lo restaura.'],
          ['Kilometraje incorrecto', 'Si es una carga manual: tocar el vehículo, abrir la pestaña **Km**, tocar el ícono de papelera junto al registro y confirmar; luego registrar el valor correcto. Si sale de una carga o de un trabajo: tocar el registro para abrirlo y corregir el kilometraje ahí.'],
          ['Trabajo con un mantenimiento equivocado', 'Abrir el trabajo, desmarcar el mantenimiento y guardar. El mantenimiento vuelve a como estaba antes de ese trabajo.'],
          ['Eliminar un vehículo', 'Solo el dueño. Elimina también todo su historial y no se puede deshacer. La aplicación lo advierte antes de continuar.'],
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
      { qa: ['No llegan las notificaciones.', 'En **Ajustes**, verificar que se muestre el botón **Desactivar en este dispositivo**, que indica que están activas, y tocar **Probar**. En iPhone, abrir la aplicación desde el acceso directo y no desde Safari. En un vehículo compartido, los avisos le llegan solo al dueño.'] },
      { qa: ['¿Se puede registrar más de un vehículo?', 'Sí. En la pantalla de inicio, tocar el botón **+** de arriba a la derecha.'] },
      { qa: ['¿Qué datos indicar si no se recuerdan con exactitud?', 'Para el kilometraje, el valor actual del tablero. Para la última vez que se realizó un mantenimiento, una fecha y un kilometraje aproximados.'] },
      { qa: ['¿Quién puede ver la información?', 'El titular de la cuenta y, de cada vehículo compartido, las personas con quienes se compartió.'] },
      { qa: ['Me compartieron un vehículo y no lo veo.', 'Hay que entrar con la misma cuenta de Google cuyo mail cargó el dueño. Si es otro mail, el dueño tiene que compartirlo de nuevo con el correcto.'] },
      { qa: ['Registré un trabajo en un vehículo compartido y no aparece en los gastos.', 'Los trabajos de una persona invitada cuentan recién cuando el dueño los aprueba.'] },
      { qa: ['La aplicación no responde o se ve de forma incorrecta.', 'Cerrar la aplicación por completo y volver a abrirla. Si el problema continúa, comunicarse con quien administra la aplicación.'] },
    ],
  },
]
