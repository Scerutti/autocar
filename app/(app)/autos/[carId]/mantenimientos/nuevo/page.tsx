'use client'

import { useParams } from 'next/navigation'
import { NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { RuleForm } from '@/components/forms/rule-form'
import { useCar } from '@/components/providers/data-provider'

export default function NewRulePage() {
  const { carId } = useParams<{ carId: string }>()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back={`/autos/${car.id}`} eyebrow={carName(car)} title="Nuevo mantenimiento" />
      <PageBody>
        <RuleForm car={car} />
      </PageBody>
    </>
  )
}
