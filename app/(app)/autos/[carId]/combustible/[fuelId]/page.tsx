'use client'

import { useParams } from 'next/navigation'
import { NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { FuelForm } from '@/components/forms/fuel-form'
import { useCar } from '@/components/providers/data-provider'

export default function EditFuelPage() {
  const { carId, fuelId } = useParams<{ carId: string; fuelId: string }>()
  const { car, fuel } = useCar(carId)
  const load = fuel.find(f => f.id === fuelId)
  if (!car) return <NotFound what="el auto" />
  if (!load) return <NotFound what="la carga" back={`/autos/${car.id}?tab=combustible`} />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Editar carga" />
      <PageBody>
        <FuelForm key={load.id} car={car} load={load} />
      </PageBody>
    </>
  )
}
