'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormError } from '@/components/ui/form'
import { useData } from '@/components/providers/data-provider'
import { recordKm } from '@/lib/db'
import { formatKm, parseNumberInput, timeAgo } from '@/lib/format'
import { rulesWithState, summarizeRule } from '@/lib/maintenance'
import { validateKmReading } from '@/lib/odometer'
import type { Car } from '@/lib/types'
import { settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { carName } from './common'

export function KmForm({
  car,
  onDone,
  onCancel,
  inputRef,
  autoFocus,
}: {
  car: Car
  onDone: () => void
  onCancel?: () => void
  inputRef?: React.Ref<HTMLInputElement>
  autoFocus?: boolean
}) {
  const { uid, odometer, rules, today } = useData()
  const [value, setValue] = useState('')
  const [warning, setWarning] = useState<string | null>(null)
  const { saving, error, setError, run } = useSaver()

  const hintId = useId()
  const km = parseNumberInput(value)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (km == null) return setError('Ingresá los km que marca el tablero.')
    const v = validateKmReading(km, car.currentKm)
    if (!v.ok) return setError(v.error)
    if (v.warning && !warning) return setWarning(v.warning)

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(recordKm(uid, car, odometer, km))
    })
    if (!ok) return
    // Lo que importa al cargar km: cuánto falta para el próximo mantenimiento.
    const next = rulesWithState(rules.filter(r => r.carId === car.id), { ...car, currentKm: km }, today)[0]
    toastSaved(`${formatKm(km)} guardados`, status, next ? summarizeRule(next.rule.name, next.state) : carName(car))
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Kilómetros actuales
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          placeholder={String(car.currentKm)}
          value={value}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={hintId}
          onChange={e => {
            setValue(e.target.value)
            setWarning(null)
            setError(null)
          }}
          className="h-14 rounded-xl border border-white/10 bg-background px-4 text-2xl font-semibold tabular-nums outline-none transition placeholder:text-white/20 focus:border-ring focus:ring-2 focus:ring-ring/40 aria-invalid:border-destructive"
        />
      </label>
      <p id={hintId} className="text-sm text-muted-foreground">
        {km != null && km > car.currentKm && !error ? (
          <>+{formatKm(km - car.currentKm)} desde el último registro</>
        ) : (
          <>
            Último registro: {formatKm(car.currentKm)}
            {car.kmUpdatedAt && ` (${timeAgo(car.kmUpdatedAt)})`}
          </>
        )}
      </p>
      <FormError>{error}</FormError>
      {warning && (
        <p role="alert" className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-warning">
          {warning}
        </p>
      )}
      <div className="flex gap-3">
        {onCancel && (
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" disabled={saving} className="h-11 flex-1">
          {warning ? 'Sí, guardar' : saving ? 'Guardando…' : 'Guardar km'}
        </Button>
      </div>
    </form>
  )
}

/** Diálogo para cargar km sin salir de la pantalla. `car = null` lo cierra. */
export function KmDialog({ car, onClose }: { car: Car | null; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Conserva el último auto mientras corre la animación de cierre.
  const [shown, setShown] = useState(car)
  if (car && car !== shown) setShown(car)

  return (
    <Dialog open={Boolean(car)} onOpenChange={open => !open && onClose()}>
      <DialogContent initialFocus={inputRef}>
        {shown && (
          <>
            <DialogHeader>
              <DialogTitle>Cargar kilometraje</DialogTitle>
              <DialogDescription>{carName(shown)}</DialogDescription>
            </DialogHeader>
            <KmForm key={shown.id} car={shown} inputRef={inputRef} onDone={onClose} onCancel={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
