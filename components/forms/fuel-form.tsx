'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Fuel, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/confirm-provider'
import { Button } from '@/components/ui/button'
import { FieldGroup, Segmented } from '@/components/ui/choice'
import { Checkbox, Field, FormError, Input } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { toISODate } from '@/lib/dates'
import { deleteFuel, restoreFuel, saveFuel } from '@/lib/db'
import { fuelLabel, resolveFuelAmounts } from '@/lib/fuel'
import { formatDate, formatKm, formatMoney, formatMoneyPrecise, formatNumber, parseNumberInput } from '@/lib/format'
import { FUEL_LABELS, FUEL_UNITS, NAFTA_GRADE_LABELS, type Car, type FuelLoad, type FuelType, type NaftaGrade } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'

type PriceMode = 'unit' | 'total'

export function FuelForm({ car, load }: { car: Car; load?: FuelLoad }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { uid, today, odometer } = useData()
  const { fuel: carFuel } = useCar(car.id)
  const { saving, error, setError, run } = useSaver()

  const hasGnc = car.fuelTypes.includes('gnc')
  // La carga más reciente de ese combustible (y de esa nafta, si se indica): sugiere precio y estación.
  const lastOf = (t: FuelType, g?: NaftaGrade | null) => carFuel.find(f => f.fuelType === t && (g == null || f.grade === g))
  const initialType: FuelType = load?.fuelType ?? (hasGnc ? (carFuel[0]?.fuelType ?? 'nafta') : 'nafta')
  const initialGrade: NaftaGrade = load?.grade ?? lastOf('nafta')?.grade ?? 'super'
  const initialLast = lastOf(initialType, initialType === 'nafta' ? initialGrade : null)

  const [fuelType, setFuelType] = useState<FuelType>(initialType)
  const [grade, setGrade] = useState<NaftaGrade>(initialGrade)
  const [date, setDate] = useState(load?.date ?? toISODate(new Date()))
  const [km, setKm] = useState(load ? (load.km != null ? String(load.km) : '') : String(car.currentKm))
  const [quantity, setQuantity] = useState(load ? String(load.quantity) : '')
  const [mode, setMode] = useState<PriceMode>(load ? 'total' : 'unit')
  const [price, setPrice] = useState(load ? String(load.total) : initialLast?.unitPrice ? String(initialLast.unitPrice) : '')
  const [fullTank, setFullTank] = useState(load?.fullTank ?? true)
  const [station, setStation] = useState(load?.station ?? initialLast?.station ?? '')

  const unit = FUEL_UNITS[fuelType]
  const priceNum = parseNumberInput(price)
  const amounts = resolveFuelAmounts({
    quantity: parseNumberInput(quantity) ?? 0,
    unitPrice: mode === 'unit' ? priceNum : null,
    total: mode === 'total' ? priceNum : null,
  })

  // Al cambiar de combustible o de nafta, sugerir el último precio que pagaste por esa.
  function suggestFrom(t: FuelType, g: NaftaGrade | null) {
    if (load) return
    const last = lastOf(t, g)
    if (mode === 'unit') setPrice(last?.unitPrice ? String(last.unitPrice) : '')
    if (last?.station) setStation(last.station)
  }

  function changeType(t: FuelType) {
    setFuelType(t)
    suggestFrom(t, t === 'nafta' ? grade : null)
  }

  function changeGrade(g: NaftaGrade) {
    setGrade(g)
    suggestFrom('nafta', g)
  }

  function changeMode(m: PriceMode) {
    // Al cambiar de modo, convertir el valor ya cargado.
    if (amounts) setPrice(String(m === 'unit' ? amounts.unitPrice : amounts.total))
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
      grade: fuelType === 'nafta' ? grade : null,
      ...amounts,
      fullTank: fuelType === 'gnc' ? true : fullTank,
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
        ...(fuelType === 'nafta' ? [{ label: 'Tanque lleno', value: fullTank ? 'Sí' : 'No' }] : []),
        ...(data.station ? [{ label: 'Estación', value: data.station }] : []),
      ],
      confirmLabel: 'Sí, guardar',
      icon: Fuel,
    })
    if (!confirmed) return

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(saveFuel(uid, { car, readings: odometer }, data, load?.id))
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
      remove: () => deleteFuel(uid, load.id),
      restore: () => restoreFuel(uid, load),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6" noValidate>
      {hasGnc && (
        <FieldGroup label="¿Qué cargaste?">
          <Segmented
            value={fuelType}
            onChange={changeType}
            options={(['nafta', 'gnc'] as const).map(t => ({ value: t, label: FUEL_LABELS[t] }))}
          />
        </FieldGroup>
      )}

      {fuelType === 'nafta' && (
        <FieldGroup label="¿Qué nafta?">
          <Segmented
            value={grade}
            onChange={changeGrade}
            options={(['super', 'premium'] as const).map(g => ({ value: g, label: NAFTA_GRADE_LABELS[g] }))}
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

      {fuelType === 'nafta' && (
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
