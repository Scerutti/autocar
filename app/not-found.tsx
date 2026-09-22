import type { Metadata } from 'next'
import Link from 'next/link'
import { Car, Home } from 'lucide-react'
import { BackButton } from '@/components/back-button'
import { BrandLogo } from '@/components/brand'
import { LinkButton } from '@/components/common'
import { Odometer } from '@/components/odometer'

export const metadata: Metadata = { title: 'Página no encontrada' }

/** Cartel de "calle sin salida" (el de fondo azul con la T blanca y roja). */
function DeadEndSign() {
  return (
    <svg viewBox="0 0 44 96" className="h-24 w-11" aria-hidden>
      <rect x="20" y="36" width="4" height="60" rx="1" fill="#3b4250" />
      <rect x="1" y="1" width="42" height="42" rx="6" fill="#1b5fb8" stroke="#fff" strokeWidth="2" />
      <rect x="18" y="14" width="8" height="24" rx="1" fill="#fff" />
      <rect x="9" y="8" width="26" height="8" rx="1" fill="#e5484d" />
    </svg>
  )
}

/** Ruta con el auto yendo hacia el cartel: las líneas se mueven, el auto "anda". */
function Road() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32">
      <div className="absolute inset-x-0 bottom-0 h-16 border-t border-white/[0.06] bg-gradient-to-b from-[#141922] to-background" />
      <div className="absolute inset-x-0 bottom-[1.875rem] h-1 animate-road bg-[linear-gradient(90deg,rgba(255,255,255,0.28)_0_32px,transparent_32px_64px)] bg-[length:64px_4px] motion-reduce:animate-none" />
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2">
        <Car strokeWidth={1.6} className="size-14 animate-car-bob text-foreground drop-shadow-[0_6px_12px_rgba(26,156,251,0.35)] motion-reduce:animate-none" />
      </div>
      <div className="absolute bottom-12 right-[10%] sm:right-[18%]">
        <DeadEndSign />
      </div>
    </div>
  )
}

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden px-6 pb-40 pt-[max(3rem,env(safe-area-inset-top))] text-center">
      {/* Grilla tipo mapa y brillo azul de fondo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 size-[42rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />

      <Link href="/" aria-label="AutoCar, ir al inicio" className="relative rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {/* lazy: React precarga todo <img> de un Server Component y esta página viaja en el árbol de
            todas las rutas; sin esto el logo se descargaría en cada página aunque no se vea. */}
        <BrandLogo loading="lazy" className="w-32 sm:w-36" />
      </Link>

      <div className="relative my-auto flex flex-col items-center py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Error 404</p>
        <Odometer value={404} className="mt-5" />
        <h1 className="mt-9 text-4xl font-semibold tracking-tight sm:text-5xl">Recalculando…</h1>
        <p className="mt-4 max-w-md text-balance text-muted-foreground sm:text-lg">
          Te fuiste de ruta: esta página no existe o la movimos de lugar.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <LinkButton href="/" size="lg" className="h-11 gap-2 px-5">
            <Home /> Volver al inicio
          </LinkButton>
          <BackButton className="h-11 gap-2 px-5" />
        </div>
      </div>

      <Road />
    </main>
  )
}
