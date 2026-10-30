'use client'

import { useParams, useRouter } from 'next/navigation'
import { NotFound, PageBody, PageHeader, ViewerOnly, carName } from '@/components/common'
import { KmForm } from '@/components/km-form'
import { useCar, useData } from '@/components/providers/data-provider'
import { canWrite } from '@/lib/sharing'

/** Pantalla a la que lleva el recordatorio semanal: un solo campo y listo. Un `viewer` no carga km (`ViewerOnly`). */
export default function KmPage() {
  const { carId } = useParams<{ carId: string }>()
  const router = useRouter()
  const { uid } = useData()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title="Cargar km" />
      <PageBody>
        {canWrite(car, uid) ? (
          <div className="mx-auto max-w-md rounded-2xl border border-white/8 bg-card/60 p-5">
            <KmForm car={car} autoFocus onDone={() => router.replace(`/autos/${car.id}`)} onCancel={() => router.back()} />
          </div>
        ) : (
          <ViewerOnly car={car} />
        )}
      </PageBody>
    </>
  )
}
