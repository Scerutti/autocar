'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { Loading, NotFound, PageBody, PageHeader, ViewerOnly, carName } from '@/components/common'
import { FuelForm } from '@/components/forms/fuel-form'
import { useDraft } from '@/components/outbox/outbox'
import { useCar, useData } from '@/components/providers/data-provider'
import { canWrite } from '@/lib/sharing'

/** Carga nueva o, con `?borrador=<id>`, una de la bandeja que el servidor no guardó. */
function NewFuel() {
  const { carId } = useParams<{ carId: string }>()
  const { uid } = useData()
  const { car } = useCar(carId)
  const draft = useDraft('fuel', carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Carga de combustible" />
      <PageBody>
        {canWrite(car, uid) ? <FuelForm key={draft?.id} car={car} draft={draft} /> : <ViewerOnly car={car} />}
      </PageBody>
    </>
  )
}

export default function NewFuelPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewFuel />
    </Suspense>
  )
}
