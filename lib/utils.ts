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
