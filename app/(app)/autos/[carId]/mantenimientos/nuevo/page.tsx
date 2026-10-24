'use client'

import { useParams } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { EmptyState, LinkButton, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { OWNER_ONLY_PLAN, RuleForm } from '@/components/forms/rule-form'
import { useCar, useData } from '@/components/providers/data-provider'
import { isCarOwner } from '@/lib/sharing'

/** Agregar un mantenimiento es sólo del dueño: el plan es suyo. */
export default function NewRulePage() {
  const { carId } = useParams<{ carId: string }>()
  const { uid } = useData()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title="Nuevo mantenimiento" />
      <PageBody>
        {isCarOwner(car, uid) ? (
          <RuleForm car={car} />
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
