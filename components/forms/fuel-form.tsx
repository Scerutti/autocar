'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Fuel, Trash2 } from 'lucide-react'
import { CreatedBy, ReadOnlyDetails } from '@/components/activity'
import { useConfirm } from '@/components/confirm-provider'
import { Button } from '@/components/ui/button'
import { FieldGroup, Segmented } from '@/components/ui/choice'
import { Checkbox, Field, FormError, Input } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { toISODate } from '@/lib/dates'
import { deleteFuel, restoreFuel, saveFuel } from '@/lib/db'
import { fuelLabel, resolveFuelAmounts } from '@/lib/fuel'
import { formatDate, formatKm, formatMoney, formatMoneyPrecise, formatNumber, parseNumberInput, toNumberInput } from '@/lib/format'
import { entryKmWarning } from '@/lib/odometer'
import { canEditEntry } from '@/lib/sharing'
import {
  FUEL_GRADE_LABELS,
  FUEL_LABELS,
  FUEL_UNITS,
  isLiquidFuel,
  type Car,
  type FuelGrade,
  type FuelLoad,
  type FuelType,
} from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'

type PriceMode = 'unit' | 'total'

/** Para reconocer la premium en el surtidor. */
const PREMIUM_HINTS: Partial<Record<FuelType, string>> = {
  nafta: 'Premium es la Infinia, V-Power o Quantium.',
  gasoil: 'Premium es el Infinia Diesel, V-Power Diesel o Quantium Diesel.',
}

/** Una carga que no puedo editar porque la cargó otra persona. */
function FuelDetails({ car, load }: { car: Car; load: FuelLoad }) {
  const unit = FUEL_UNITS[load.fuelType]
  return (
    <ReadOnlyDetails
      car={car}
      record={load}
      rows={[
        { label: 'Combustible', value: fuelLabel(load) },
        { label: 'Cantidad', value: `${formatNumber(load.quantity)} ${unit}` },
        { label: `Precio por ${unit}`, value: formatMoneyPrecise(load.unitPrice) },
        { label: 'Total', value: formatMoney(load.total) },
        { label: 'Fecha', value: formatDate(load.date) },
        ...(load.km != null ? [{ label: 'Km', value: formatKm(load.km) }] : []),
        ...(isLiquidFuel(load.fuelType) ? [{ label: 'Tanque lleno', value: load.fullTank ? 'Sí' : 'No' }] : []),
        ...(load.station ? [{ label: 'Estación', value: load.station }] : []),
      ]}
    />
  )
}

/** Alta y edición de una carga de combustible. Si la carga no se puede editar (`canEditEntry`), se muestra en modo solo lectura. */
export function FuelForm({ car, load }: { car: Car; load?: FuelLoad }) {
  const { uid } = useData()
  if (load && !canEditEntry(car, uid, load)) return <FuelDetails car={car} load={load} />
  return <FuelEditor car={car} load={load} />
}

/**
 * Formulario de la carga. Al editar una carga vieja se respeta su combustible aunque el
 * auto haya cambiado. Precio y estación se sugieren desde la carga más reciente de ese combustible (y de esa
 * calidad, si se indica), también al cambiar de combustible o de calidad.
 */
