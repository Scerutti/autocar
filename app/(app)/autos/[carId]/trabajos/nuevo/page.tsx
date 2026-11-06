'use client'

import { Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Loading, NotFound, PageBody, PageHeader, ViewerOnly, carName } from '@/components/common'
import { JobForm } from '@/components/forms/job-form'
import { useDraft } from '@/components/outbox/outbox'
import { useCar, useData } from '@/components/providers/data-provider'
import { canWrite } from '@/lib/sharing'

/** Trabajo nuevo (`?regla=` precarga un mantenimiento) o, con `?borrador=<id>`, uno de la bandeja que el servidor no guardó. */
function NewJob() {
  const { carId } = useParams<{ carId: string }>()
  const ruleId = useSearchParams().get('regla')
  const { uid } = useData()
  const { car } = useCar(carId)
  const draft = useDraft('job', carId)
  if (!car) return <NotFound what="el auto" />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Nuevo trabajo" />
      <PageBody>
        {canWrite(car, uid) ? <JobForm key={draft?.id} car={car} preselectedRuleId={ruleId} draft={draft} /> : <ViewerOnly car={car} />}
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
