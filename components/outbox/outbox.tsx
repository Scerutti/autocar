'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CircleAlert, CloudOff, Pencil, RotateCw, Trash2 } from 'lucide-react'
import { LinkButton, carName } from '@/components/common'
import { useConfirm } from '@/components/confirm-provider'
import { useAuth } from '@/components/providers/auth-provider'
import { useData } from '@/components/providers/data-provider'
import { Button } from '@/components/ui/button'
import { createCar, recordKm, saveFuel, saveJob, saveRule, serverDocData, updateCar, waitForServerWrites } from '@/lib/db'
import { validateKmReading } from '@/lib/odometer'
import {
  CHANGED_ELSEWHERE,
  NOT_SAVED,
  NO_ACCESS,
  checkServer,
  deniedReason,
  draftMatches,
  failOutboxEntry,
  isWaiting,
  outboxDetails,
  outboxDocPath,
  outboxEditHref,
  outboxSummary,
  pruneOutbox,
  readOutbox,
  removeOutboxEntry,
  useOutbox,
  visiblePending,
  type OutboxEntry,
  type OutboxEntryOf,
  type OutboxKind,
} from '@/lib/outbox'
import type { PendingItem } from '@/lib/pending'
import { toast } from '@/lib/toast'
import { OFFLINE_GRACE_MS, outboxFailure, settle, toastSaved } from '@/lib/use-saver'
import { changedFields, cn, isUnchanged } from '@/lib/utils'

/** Lo que dice un reintento de una edición cuyo registro ya no existe. */
const GONE = 'Ese registro se borró en otro dispositivo. Tocá Editar para cargarlo de nuevo.'

/**
 * Lo que se hace con una entrada de la bandeja desde la campanita:
 * - `retry`: vuelve a llamar la función de `lib/db.ts` con el `payload` y lo que la app tiene ahora (el auto, sus
 *   lecturas, mantenimientos y trabajos, de `useData`), no con lo que había al guardar. Una edición se mide contra el
 *   `original` de la entrada sobre el registro actual, así no pisa lo que otro dispositivo cambió en otros campos; la
 *   del auto escribe sólo lo que cambió (`changedFields(original, data)`; nada = "Sin cambios"). Pasa por `settle` con
 *   la misma entrada: si el servidor confirma se borra; si rechaza queda `failed` con el motivo nuevo. No se ofrece en
 *   una entrada `conflict` (pisaría lo del otro dispositivo).
 * - `editHref`: el formulario con el borrador (`outboxEditHref`); null si el auto ya no está (no hay dónde guardarlo).
 * - `discard`: la borra, con confirmación.
 * Un cambio sólo de la foto del auto no queda en la bandeja: la foto no viaja en la entrada (si el servidor rechaza el
 * guardado, la foto nueva se borra de Cloudinary), así que al reconciliar no hay campos que comparar y cuenta como
 * guardado.
 */