function FuelEditor({ car, load }: { car: Car; load?: FuelLoad }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { actor, today, odometer } = useData()
  const { fuel: carFuel } = useCar(car.id)
  const { saving, error, setError, run } = useSaver()

  const types = load && !car.fuelTypes.includes(load.fuelType) ? [...car.fuelTypes, load.fuelType] : car.fuelTypes
  const liquid = types.find(isLiquidFuel) ?? 'nafta'
  const lastOf = (t: FuelType, g?: FuelGrade | null) => carFuel.find(f => f.fuelType === t && (g == null || f.grade === g))
  const initialType: FuelType = load?.fuelType ?? carFuel.find(f => types.includes(f.fuelType))?.fuelType ?? types[0]
  const initialGrade: FuelGrade = load?.grade ?? lastOf(isLiquidFuel(initialType) ? initialType : liquid)?.grade ?? 'super'
  const initialLast = lastOf(initialType, isLiquidFuel(initialType) ? initialGrade : null)

  const [fuelType, setFuelType] = useState<FuelType>(initialType)
  const [grade, setGrade] = useState<FuelGrade>(initialGrade)
  const [date, setDate] = useState(load?.date ?? toISODate(new Date()))
  const [km, setKm] = useState(load ? (load.km != null ? String(load.km) : '') : String(car.currentKm))
  const [quantity, setQuantity] = useState(load ? toNumberInput(load.quantity) : '')
  const [mode, setMode] = useState<PriceMode>(load ? 'total' : 'unit')
  const [price, setPrice] = useState(load ? toNumberInput(load.total) : initialLast?.unitPrice ? toNumberInput(initialLast.unitPrice) : '')
  const [fullTank, setFullTank] = useState(load?.fullTank ?? true)
  const [station, setStation] = useState(load?.station ?? initialLast?.station ?? '')

  const unit = FUEL_UNITS[fuelType]
  const liquidSelected = isLiquidFuel(fuelType)
  const priceNum = parseNumberInput(price)
  const amounts = resolveFuelAmounts({
    quantity: parseNumberInput(quantity) ?? 0,
    unitPrice: mode === 'unit' ? priceNum : null,
    total: mode === 'total' ? priceNum : null,
  })

  function suggestFrom(t: FuelType, g: FuelGrade | null) {
    if (load) return
    const last = lastOf(t, g)
    if (mode === 'unit') setPrice(last?.unitPrice ? toNumberInput(last.unitPrice) : '')
    if (last?.station) setStation(last.station)
  }

  function changeType(t: FuelType) {
    setFuelType(t)
    suggestFrom(t, isLiquidFuel(t) ? grade : null)
  }

  function changeGrade(g: FuelGrade) {
    setGrade(g)
    suggestFrom(fuelType, g)
  }

  function changeMode(m: PriceMode) {
    if (amounts) setPrice(toNumberInput(m === 'unit' ? amounts.unitPrice : amounts.total))
    setMode(m)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const kmNum = parseNumberInput(km)
    if (!amounts) return setError(`Ingresá la cantidad de ${unit} y el ${mode === 'unit' ? `precio por ${unit}` : 'total pagado'}.`)
    if (kmNum != null && (kmNum < 0 || !Number.isInteger(kmNum))) return setError('Los km no son válidos.')
    if (date > today) return setError('La fecha no puede ser futura.')

    const data = {
      carId: car.id,
      date,
      km: kmNum,
      fuelType,
      grade: liquidSelected ? grade : null,
      ...amounts,
      fullTank: liquidSelected ? fullTank : true,
      station: station.trim() || null,
    }
    const confirmed = await confirm({
      title: load ? '¿Guardar los cambios de la carga?' : '¿Guardar esta carga?',
      description: 'Revisá que los datos estén bien.',
      details: [
        { label: 'Combustible', value: fuelLabel(data) },
        { label: 'Cantidad', value: `${formatNumber(amounts.quantity)} ${unit}` },
        { label: `Precio por ${unit}`, value: formatMoneyPrecise(amounts.unitPrice) },
        { label: 'Total', value: formatMoney(amounts.total) },
        { label: 'Fecha', value: formatDate(date) },
        ...(kmNum != null ? [{ label: 'Km', value: formatKm(kmNum) }] : []),
        ...(liquidSelected ? [{ label: 'Tanque lleno', value: fullTank ? 'Sí' : 'No' }] : []),
        ...(data.station ? [{ label: 'Estación', value: data.station }] : []),
      ],
      warning: entryKmWarning({ date, km: kmNum, isNew: !load }, car),
      confirmLabel: 'Sí, guardar',
      icon: Fuel,
    })
    if (!confirmed) return

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(saveFuel(actor, { car, readings: odometer }, data, load))
    })
    if (!ok) return
    toastSaved(
      load ? 'Carga actualizada' : 'Carga guardada',
      status,
      `${fuelLabel(data)} · ${formatNumber(amounts.quantity)} ${unit} · ${formatMoney(amounts.total)}`,
    )
    router.replace(`/autos/${car.id}?tab=combustible`)
  }

  async function handleDelete() {
    if (!load) return
    const confirmed = await confirm({
      tone: 'danger',
      title: '¿Borrar esta carga?',
      description: `${fuelLabel(load)} · ${formatNumber(load.quantity)} ${FUEL_UNITS[load.fuelType]} · ${formatMoney(load.total)} · ${formatDate(load.date)}.`,
      confirmLabel: 'Sí, borrar',
    })
    if (!confirmed) return
    router.replace(`/autos/${car.id}?tab=combustible`)
    removeWithUndo({
      message: 'Carga borrada',
      remove: () => deleteFuel(actor, { car, readings: odometer }, load),
      restore: () => restoreFuel(actor, { car, readings: odometer }, load),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6" noValidate>
      {load && <CreatedBy record={load} car={car} />}

      {types.length > 1 && (
        <FieldGroup label="¿Qué cargaste?">
          <Segmented value={fuelType} onChange={changeType} options={types.map(t => ({ value: t, label: FUEL_LABELS[t] }))} />
        </FieldGroup>
      )}

      {liquidSelected && (
        <FieldGroup label={`¿Qué ${FUEL_LABELS[fuelType].toLowerCase()}?`} hint={PREMIUM_HINTS[fuelType]}>
          <Segmented
            value={grade}
            onChange={changeGrade}
            options={(['super', 'premium'] as const).map(g => ({ value: g, label: FUEL_GRADE_LABELS[g] }))}
          />
        </FieldGroup>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Fecha">
          <Input type="date" value={date} max={today} onChange={e => setDate(e.target.value)} required />
        </Field>
        <Field label="Km" hint="Sirve para calcular el consumo">
          <Input value={km} onChange={e => setKm(e.target.value)} inputMode="numeric" />
        </Field>
      </div>

      <Field label={`Cantidad (${unit})`}>
        <Input
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          inputMode="decimal"
          placeholder={fuelType === 'gnc' ? '12,5' : '40'}
          className="h-14 text-2xl font-semibold tabular-nums"
          required
        />
      </Field>

      <FieldGroup label="¿Cuánto pagaste?">
        <Segmented
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'unit', label: `Precio por ${unit}` },
            { value: 'total', label: 'Total pagado' },
          ]}
        />
        <Input
          value={price}
          onChange={e => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder={mode === 'unit' ? (fuelType === 'gnc' ? '560' : '1250') : '50000'}
          aria-label={mode === 'unit' ? `Precio por ${unit}` : 'Total pagado'}
          className="h-14 text-2xl font-semibold tabular-nums"
        />
        {amounts && (
          <p className="text-sm text-muted-foreground">
            {mode === 'unit' ? (
              <>
                Total: <span className="font-medium text-foreground">{formatMoney(amounts.total)}</span>
              </>
            ) : (
              <>
                Precio por {unit}: <span className="font-medium text-foreground">{formatMoneyPrecise(amounts.unitPrice)}</span>
              </>
            )}
          </p>
        )}
      </FieldGroup>

      {liquidSelected && (
        <Checkbox
          checked={fullTank}
          onChange={e => setFullTank(e.target.checked)}
          label="Llené el tanque"
          description="Para calcular el consumo se usan las cargas de tanque lleno."
        />
      )}

      <Field label="Estación" hint="Opcional">
        <Input value={station} onChange={e => setStation(e.target.value)} placeholder="YPF Av. Libertador" />
      </Field>

      <FormError>{error}</FormError>

      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => router.back()}>
          Cancelar
        </Button>
        <Button type="submit" disabled={saving} className="h-11 flex-1">
          {saving ? 'Guardando…' : load ? 'Guardar cambios' : 'Guardar carga'}
        </Button>
      </div>

      {load && (
        <Button type="button" variant="ghost" className="w-full gap-1.5 text-destructive hover:text-destructive" onClick={handleDelete} disabled={saving}>
          <Trash2 /> Borrar carga
        </Button>
      )}
    </form>
  )
}
