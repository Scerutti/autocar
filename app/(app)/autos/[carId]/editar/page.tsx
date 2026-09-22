'use client'

import { useParams } from 'next/navigation'
import { NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { CarForm } from '@/components/forms/car-form'
import { useCar } from '@/components/providers/data-provider'

export default function EditCarPage() {
  const { carId } = useParams<{ carId: string }>()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title="Editar auto" />
      <PageBody>
        <CarForm car={car} />
      </PageBody>
    </>
  )
}
