'use client'

import { Suspense } from 'react'
import { Loading, PageBody, PageHeader } from '@/components/common'
import { CarForm } from '@/components/forms/car-form'
import { useDraft } from '@/components/outbox/outbox'

/** Auto nuevo o, con `?borrador=<id>`, uno de la bandeja que el servidor no guardó. */
function NewCar() {
  const draft = useDraft('car')
  return (
    <>
      <PageHeader back title="Nuevo auto" />
      <PageBody>
        <CarForm key={draft?.id} draft={draft} />
      </PageBody>
    </>
  )
}

export default function NewCarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewCar />
    </Suspense>
  )
}
