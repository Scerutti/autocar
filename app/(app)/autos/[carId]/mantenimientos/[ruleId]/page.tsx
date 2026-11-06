'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { Loading, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { RuleForm } from '@/components/forms/rule-form'
import { useDraft } from '@/components/outbox/outbox'
import { useCar } from '@/components/providers/data-provider'

/**
 * Un mantenimiento, también uno cumplido (se llega desde un aviso viejo o un link guardado). Con `?borrador=<id>`, su
 * edición de la bandeja que el servidor no guardó.
 */
function EditRule() {
  const { carId, ruleId } = useParams<{ carId: string; ruleId: string }>()
  const { car, allRules } = useCar(carId)
  const rule = allRules.find(r => r.id === ruleId)
  const draft = useDraft('rule')
  if (!car) return <NotFound what="el auto" />
  if (!rule) return <NotFound what="el mantenimiento" back={`/autos/${car.id}`} />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title={rule.name} />
      <PageBody>
        <RuleForm key={`${rule.id}-${draft?.id ?? ''}`} car={car} rule={rule} draft={draft} />
      </PageBody>
    </>
  )
}

export default function EditRulePage() {
  return (
    <Suspense fallback={<Loading />}>
      <EditRule />
    </Suspense>
  )
}
