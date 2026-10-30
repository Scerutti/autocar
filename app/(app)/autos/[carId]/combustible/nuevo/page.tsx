'use client'

import { useParams } from 'next/navigation'
import { NotFound, PageBody, PageHeader, ViewerOnly, carName } from '@/components/common'
import { FuelForm } from '@/components/forms/fuel-form'
import { useCar, useData } from '@/components/providers/data-provider'
import { canWrite } from '@/lib/sharing'

export default function NewFuelPage() {
  const { carId } = useParams<{ carId: string }>()
  const { uid } = useData()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Carga de combustible" />
      <PageBody>
        {canWrite(car, uid) ? <FuelForm car={car} /> : <ViewerOnly car={car} />}
      </PageBody>
    </>
  )
}
