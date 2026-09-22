'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Vuelve a la página anterior; si se entró directo por un link, va al inicio. */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter()
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className={className}
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
    >
      <ArrowLeft /> Volver atrás
    </Button>
  )
}
