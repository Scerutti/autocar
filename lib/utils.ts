import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Adónde volver después del login (`?next=`): sólo rutas de esta app. Cualquier otra cosa
 * ("//otro.com", "/\otro.com", "https://…") vuelve al inicio, para que un link no pueda mandar a otro sitio.
 */
export function safeNextPath(next: string | null | undefined, origin: string): string {
  if (!next) return '/'
  try {
    const url = new URL(next, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/'
  } catch {
    return '/'
  }
}

/**
 * Si dos valores de un registro son iguales: null y undefined cuentan igual (sin dato), las listas se comparan elemento
 * por elemento y en orden, los mapas por contenido (sin importar el orden de las claves) y las fechas por instante.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>
    const y = b as Record<string, unknown>
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].every(k => sameValue(x[k], y[k]))
  }
  return a === b
}

/**
 * Los campos de `draft` que no son iguales en `original` (`sameValue`), con el valor de `draft`. Es lo que se escribe
 * al editar un registro (`update`): así dos dispositivos que cambian campos distintos no se pisan. Sólo mira las claves
 * de `draft`; vacío = no cambió nada.
 */
export function changedFields<T extends object>(original: NoInfer<T>, draft: T): Partial<T> {
  const changed: Partial<T> = {}
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (!sameValue(original[key], draft[key])) changed[key] = draft[key]
  }
  return changed
}

/** Si `changedFields` no encontró nada que escribir. */
export const isUnchanged = (changes: object) => Object.keys(changes).length === 0