export function useOutboxActions() {
  const confirm = useConfirm()
  const { actor, uid, carById, fuel, jobs, rules, odometer } = useData()

  function recordExists(entry: OutboxEntry) {
    const id = entry.payload.recordId
    switch (entry.kind) {
      case 'fuel':
        return fuel.some(f => f.id === id)
      case 'job':
        return jobs.some(j => j.id === id)
      case 'rule':
        return rules.some(r => r.id === id)
      case 'car':
        return carById.has(id)
      case 'km':
        return false
    }
  }

  function write(entry: OutboxEntry): Promise<unknown> {
    if (entry.kind === 'car') {
      const { recordId, data, original, initialKm } = entry.payload
      if (original) {
        const changes = changedFields(original, data)
        return isUnchanged(changes) ? Promise.resolve('unchanged' as const) : updateCar(actor, recordId, changes)
      }
      if (initialKm == null) throw new Error('Faltan los km del auto. Tocá Editar para cargarlos.')
      return createCar(actor, data, initialKm, recordId)
    }
    const car = carById.get(entry.carId)
    if (!car) throw new Error(NO_ACCESS)
    const readings = odometer.filter(r => r.carId === car.id)
    const carJobs = jobs.filter(j => j.carId === car.id)
    switch (entry.kind) {
      case 'fuel': {
        const { recordId, data, original } = entry.payload
        const current = fuel.find(f => f.id === recordId)
        if (original && !current) throw new Error(GONE)
        return saveFuel(actor, { car, readings: odometer }, data, original && current ? { ...current, ...original } : undefined, recordId)
      }
      case 'job': {
        const { recordId, data, original, followUp } = entry.payload
        const current = jobs.find(j => j.id === recordId)
        if (original && !current) throw new Error(GONE)
        const ctx = { car, rules: rules.filter(r => r.carId === car.id), jobs: carJobs, readings: odometer }
        return saveJob(actor, ctx, data, original && current ? { ...current, ...original } : undefined, original ? null : followUp, recordId)
      }
      case 'rule': {
        const { recordId, data, original } = entry.payload
        const current = rules.find(r => r.id === recordId)
        if (original && !current) throw new Error(GONE)
        return saveRule(actor, { jobs: carJobs, readings }, data, original && current ? { ...current, ...original } : undefined, recordId)
      }
      case 'km': {
        const { recordId, data } = entry.payload
        const check = validateKmReading(data.km, data.date, readings.filter(r => r.id !== recordId))
        if (!check.ok) throw new Error(`${check.error} Tocá Editar para corregirlo.`)
        return recordKm(actor, car, odometer, data.km, data.date, recordId)
      }
    }
  }

  async function retry(entry: OutboxEntry) {
    try {
      const p = Promise.resolve().then(() => write(entry))
      const status = await settle(p, { uid, entry: { ...entry, createdAt: Date.now() } })
      toastSaved('Guardado', status, entry.label)
    } catch (e) {
      toast.error('No se pudo guardar', { description: outboxFailure(entry, e) })
    }
  }

  async function discard(entry: OutboxEntry) {
    const confirmed = await confirm({
      tone: 'danger',
      title: '¿Descartar lo que no se guardó?',
      description: `${entry.label}. Se pierde lo que cargaste y no se puede recuperar.`,
      confirmLabel: 'Sí, descartar',
    })
    if (confirmed) removeOutboxEntry(uid, entry.id)
  }

  function editHref(entry: OutboxEntry) {
    if (entry.kind !== 'car' && !carById.has(entry.carId)) return null
    return outboxEditHref(entry, recordExists(entry))
  }

  return { retry, discard, editHref }
}

/**
 * El borrador que pide la página (`?borrador=<id>`) si es de este tipo, está en la bandeja de la cuenta y es de esta
 * pantalla (`draftMatches`: del auto `carId`, null en el alta de un auto, y del registro `recordId` al editar); null si
 * no. Se lee una vez por id: lo que el formulario guarda después no lo cambia mientras está abierto. Va dentro de un
 * `Suspense` (usa `useSearchParams`).
 */
export function useDraft<K extends OutboxKind>(kind: K, carId: string | null, recordId: string | null = null): OutboxEntryOf<K> | null {
  const id = useSearchParams().get('borrador')
  const { uid } = useData()
  return useMemo(() => {
    if (!id) return null
    const entry = readOutbox(uid).find((e): e is OutboxEntryOf<K> => e.id === id && e.kind === kind)
    return entry && draftMatches(entry, carId, recordId) ? entry : null
  }, [id, uid, kind, carId, recordId])
}

/**
 * Texto del aviso "1 carga sin sincronizar" (null si no hay que mostrarlo): las escrituras que esperan al servidor hace
 * más de `OFFLINE_GRACE_MS` (`visiblePending`; antes el formulario todavía está esperando y no hace falta avisar). Se
 * actualiza solo cuando una entrada cumple ese tiempo, y entre pestañas por el evento `storage`.
 */
export function useOutboxStatus(): string | null {
  const { user } = useAuth()
  const entries = useOutbox(user?.uid)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const young = entries.filter(e => e.state === 'pending' && now - e.createdAt < OFFLINE_GRACE_MS)
    if (!young.length) return
    const wait = Math.max(0, Math.min(...young.map(e => e.createdAt + OFFLINE_GRACE_MS - Date.now())))
    const timer = setTimeout(() => setNow(Date.now()), wait + 50)
    return () => clearTimeout(timer)
  }, [entries, now])

  return outboxSummary(visiblePending(entries, now, OFFLINE_GRACE_MS))
}

/**
 * El aviso "1 carga sin sincronizar" (`useOutboxStatus`). No flota: `AppShell` lo pone en la barra de navegación (arriba
 * de los íconos, en el celular) o en la barra lateral (escritorio), así nunca tapa el contenido de la página.
 */
