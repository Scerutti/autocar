'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { EmptyState, LinkButton, Loading, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { CarForm } from '@/components/forms/car-form'
import { useDraft } from '@/components/outbox/outbox'
import { useCar, useData } from '@/components/providers/data-provider'
import { isCarOwner } from '@/lib/sharing'

/**
 * Editar el auto es sólo del dueño: a un miembro que llega con el link se le explica y se lo manda de vuelta. Con
 * `?borrador=<id>`, los cambios de la bandeja que el servidor no guardó.
 */
function EditCar() {
  const { carId } = useParams<{ carId: string }>()
  const { uid } = useData()
  const { car } = useCar(carId)
  const draft = useDraft('car')
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title="Editar auto" />
      <PageBody>
        {isCarOwner(car, uid) ? (
          <CarForm key={draft?.id} car={car} draft={draft} />
        ) : (
          <EmptyState
            icon={Lock}
            title="Solo el dueño puede editar el auto"
            description="Vos podés cargar combustible, km y trabajos."
            action={
              <LinkButton href={`/autos/${car.id}`} variant="outline" size="lg">
                <ArrowLeft /> Volver
              </LinkButton>
            }
          />
        )}
      </PageBody>
    </>
  )
}

export default function EditCarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EditCar />
    </Suspense>
  )
}
