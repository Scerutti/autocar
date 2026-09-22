'use client'

import { useParams } from 'next/navigation'
import { NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { FuelForm } from '@/components/forms/fuel-form'
import { useCar } from '@/components/providers/data-provider'

export default function NewFuelPage() {
  const { carId } = useParams<{ carId: string }>()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Carga de combustible" />
      <PageBody>
        <FuelForm car={car} />
      </PageBody>
    </>
  )
}
