'use client'

import { useMemo } from 'react'
import type { CarInput, FollowUp, FuelInput, JobInput, RuleInput } from './db'
import { fuelLabel } from './fuel'
import { formatDate, formatKm, formatMoney, formatNumber } from './format'
import { readLocal, useLocalValue, writeLocal } from './local-store'
import { FUEL_UNITS, JOB_CATEGORY_LABELS, type ISODate } from './types'
import { changedFields, isUnchanged } from './utils'

/** Qué se guardó: una carga, un trabajo, unos km, un mantenimiento o un auto. */
export type OutboxKind = 'fuel' | 'job' | 'km' | 'rule' | 'car'

/** `pending`: esperando que el servidor lo confirme. `failed`: el servidor lo rechazó y el usuario decide qué hacer. */
export type OutboxState = 'pending' | 'failed'

/** Los km que se cargan a mano (`recordKm`). */
export interface KmInput {
  km: number
  date: ISODate
}

/**
 * Lo que hace falta para volver a llamar la función de `lib/db.ts`. `recordId` es el id del documento que escribe,
 * generado antes de escribir (en un alta) para poder buscarlo en el servidor después de recargar. `data` es el input de
 * la función y `original`, al editar, los mismos campos como estaban al abrir el formulario (null = alta).
 */
export type OutboxWrite =
  | { kind: 'fuel'; payload: { recordId: string; data: FuelInput; original: FuelInput | null } }
  | { kind: 'job'; payload: { recordId: string; data: JobInput; original: JobInput | null; followUp: FollowUp | null } }
  | { kind: 'km'; payload: { recordId: string; data: KmInput; original: null } }
  | { kind: 'rule'; payload: { recordId: string; data: RuleInput; original: RuleInput | null } }
  | { kind: 'car'; payload: { recordId: string; data: CarInput; original: CarInput | null; initialKm: number | null } }

/**
 * Una escritura que el usuario hizo y el servidor todavía no confirmó (`pending`) o rechazó (`failed`, con el motivo en
 * `error`). `carLabel` es el nombre del auto, para mostrarla aunque ya no se tenga acceso al auto. `createdAt` en
 * milisegundos. `conflict`: una edición que, al reconciliar, el servidor tiene con otros valores (`CHANGED_ELSEWHERE`):
 * no se reintenta, sólo se edita sobre lo de ahora o se descarta.
 */
export type OutboxEntry = {
  id: string
  carId: string
  carLabel: string
  label: string
  createdAt: number
  state: OutboxState
  error?: string
  conflict?: boolean
} & OutboxWrite

/** Una entrada de un tipo: la que recibe el formulario de ese tipo como borrador. */
export type OutboxEntryOf<K extends OutboxKind> = Extract<OutboxEntry, { kind: K }>

/** Días que se guarda una entrada: después se borra sola (`withoutExpired`). */
export const OUTBOX_DAYS = 30

/** Lo que dice una escritura que, al recargar la app, el servidor no tiene. */
export const NOT_SAVED = 'El servidor no la tiene: puede que la haya rechazado.'

/** Lo que dice una edición que, al recargar la app, el servidor tiene con otros valores en los campos que cambió. */
export const CHANGED_ELSEWHERE = 'Cambió en otro dispositivo. Tocá Editar para ver cómo está ahora, con tus cambios encima.'

/** Lo que dice una escritura de un auto al que ya no se tiene acceso (p. ej. el dueño sacó al miembro). */
export const NO_ACCESS = 'Ya no tenés acceso a este auto.'

const KINDS: readonly OutboxKind[] = ['fuel', 'job', 'km', 'rule', 'car']

const NOUNS: Record<OutboxKind, [string, string]> = {
  fuel: ['carga', 'cargas'],
  job: ['trabajo', 'trabajos'],
  km: ['registro de km', 'registros de km'],
  rule: ['mantenimiento', 'mantenimientos'],
  car: ['auto', 'autos'],
}

