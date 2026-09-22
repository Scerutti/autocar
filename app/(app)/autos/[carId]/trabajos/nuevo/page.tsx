'use client'

import { Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Loading, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { JobForm } from '@/components/forms/job-form'
import { useCar } from '@/components/providers/data-provider'

function NewJob() {
  const { carId } = useParams<{ carId: string }>()
  const ruleId = useSearchParams().get('regla')
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Nuevo trabajo" />
      <PageBody>
        <JobForm car={car} preselectedRuleId={ruleId} />
      </PageBody>
    </>
  )
}

export default function NewJobPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewJob />
    </Suspense>
  )
}
