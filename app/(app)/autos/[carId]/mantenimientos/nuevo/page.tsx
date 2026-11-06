'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { EmptyState, LinkButton, Loading, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { OWNER_ONLY_PLAN, RuleForm } from '@/components/forms/rule-form'
import { useDraft } from '@/components/outbox/outbox'
import { useCar, useData } from '@/components/providers/data-provider'
import { isCarOwner } from '@/lib/sharing'

/** Agregar un mantenimiento es sólo del dueño: el plan es suyo. Con `?borrador=<id>`, uno de la bandeja que el servidor no guardó. */
function NewRule() {
  const { carId } = useParams<{ carId: string }>()
  const { uid } = useData()
  const { car } = useCar(carId)
  const draft = useDraft('rule')
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title="Nuevo mantenimiento" />
      <PageBody>
        {isCarOwner(car, uid) ? (
          <RuleForm key={draft?.id} car={car} draft={draft} />
        ) : (
          <EmptyState
            icon={Lock}
            title={OWNER_ONLY_PLAN}
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

export default function NewRulePage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewRule />
    </Suspense>
  )
}
