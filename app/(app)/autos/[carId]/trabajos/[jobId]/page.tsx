'use client'

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { Loading, NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { JobForm } from '@/components/forms/job-form'
import { useDraft } from '@/components/outbox/outbox'
import { useCar, useData } from '@/components/providers/data-provider'
import { canEditJob } from '@/lib/sharing'

/** Un trabajo o, con `?borrador=<id>`, su edición de la bandeja que el servidor no guardó. */
function EditJob() {
  const { carId, jobId } = useParams<{ carId: string; jobId: string }>()
  const { uid } = useData()
  const { car, jobs } = useCar(carId)
  const job = jobs.find(j => j.id === jobId)
  const draft = useDraft('job', carId, jobId)
  if (!car) return <NotFound what="el auto" />
  if (!job) return <NotFound what="el trabajo" back={`/autos/${car.id}?tab=trabajos`} />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title={canEditJob(car, uid, job) ? 'Editar trabajo' : 'Trabajo'} />
      <PageBody>
        <JobForm key={`${job.id}-${draft?.id ?? ''}`} car={car} job={job} draft={draft} />
      </PageBody>
    </>
  )
}

export default function EditJobPage() {
  return (
    <Suspense fallback={<Loading />}>
      <EditJob />
    </Suspense>
  )
}
