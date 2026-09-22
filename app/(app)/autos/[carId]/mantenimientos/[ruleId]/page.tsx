'use client'

import { useParams } from 'next/navigation'
import { NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { RuleForm } from '@/components/forms/rule-form'
import { useCar } from '@/components/providers/data-provider'

export default function EditRulePage() {
  const { carId, ruleId } = useParams<{ carId: string; ruleId: string }>()
  const { car, rules } = useCar(carId)
  const rule = rules.find(r => r.rule.id === ruleId)?.rule
  if (!car) return <NotFound what="el auto" />
  if (!rule) return <NotFound what="el mantenimiento" back={`/autos/${car.id}`} />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title={rule.name} />
      <PageBody>
        <RuleForm key={rule.id} car={car} rule={rule} />
      </PageBody>
    </>
  )
}
