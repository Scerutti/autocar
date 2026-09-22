'use client'

import { useState } from 'react'
import { ChoiceChips, Segmented } from '@/components/ui/choice'
import { Input } from '@/components/ui/form'
import { formatInterval, unitName } from '@/lib/format'
import type { IntervalUnit, TimeInterval } from '@/lib/types'

const keyOf = (i: TimeInterval) => `${i.amount}-${i.unit}`
const UNITS: IntervalUnit[] = ['day', 'week', 'month', 'year']

/**
 * Elegir un lapso con opciones rápidas ("3 semanas", "6 meses", "1 año") y, si no alcanza,
 * "Otro…" para escribir cualquier cantidad de días, semanas, meses o años.
 */
export function IntervalPicker({
  value,
  onChange,
  presets,
  noneLabel,
  'aria-label': ariaLabel,
}: {
  value: TimeInterval | null
  onChange: (value: TimeInterval | null) => void
  presets: TimeInterval[]
  /** Si se pasa, agrega la opción de no poner plazo (p. ej. "Sólo por km"). */
  noneLabel?: string
  'aria-label'?: string
}) {
  const isPreset = value != null && presets.some(p => keyOf(p) === keyOf(value))
  const [custom, setCustom] = useState(value != null && !isPreset)
  const [amountText, setAmountText] = useState(value && !isPreset ? String(value.amount) : '')

  const selected = custom ? 'custom' : value ? keyOf(value) : noneLabel ? 'none' : null
  const options = [
    ...(noneLabel ? [{ value: 'none', label: noneLabel }] : []),
    ...presets.map(p => ({ value: keyOf(p), label: formatInterval(p) })),
    { value: 'custom', label: 'Otro…' },
  ]

  function pick(key: string) {
    if (key === 'custom') {
      const start = value ?? { amount: 2, unit: 'week' as const }
      setCustom(true)
      setAmountText(String(start.amount))
      onChange(start)
      return
    }
    setCustom(false)
    onChange(key === 'none' ? null : presets.find(p => keyOf(p) === key)!)
  }

  function setAmount(text: string) {
    setAmountText(text)
    const n = Number(text)
    onChange(Number.isInteger(n) && n > 0 ? { amount: n, unit: value?.unit ?? 'week' } : null)
  }

  const unit = value?.unit ?? 'week'
  const amount = Number(amountText) || 2

  return (
    <div className="space-y-3">
      <ChoiceChips value={selected} onChange={pick} options={options} aria-label={ariaLabel} />
      {custom && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-background/30 p-3 sm:flex-row sm:items-center">
          <Input
            value={amountText}
            onChange={e => setAmount(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            aria-label="Cantidad"
            className="h-10 sm:w-24"
            autoFocus
          />
          <Segmented
            value={unit}
            onChange={u => onChange({ amount, unit: u })}
            aria-label="Unidad"
            className="flex-1"
            options={UNITS.map(u => ({ value: u, label: unitName(u, amount) }))}
          />
        </div>
      )}
    </div>
  )
}
