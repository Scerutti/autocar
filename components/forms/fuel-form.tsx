'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, FormError, Input, Segmented } from '@/components/ui/form'
import { useCar, useData } from '@/components/providers/data-provider'
import { toISODate } from '@/lib/dates'
import { deleteFuel, restoreFuel, saveFuel } from '@/lib/db'
import { resolveFuelAmounts } from '@/lib/fuel'
import { formatMoney, formatMoneyPrecise, formatNumber, parseNumberInput } from '@/lib/format'
import { FUEL_LABELS, FUEL_UNITS, type Car, type FuelLoad, type FuelType } from '@/lib/types'
import { removeWithUndo, settle, toastSaved, useSaver, type SaveStatus } from '@/lib/use-saver'

type PriceMode = 'unit' | 'total'

export function FuelForm({ car, load }: { car: Car; load?: FuelLoad }) {
  const router = useRouter()
  const { uid, today, odometer } = useData()
  const { fuel: carFuel } = useCar(car.id)
  const { saving, error, setError, run } = useSaver()

  const lastOf = (t: FuelType) => carFuel.find(f => f.fuelType === t)
  const initialType = load?.fuelType ?? carFuel[0]?.fuelType ?? car.fuelTypes[0]
  const [fuelType, setFuelType] = useState<FuelType>(initialType)
  const [date, setDate] = useState(load?.date ?? toISODate(new Date()))
  const [km, setKm] = useState(load ? (load.km != null ? String(load.km) : '') : String(car.currentKm))
  const [quantity, setQuantity] = useState(load ? String(load.quantity) : '')
  const [mode, setMode] = useState<PriceMode>(load ? 'total' : 'unit')
  const [price, setPrice] = useState(
    load ? String(load.total) : lastOf(initialType)?.unitPrice ? String(lastOf(initialType)!.unitPrice) : '',
  )
  const [fullTank, setFullTank] = useState(load?.fullTank ?? true)
  const [station, setStation] = useState(load?.station ?? lastOf(initialType)?.station ?? '')

  const unit = FUEL_UNITS[fuelType]
  const priceNum = parseNumberInput(price)
  const amounts = resolveFuelAmounts({
    quantity: parseNumberInput(quantity) ?? 0,
    unitPrice: mode === 'unit' ? priceNum : null,
    total: mode === 'total' ? priceNum : null,
  })

  function changeType(t: FuelType) {
    setFuelType(t)
    // Sugerir el último precio conocido de ese combustible.
    const last = lastOf(t)
    if (!load && mode === 'unit') setPrice(last?.unitPrice ? String(last.unitPrice) : '')
    if (!load && last?.station) setStation(last.station)
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

    let status: SaveStatus = 'saved'
    const ok = await run(async () => {
      status = await settle(
        saveFuel(
          uid,
          { car, readings: odometer },
          {
            carId: car.id,
            date,
            km: kmNum,
            fuelType,
            ...amounts,
            fullTank: fuelType === 'gnc' ? true : fullTank,
            station: station.trim() || null,
          },
          load?.id,
        ),
      )
    })
    if (!ok) return
    toastSaved(
      load ? 'Carga actualizada' : 'Carga guardada',
      status,
      `${FUEL_LABELS[fuelType]} · ${formatNumber(amounts.quantity)} ${unit} · ${formatMoney(amounts.total)}`,
    )
    router.replace(`/autos/${car.id}?tab=combustible`)
  }

  function handleDelete() {
    if (!load) return
    router.replace(`/autos/${car.id}?tab=combustible`)
    removeWithUndo({
      message: 'Carga borrada',
      remove: () => deleteFuel(uid, load.id),
      restore: () => restoreFuel(uid, load),
    })
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6">
      {car.fuelTypes.length > 1 && (
        <Field label="Combustible">
          <Segmented
            value={fuelType}
            onChange={changeType}
            options={car.fuelTypes.map(t => ({ value: t, label: FUEL_LABELS[t] }))}
          />
        </Field>
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

      <div className="space-y-3">
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
      </div>

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