export function OutboxIndicator({ text, className }: { text: string; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        'flex w-fit items-center gap-2 rounded-full border border-warning/25 bg-background/95 px-3.5 py-1.5 text-xs font-medium text-warning',
        className,
      )}
    >
      <CloudOff aria-hidden className="size-3.5 shrink-0" /> {text}
    </p>
  )
}

/**
 * Resuelve las entradas que quedaron `pending` de una sesión anterior (la app se cerró antes de que el servidor
 * contestara, así que no hay promesa que esperar). Firestore vuelve a mandar esas escrituras desde su caché al abrir:
 * cuando el servidor confirmó todas (`waitForServerWrites`, que sin conexión espera a que vuelva), lee cada documento en
 * el servidor (`serverDocData`) y según `checkServer`:
 * - `saved`: borra la entrada.
 * - `not-saved`: la pasa a `failed` con `NOT_SAVED` (Reintentar, Editar, Descartar).
 * - `changed`: la pasa a `failed` con `CHANGED_ELSEWHERE` y `conflict` (sólo Editar y Descartar).
 * Sin permiso para leerlo, `failed` con `deniedReason` (un alta que nunca llegó al servidor, `NOT_SAVED`; una edición o
 * un auto que ya no está en la app, `NO_ACCESS`); sin conexión, la deja como está. Sólo mira las que estaban
 * pendientes al abrir y que esta pestaña no espera (`isWaiting`). Al abrir también borra las vencidas (`pruneOutbox`).
 */
export function OutboxSync() {
  const { uid, carById } = useData()
  const cars = useRef(carById)

  useEffect(() => {
    cars.current = carById
  }, [carById])

  useEffect(() => {
    pruneOutbox(uid)
    const stale = readOutbox(uid)
      .filter(e => e.state === 'pending' && !isWaiting(e.id))
      .map(e => e.id)
    if (!stale.length) return
    let active = true
    waitForServerWrites().then(
      async () => {
        for (const id of stale) {
          const entry = readOutbox(uid).find(e => e.id === id)
          if (!active || !entry || entry.state !== 'pending' || isWaiting(id)) continue
          try {
            const check = checkServer(entry, await serverDocData(outboxDocPath(entry)))
            if (check === 'saved') removeOutboxEntry(uid, id)
            else if (check === 'changed') failOutboxEntry(uid, id, CHANGED_ELSEWHERE, true)
            else failOutboxEntry(uid, id, NOT_SAVED)
          } catch (e) {
            if ((e as { code?: string }).code === 'permission-denied') {
              failOutboxEntry(uid, id, deniedReason(entry, cars.current.has(entry.carId)))
            }
          }
        }
      },
      () => {},
    )
    return () => {
      active = false
    }
  }, [uid])

  return null
}

/**
 * Algo que el servidor no guardó, en la campanita: qué era, el motivo, sus datos ("Ver datos") y Reintentar, Editar y
 * Descartar. Si el auto ya no está, no hay Reintentar ni Editar: quedan los datos para no perderlos, y Descartar. Si
 * cambió en otro dispositivo (`conflict`), no hay Reintentar: Editar abre el registro como está ahora con los cambios
 * de la entrada encima (`draftSeed`). Descartar cierra la campanita antes de confirmar, como Aprobar y Rechazar.
 */
export function FailedWriteRow({ item, onNavigate }: { item: Extract<PendingItem, { kind: 'failed-write' }>; onNavigate: () => void }) {
  const { entry, car } = item
  const { retry, discard, editHref } = useOutboxActions()
  const [busy, setBusy] = useState(false)
  const href = editHref(entry)
  const where = car ? carName(car) : entry.carLabel

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
          <CircleAlert className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">No se pudo guardar: {entry.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[where, entry.error ?? NOT_SAVED].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <details className="mt-2 pl-12">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver datos</summary>
        <dl className="mt-2 space-y-1 text-xs">
          {outboxDetails(entry).map(row => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="mt-2.5 flex flex-wrap gap-2 pl-12">
        {href && !entry.conflict && (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await retry(entry)
              setBusy(false)
            }}
          >
            <RotateCw /> {busy ? 'Guardando…' : 'Reintentar'}
          </Button>
        )}
        {href && (
          <LinkButton href={href} onClick={onNavigate} size="sm" variant="outline" className="gap-1.5">
            <Pencil /> Editar
          </LinkButton>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => {
            onNavigate()
            void discard(entry)
          }}
        >
          <Trash2 /> Descartar
        </Button>
      </div>
    </div>
  )
}
