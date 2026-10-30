'use client'

import { Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Loading, NotFound, PageBody, PageHeader, ViewerOnly, carName } from '@/components/common'
import { JobForm } from '@/components/forms/job-form'
import { useCar, useData } from '@/components/providers/data-provider'
import { canWrite } from '@/lib/sharing'

function NewJob() {
  const { carId } = useParams<{ carId: string }>()
  const ruleId = useSearchParams().get('regla')
  const { uid } = useData()
  const { car } = useCar(carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Nuevo trabajo" />
      <PageBody>
        {canWrite(car, uid) ? <JobForm car={car} preselectedRuleId={ruleId} /> : <ViewerOnly car={car} />}
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
