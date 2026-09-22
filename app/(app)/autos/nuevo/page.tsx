'use client'

import { PageBody, PageHeader } from '@/components/common'
import { CarForm } from '@/components/forms/car-form'

export default function NewCarPage() {
  return (
    <>
      <PageHeader back title="Nuevo auto" />
      <PageBody>
        <CarForm />
      </PageBody>
    </>
  )
}
