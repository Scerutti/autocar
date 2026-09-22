'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Gauge, Pencil, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormError } from '@/components/ui/form'
import { useData } from '@/components/providers/data-provider'
import { recordKm } from '@/lib/db'
import { formatKm, formatNumber, parseNumberInput, timeAgo } from '@/lib/format'
import { rulesWithState, summarizeRule } from '@/lib/maintenance'
import { validateKmReading } from '@/lib/odometer'
import type { Car } from '@/lib/types'
import { settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'
import { carName } from './common'

/**
 * Carga de km en dos pasos: escribir y confirmar. La confirmación muestra el número grande y la
 * diferencia con el último registro, para frenar errores de tipeo (un cero de más o de menos).
 * Va dentro del mismo formulario (no un diálogo encima de otro).
 */
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
  inputRef?: React.RefObject<HTMLInputElement | null>
  autoFocus?: boolean
}) {
  const { uid, odometer, rules, today } = useData()
  const [value, setValue] = useState('')
  const [step, setStep] = useState<'enter' | 'confirm'>('enter')
  const [warning, setWarning] = useState<string | null>(null)
  const { saving, error, setError, run } = useSaver()
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const ownInputRef = useRef<HTMLInputElement>(null)
  const input = inputRef ?? ownInputRef

  const hintId = useId()
  const km = parseNumberInput(value)

  useEffect(() => {
    if (step === 'confirm') confirmButtonRef.current?.focus()
    else if (!autoFocus) input.current?.focus()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  function review(e: React.FormEvent) {
    e.preventDefault()
    if (km == null) return setError('Ingresá los km que marca el tablero.')
    const v = validateKmReading(km, car.currentKm)
    if (!v.ok) return setError(v.error)
    setWarning(v.warning ?? null)
    setStep('confirm')
  }

  async function save() {
    if (km == null) return
    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(recordKm(uid, car, odometer, km))
    })
    if (!ok) return setStep('enter')
    // Lo que importa al cargar km: cuánto falta para el próximo mantenimiento.
    const next = rulesWithState(rules.filter(r => r.carId === car.id), { ...car, currentKm: km }, today)[0]
    toastSaved(`${formatKm(km)} guardados`, status, next ? summarizeRule(next.rule.name, next.state) : carName(car))
    onDone()
  }

  if (step === 'confirm' && km != null) {
    const diff = km - car.currentKm
    return (
      <div className="space-y-4" role="group" aria-label="Confirmar kilómetros">
        <p className="text-sm font-medium">¿Estos son los km que marca el tablero?</p>
        <div className="rounded-2xl border border-primary/30 bg-primary/10 px-4 py-5 text-center">
          <p className="text-4xl font-bold tabular-nums tracking-tight">
            {formatNumber(km)} <span className="text-lg font-medium text-muted-foreground">km</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {diff === 0 ? 'Igual que el último registro' : `+${formatKm(diff)} desde el último registro`}
          </p>
        </div>
        {warning && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{warning} Fijate que no te sobre un cero.</span>
          </p>
        )}
        <FormError>{error}</FormError>
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1 gap-2" onClick={() => setStep('enter')} disabled={saving}>
            <Pencil /> Corregir
          </Button>
          <Button ref={confirmButtonRef} type="button" className="h-11 flex-1 gap-2" onClick={save} disabled={saving}>
            <Gauge /> {saving ? 'Guardando…' : 'Sí, guardar'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={review} className="space-y-4" noValidate>
      <label className="flex flex-col gap-2 text-sm font-medium">
        Kilómetros actuales
        <input
          ref={input}
          autoFocus={autoFocus}
          inputMode="numeric"
          enterKeyHint="next"
          autoComplete="off"
          placeholder={String(car.currentKm)}
          value={value}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={hintId}
          onChange={e => {
            setValue(e.target.value)
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
      <div className="flex gap-3">
        {onCancel && (
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" className="h-11 flex-1">
          Continuar
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