/** Clave de localStorage de la bandeja: una por cuenta, así otra cuenta en el mismo dispositivo no la ve. */
export const outboxKey = (uid: string) => `autocar:outbox:${uid}`

/** Id de una entrada nueva. */
export function newOutboxId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

/** Los campos de `draft` como los tiene `record` (lo que falta, null): el `original` de una edición. */
export function originalFields<T extends object>(record: object, draft: T): T {
  const source = record as Record<string, unknown>
  return Object.fromEntries(Object.keys(draft).map(key => [key, source[key] ?? null])) as T
}

/** Texto de la entrada: qué se guardó, para la bandeja y la campanita. */
export function outboxLabel(write: OutboxWrite): string {
  switch (write.kind) {
    case 'fuel': {
      const d = write.payload.data
      return `Carga de ${fuelLabel(d)} · ${formatNumber(d.quantity)} ${FUEL_UNITS[d.fuelType]} · ${formatMoney(d.total)}`
    }
    case 'job':
      return `Trabajo: ${write.payload.data.title}`
    case 'km':
      return `${formatKm(write.payload.data.km)} del ${formatDate(write.payload.data.date)}`
    case 'rule':
      return `Mantenimiento: ${write.payload.data.name}`
    case 'car':
      return `${write.payload.original ? 'Cambios del auto' : 'Auto nuevo'}: ${[write.payload.data.brand, write.payload.data.model].join(' ')}`
  }
}

/** Una entrada nueva, `pending`, con su texto (`outboxLabel`). */
export function outboxEntry(input: { id: string; carId: string; carLabel: string; write: OutboxWrite; now?: number }): OutboxEntry {
  const { write, now = Date.now(), ...base } = input
  return { ...base, ...write, label: outboxLabel(write), createdAt: now, state: 'pending' }
}

