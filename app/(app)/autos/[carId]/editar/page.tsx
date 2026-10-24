'use client'

import { useParams } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { EmptyState, LinkButton, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { CarForm } from '@/components/forms/car-form'
import { useCar, useData } from '@/components/providers/data-provider'
import { isCarOwner } from '@/lib/sharing'

/** Editar el auto es sólo del dueño: a un miembro que llega con el link se le explica y se lo manda de vuelta. */
export default function EditCarPage() {
  const { carId } = useParams<{ carId: string }>()
  const { uid } = useData()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title="Editar auto" />
      <PageBody>
        {isCarOwner(car, uid) ? (
          <CarForm car={car} />
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
