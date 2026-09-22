'use client'

import { useParams } from 'next/navigation'
import { NotFound, PageBody, PageHeader, carName } from '@/components/common'
import { JobForm } from '@/components/forms/job-form'
import { useCar } from '@/components/providers/data-provider'

export default function EditJobPage() {
  const { carId, jobId } = useParams<{ carId: string; jobId: string }>()
  const { car, jobs } = useCar(carId)
  const job = jobs.find(j => j.id === jobId)
  if (!car) return <NotFound what="el auto" />
  if (!job) return <NotFound what="el trabajo" back={`/autos/${car.id}?tab=trabajos`} />
  return (
    <>
      <PageHeader back eyebrow={carName(car)} title="Editar trabajo" />
      <PageBody>
        <JobForm key={job.id} car={car} job={job} />
      </PageBody>
    </>
  )
}