/** Las filas con los datos de una entrada, para verlos aunque no se pueda abrir el formulario. */
export function outboxDetails(entry: OutboxEntry): { label: string; value: string }[] {
  switch (entry.kind) {
    case 'fuel': {
      const d = entry.payload.data
      const unit = FUEL_UNITS[d.fuelType]
      return [
        { label: 'Combustible', value: fuelLabel(d) },
        { label: 'Cantidad', value: `${formatNumber(d.quantity)} ${unit}` },
        { label: 'Total', value: formatMoney(d.total) },
        { label: 'Fecha', value: formatDate(d.date) },
        ...(d.km != null ? [{ label: 'Km', value: formatKm(d.km) }] : []),
        ...(d.station ? [{ label: 'Estación', value: d.station }] : []),
      ]
    }
    case 'job': {
      const d = entry.payload.data
      return [
        { label: 'Qué se hizo', value: d.title },
        { label: 'Categoría', value: JOB_CATEGORY_LABELS[d.category] },
        { label: 'Fecha', value: formatDate(d.date) },
        ...(d.km != null ? [{ label: 'Km', value: formatKm(d.km) }] : []),
        { label: 'Costo', value: formatMoney(d.cost) },
        ...(d.workshop ? [{ label: 'Taller', value: d.workshop }] : []),
        ...(d.notes ? [{ label: 'Notas', value: d.notes }] : []),
      ]
    }
    case 'km':
      return [
        { label: 'Km', value: formatKm(entry.payload.data.km) },
        { label: 'Fecha', value: formatDate(entry.payload.data.date) },
      ]
    case 'rule': {
      const d = entry.payload.data
      return [
        { label: 'Nombre', value: d.name },
        ...(d.intervalKm ? [{ label: 'Cada', value: formatKm(d.intervalKm) }] : []),
        ...(d.baseDate ? [{ label: 'Desde', value: formatDate(d.baseDate) }] : []),
      ]
    }
    case 'car': {
      const d = entry.payload.data
      return [
        { label: 'Auto', value: [d.brand, d.model, d.version].filter(Boolean).join(' ') },
        ...(d.year ? [{ label: 'Año', value: String(d.year) }] : []),
        ...(d.plate ? [{ label: 'Patente', value: d.plate }] : []),
        ...(entry.payload.initialKm != null ? [{ label: 'Km', value: formatKm(entry.payload.initialKm) }] : []),
      ]
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v != null && !Array.isArray(v)

/** Si un valor leído de localStorage tiene la forma de una entrada (lo demás se descarta). */
function isEntry(v: unknown): v is OutboxEntry {
  if (!isRecord(v) || !isRecord(v.payload)) return false
  return (
    typeof v.id === 'string' &&
    typeof v.carId === 'string' &&
    typeof v.label === 'string' &&
    typeof v.createdAt === 'number' &&
    (v.state === 'pending' || v.state === 'failed') &&
    KINDS.includes(v.kind as OutboxKind) &&
    typeof v.payload.recordId === 'string' &&
    isRecord(v.payload.data)
  )
}

/** Las entradas guardadas; [] si no hay o el valor no se puede leer. */
export function parseOutbox(raw: string | null | undefined): OutboxEntry[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEntry).map((e): OutboxEntry => ({ ...e, carLabel: typeof e.carLabel === 'string' ? e.carLabel : '' }))
  } catch {
    return []
  }
}

/** Lo que se guarda en localStorage; null (borrar la clave) si no queda nada. */
export const serializeOutbox = (entries: OutboxEntry[]) => (entries.length ? JSON.stringify(entries) : null)

/** Agrega la entrada o, si ya está (un reintento o un borrador que se vuelve a guardar), la reemplaza. */
export function withEntry(entries: OutboxEntry[], entry: OutboxEntry): OutboxEntry[] {
  const fresh: OutboxEntry = { ...entry, state: 'pending' }
  delete fresh.error
  delete fresh.conflict
  return entries.some(e => e.id === entry.id) ? entries.map(e => (e.id === entry.id ? fresh : e)) : [...entries, fresh]
}

/** Sin la entrada: el servidor la confirmó o el usuario la descartó. */
export const withoutEntry = (entries: OutboxEntry[], id: string) => entries.filter(e => e.id !== id)

/**
 * La entrada pasa a `failed` con el motivo y, si `conflict`, marcada como cambiada en otro dispositivo. Si ya no está
 * (se descartó), no la vuelve a agregar.
 */
export function withFailure(entries: OutboxEntry[], id: string, error: string, conflict = false): OutboxEntry[] {
  return entries.map((e): OutboxEntry => {
    if (e.id !== id) return e
    const failed: OutboxEntry = { ...e, state: 'failed', error }
    if (conflict) failed.conflict = true
    else delete failed.conflict
    return failed
  })
}

/** Sin las entradas de hace más de `OUTBOX_DAYS` días. */
export function withoutExpired(entries: OutboxEntry[], now: number): OutboxEntry[] {
  const limit = now - OUTBOX_DAYS * 24 * 60 * 60 * 1000
  return entries.filter(e => e.createdAt > limit)
}

/**
 * Las entradas pendientes que se muestran en el indicador: las que llevan más de `graceMs` esperando. Antes, `settle`
 * todavía espera la confirmación y el formulario sigue abierto: así una escritura con señal no hace parpadear el aviso.
 */
export function visiblePending(entries: OutboxEntry[], now: number, graceMs: number): OutboxEntry[] {
  return entries.filter(e => e.state === 'pending' && now - e.createdAt >= graceMs)
}

/** "1 carga sin sincronizar", "2 trabajos sin sincronizar" o, si son de distinto tipo, "3 cambios sin sincronizar". null si no hay. */
export function outboxSummary(pending: OutboxEntry[]): string | null {
  if (!pending.length) return null
  const kinds = new Set(pending.map(e => e.kind))
  const [one, many] = kinds.size === 1 ? NOUNS[pending[0].kind] : ['cambio', 'cambios']
  return `${pending.length} ${pending.length === 1 ? one : many} sin sincronizar`
}

/** Si la entrada es una edición (tiene `original`) y no un alta. */
export const isEdit = (entry: OutboxEntry) => entry.payload.original != null

/** Ruta del documento que escribe la entrada en Firestore. */
export function outboxDocPath(entry: OutboxEntry): string[] {
  const { carId } = entry
  const id = entry.payload.recordId
  switch (entry.kind) {
    case 'fuel':
      return ['cars', carId, 'fuel', id]
    case 'job':
      return ['cars', carId, 'jobs', id]
    case 'km':
      return ['cars', carId, 'odometer', id]
    case 'rule':
      return ['cars', carId, 'rules', id]
    case 'car':
      return ['cars', id]
  }
}

/** Lo que una edición cambió (los campos de `data` distintos de `original`); null en un alta. */
export function expectedFields(entry: OutboxEntry): Record<string, unknown> | null {
  const original = entry.payload.original as unknown as Record<string, unknown> | null
  const data = entry.payload.data as unknown as Record<string, unknown>
  return original ? changedFields(original, data) : null
}

/**
 * Qué tiene el servidor de la escritura de una entrada: `saved` (la tiene), `not-saved` (no la tiene: se reintenta o
 * se edita, `NOT_SAVED`) o `changed` (otro dispositivo cambió esos campos: sólo se edita, `CHANGED_ELSEWHERE`).
 */
export type ServerCheck = 'saved' | 'not-saved' | 'changed'

/**
 * Qué tiene el servidor de la escritura de la entrada, con el documento como lo devolvió el servidor (null = no
 * existe). Un alta está si el documento existe (su id se generó antes de escribir). Una edición:
 * - `saved` si el documento tiene los valores que la edición cambió (`expectedFields`).
 * - `not-saved` si no existe, o si en los campos que difieren sigue el valor de antes (`original`): reintentar no pisa
 *   nada de otro dispositivo.
 * - `changed` si en alguno de esos campos hay otro valor: otro dispositivo lo cambió después (o se guardó y después lo
 *   cambiaron). Reintentar lo pisaría, así que la entrada queda para que el usuario la edite sobre lo de ahora.
 */
export function checkServer(entry: OutboxEntry, serverData: Record<string, unknown> | null): ServerCheck {
  if (!serverData) return 'not-saved'
  const expected = expectedFields(entry)
  if (!expected) return 'saved'
  const differing = Object.keys(changedFields(serverData, expected))
  if (!differing.length) return 'saved'
  const original = entry.payload.original as unknown as Record<string, unknown>
  const before = Object.fromEntries(differing.map(key => [key, original[key]]))
  return isUnchanged(changedFields(serverData, before)) ? 'not-saved' : 'changed'
}

/**
 * Motivo de una entrada cuya escritura o lectura el servidor denegó (`permission-denied`), en vez del texto genérico de
 * `errorMessage` ("Probá cerrar sesión…"). Un alta que no se puede leer no existe (la regla de lectura mira el
 * documento): `NOT_SAVED`, salvo que su auto ya no esté en la app (`carVisible` false; no cuenta para un auto nuevo,
 * que nunca está). Una edición, o un registro de un auto que ya no está: `NO_ACCESS`.
 */
export function deniedReason(entry: OutboxEntry, carVisible: boolean): string {
  return !isEdit(entry) && (entry.kind === 'car' || carVisible) ? NOT_SAVED : NO_ACCESS
}

/**
 * Los datos con que arranca el formulario de un borrador. Al editar un registro que existe (`record`), el registro
 * como está ahora con lo que la entrada cambió encima (`changedFields(original, data)`): lo que otro dispositivo cambió
 * en otros campos se ve y no se pisa. En un alta, o si el registro ya no existe, los datos de la entrada. Sin
 * borrador, el registro.
 */
export function draftSeed<T extends object>(
  record: NoInfer<T> | undefined,
  draft: { payload: { data: T; original: T | null } } | null | undefined,
): T | undefined {
  if (!draft) return record
  if (record && draft.payload.original) return { ...(record as T), ...changedFields(draft.payload.original, draft.payload.data) }
  return draft.payload.data
}

/**
 * Si el borrador es para esta pantalla: del mismo auto (`carId`; null en el alta de un auto) y, al editar un registro
 * (`recordId`), de ese registro. Así un `?borrador=` armado a mano no aplica sobre un registro los cambios medidos
 * contra otro.
 */
export function draftMatches(entry: OutboxEntry, carId: string | null, recordId: string | null): boolean {
  if (carId != null && entry.carId !== carId) return false
  return recordId == null || entry.payload.recordId === recordId
}

/**
 * Formulario para corregir una entrada, con el borrador (`?borrador=<id>`). Una edición abre el registro si todavía
 * existe (`recordExists`); si no, o si es un alta, el formulario de alta. Los km, siempre la pantalla de km.
 */
export function outboxEditHref(entry: OutboxEntry, recordExists: boolean): string {
  const q = `?borrador=${encodeURIComponent(entry.id)}`
  const id = entry.payload.recordId
  const edit = isEdit(entry) && recordExists
  const base = `/autos/${entry.carId}`
  switch (entry.kind) {
    case 'fuel':
      return `${base}/combustible/${edit ? id : 'nuevo'}${q}`
    case 'job':
      return `${base}/trabajos/${edit ? id : 'nuevo'}${q}`
    case 'rule':
      return `${base}/mantenimientos/${edit ? id : 'nuevo'}${q}`
    case 'km':
      return `${base}/km${q}`
    case 'car':
      return edit ? `${base}/editar${q}` : `/autos/nuevo${q}`
  }
}

/** Las escrituras que `settle` está esperando en esta pestaña: la reconciliación al abrir la app no las toca. */
const waiting = new Set<string>()

/** Marca o desmarca una entrada como esperada por esta pestaña (`settle`). */
export function setWaiting(id: string, on: boolean) {
  if (on) waiting.add(id)
  else waiting.delete(id)
}

/** Si esta pestaña está esperando la confirmación de la entrada. */
export const isWaiting = (id: string) => waiting.has(id)

/** Las entradas de la cuenta en este dispositivo. */
export function readOutbox(uid: string): OutboxEntry[] {
  return parseOutbox(readLocal(outboxKey(uid)))
}

/**
 * Aplica un cambio a la bandeja y la guarda si cambió (las otras pestañas se enteran por el evento `storage`). Leer,
 * cambiar y escribir no es atómico entre pestañas: si dos escriben casi a la vez, gana la última y se pierde el cambio
 * de la otra (puede desaparecer una entrada `failed` o volver una ya confirmada como `pending`, que la reconciliación
 * resuelve al abrir). Se acepta: la ventana es de milisegundos y hace falta guardar en dos pestañas a la vez.
 */
function updateOutbox(uid: string, change: (entries: OutboxEntry[]) => OutboxEntry[]) {
  const before = readOutbox(uid)
  const next = serializeOutbox(change(before))
  if (next !== serializeOutbox(before)) writeLocal(outboxKey(uid), next)
}

/** Registra (o reemplaza) una entrada `pending`. */
export const addOutboxEntry = (uid: string, entry: OutboxEntry) => updateOutbox(uid, es => withEntry(es, entry))

/** Borra una entrada. */
export const removeOutboxEntry = (uid: string, id: string) => updateOutbox(uid, es => withoutEntry(es, id))

/** Pasa una entrada a `failed` con el motivo (y `conflict`, si cambió en otro dispositivo). */
export const failOutboxEntry = (uid: string, id: string, error: string, conflict = false) =>
  updateOutbox(uid, es => withFailure(es, id, error, conflict))

/** Borra las entradas vencidas (`OUTBOX_DAYS`). */
export const pruneOutbox = (uid: string, now = Date.now()) => updateOutbox(uid, es => withoutExpired(es, now))

/** La bandeja de la cuenta, en vivo (también los cambios de otras pestañas), sin las vencidas. */
export function useOutbox(uid: string | null | undefined): OutboxEntry[] {
  const raw = useLocalValue(outboxKey(uid ?? ''))
  return useMemo(() => (uid ? withoutExpired(parseOutbox(raw), Date.now()) : []), [uid, raw])
}
