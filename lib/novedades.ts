import type { ISODate } from './types'

export interface Novedad {
  version: string
  /** Día en que salió la versión. Las cuentas creadas después no la ven como nueva. */
  date: ISODate
  items: { title: string; text: string }[]
}

/**
 * Lo nuevo de cada versión contado para el usuario, la más nueva primero. No es el CHANGELOG: las versiones sin
 * cambios visibles (seguridad, dependencias, arreglos internos) no van acá.
 */
export const NOVEDADES: Novedad[] = [
  {
    version: '1.5.0',
    date: '2026-10-26',
    items: [
      {
        title: 'Corregir un trabajo corrige sus mantenimientos',
        text: 'Si le sacás un mantenimiento a un trabajo, le cambiás la fecha o lo borrás, el mantenimiento vuelve a como estaba antes de ese trabajo. Al confirmar te decimos cómo queda cada uno.',
      },
      {
        title: 'Recordatorios cumplidos',
        text: 'Un "Volver al taller" que cumplió un trabajo ya no se borra: queda en "Cumplidos", al final de la pestaña Estado. Si borrás el trabajo, vuelve a estar activo.',
      },
      {
        title: 'Aprobás lo que viste',
        text: 'Si en un auto compartido la otra persona corrige un trabajo mientras lo estás revisando, te avisamos para que lo mires de nuevo antes de aprobarlo.',
      },
      {
        title: 'Sin pisar cambios',
        text: 'Al editar un trabajo, una carga o un mantenimiento se guarda sólo lo que cambiaste, así no se pisa lo que corrigió otra persona desde su celular.',
      },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-26',
    items: [
      {
        title: 'Mantenimientos con el km de ese día',
        text: 'Si cargás un trabajo sin km, el mantenimiento se da por hecho con los km que tenía el auto ese día según tus registros, no con los de hoy. Lo vas a ver como "≈ 43.000 km (estimado)".',
      },
      {
        title: 'Km de otro día',
        text: 'Al cargar km podés elegir la fecha. Tienen que encajar entre tus registros de antes y de después de ese día.',
      },
      {
        title: 'Km que no cierran',
        text: 'Si una carga o un trabajo tiene km que no encajan con tus otros registros, te avisamos antes de guardar.',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-26',
    items: [
      {
        title: 'Corregir una carga corrige los km',
        text: 'Si te equivocás en los km de una carga o un trabajo y después los corregís, el auto vuelve a los km reales. Lo mismo si le sacás los km o lo borrás.',
      },
      {
        title: 'De dónde sale cada registro de km',
        text: 'En la pestaña Km, el registro de una carga dice "Carga del 12/03" y el de un trabajo dice su nombre. Tocalo para abrirlo y corregirlo desde ahí.',
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-24',
    items: [
      {
        title: 'Compartí un auto',
        text: 'En "Editar auto" podés sumar hasta 2 personas con el mail con el que entran con Google. El auto les aparece apenas entran, sin aceptar nada, y con "Avisarle" les mandás el link por WhatsApp.',
      },
      {
        title: 'Qué puede hacer cada uno',
        text: 'Quien tiene el auto compartido ve todo y carga combustible, km y trabajos. Edita o borra sólo lo que cargó, y puede salir del auto cuando quiera. Editar el auto y el plan de mantenimiento sigue siendo del dueño.',
      },
      {
        title: 'Trabajos para aprobar',
        text: 'Los trabajos que carga otra persona quedan pendientes hasta que el dueño los aprueba desde la campanita: recién ahí cuentan en gastos y marcan los mantenimientos. Si el dueño lo rechaza, quien lo cargó lo puede corregir y volver a mandar.',
      },
      {
        title: 'Cargado por',
        text: 'En un auto compartido, cada trabajo, carga y registro de km dice quién lo cargó. Y los logros de cada uno cuentan sólo lo suyo.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-17',
    items: [
      {
        title: 'Pendientes',
        text: 'La campanita de arriba junta lo que tenés que hacer: los km por cargar y los mantenimientos vencidos o por vencer. Si descartaste la notificación, queda ahí hasta que lo resolvés.',
      },
      {
        title: 'Km de la semana en el Inicio',
        text: 'Si te faltan los km del recordatorio semanal, el Inicio te lo recuerda con un botón para cargarlos.',
      },
      {
        title: 'Novedades',
        text: 'Esta sección. Cuando la app tenga algo nuevo te lo contamos acá.',
      },
      {
        title: 'Avisos que podés ocultar',
        text: 'Los consejos que ya leíste, como el de instalar la app en iPhone, se pueden cerrar para que no aparezcan más.',
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-09',
    items: [
      {
        title: 'Logros',
        text: '23 medallas que premian la constancia: cargar los km cada semana, registrar trabajos y cargas, tener los mantenimientos al día.',
      },
      {
        title: 'Pestañas del auto más rápidas',
        text: 'Cambiar entre Estado, Trabajos, Combustible y Km es instantáneo.',
      },
    ],
  },
]

/** Clave de localStorage con la última versión de novedades que el usuario vio en este dispositivo. */
export const SEEN_KEY = 'autocar:novedades-vistas'

function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/**
 * Novedades que el usuario todavía no vio. Si nunca abrió la sección en este dispositivo, cuentan las que
 * salieron después de crear la cuenta: a alguien que recién llega no se le anuncia lo que ya encontró hecho.
 */
export function unseenNovedades(seenVersion: string | null, accountCreated: ISODate | null, list = NOVEDADES): Novedad[] {
  if (seenVersion) return list.filter(n => compareVersions(n.version, seenVersion) > 0)
  if (!accountCreated) return []
  return list.filter(n => n.date > accountCreated)
}
