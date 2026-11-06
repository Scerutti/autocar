'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { Loading, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { FuelForm } from '@/components/forms/fuel-form'
import { useDraft } from '@/components/outbox/outbox'
import { useCar, useData } from '@/components/providers/data-provider'
import { canEditEntry } from '@/lib/sharing'

/** Una carga o, con `?borrador=<id>`, su edición de la bandeja que el servidor no guardó. */
function EditFuel() {
  const { carId, fuelId } = useParams<{ carId: string; fuelId: string }>()
  const { uid } = useData()
  const { car, fuel } = useCar(carId)
  const load = fuel.find(f => f.id === fuelId)
  const draft = useDraft('fuel', carId, fuelId)
  if (!car) return <NotFound what="el auto" />
  if (!load) return <NotFound what="la carga" back={`/autos/${car.id}?tab=combustible`} />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title={canEditEntry(car, uid, load) ? 'Editar carga' : 'Carga de combustible'} />
      <PageBody>
        <FuelForm key={`${load.id}-${draft?.id ?? ''}`} car={car} load={load} draft={draft} />
      </PageBody>
    </>
  )
}

export default function EditFuelPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EditFuel />
    </Suspense>
  )
}
