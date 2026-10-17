import type { ISODate } from './types'

export interface Novedad {
  version: string
  /** Día en que salió la versión. Las cuentas creadas después no la ven como nueva. */
  date: ISODate
  items: { title: string; text: string }[]
  /** Se anuncia con una ventana al entrar. Sólo para cambios grandes: lo demás queda en la sección. */
  destacado?: boolean
}

/**
 * Lo nuevo de cada versión contado para el usuario, la más nueva primero. No es el CHANGELOG: las versiones sin
 * cambios visibles (seguridad, dependencias, arreglos internos) no van acá.
 */
export const NOVEDADES: Novedad[] = [
  {
    version: '1.1.0',
    date: '2026-10-17',
    destacado: true,
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
