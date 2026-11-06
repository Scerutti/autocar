'use client'

import { useSyncExternalStore } from 'react'

const EVENT = 'autocar:local-store'

/**
 * Lo que no se pudo guardar en localStorage (modo privado o almacenamiento bloqueado): así lo que el usuario
 * descartó no vuelve a aparecer hasta que recargue.
 */
const memory = new Map<string, string | null>()

/** Valor guardado en este dispositivo; null si no hay o no se puede leer. */
export function readLocal(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Todas las claves guardadas en este dispositivo (las de localStorage y las que quedaron en memoria). */
export function localKeys(): string[] {
  const keys = new Set(memory.keys())
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key != null) keys.add(key)
    }
  } catch {
    return [...keys]
  }
  return [...keys]
}

/** Guarda un valor en este dispositivo y avisa a los componentes que lo usan (en otras pestañas avisa el evento "storage"). */
export function writeLocal(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    memory.delete(key)
  } catch {
    memory.set(key, value)
  }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/**
 * Valor guardado en este dispositivo, en vivo. Es undefined en el servidor y durante la hidratación: así no
 * aparece y desaparece algo antes de saber qué hay guardado.
 */
export function useLocalValue(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => readLocal(key),
    () => undefined,
  )
}
