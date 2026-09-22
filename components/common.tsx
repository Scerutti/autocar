'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CarFront, MapPinOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import type { RuleStatus } from '@/lib/maintenance'
import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS: Record<RuleStatus, { label: string; className: string }> = {
  ok: { label: 'Al día', className: 'border-success/25 bg-success/10 text-success' },
  soon: { label: 'Próximo', className: 'border-warning/25 bg-warning/10 text-warning' },
  overdue: { label: 'Vencido', className: 'border-destructive/25 bg-destructive/10 text-destructive' },
  unknown: { label: 'Sin datos', className: 'border-white/15 bg-white/5 text-muted-foreground' },
}

export const STATUS_BAR: Record<RuleStatus, string> = {
  ok: 'bg-success',
  soon: 'bg-warning',
  overdue: 'bg-destructive',
  unknown: 'bg-white/30',
}

export const STATUS_TEXT: Record<RuleStatus, string> = {
  ok: 'text-success',
  soon: 'text-warning',
  overdue: 'text-destructive',
  unknown: 'text-muted-foreground',
}

/** Link con aspecto de botón. */
export function LinkButton({
  href,
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </Link>
  )
}

export function StatusBadge({ status, className }: { status: RuleStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS[status].className, className)}>
      {STATUS[status].label}
    </Badge>
  )
}

/** Barra de progreso del intervalo consumido, coloreada por estado. */
export function RuleProgress({ progress, status, className }: { progress: number; status: RuleStatus; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <div className={cn('h-full rounded-full transition-all', STATUS_BAR[status])} style={{ width: `${Math.min(100, progress)}%` }} />
    </div>
  )
}

export const CAR_ACCENTS = [
  // Tonos decorativos por auto; se evitan verde/amarillo/rojo para no confundirlos con los estados.
  'from-primary/20 via-primary/5',
  'from-violet-400/20 via-violet-400/5',
  'from-fuchsia-400/15 via-fuchsia-400/5',
  'from-indigo-400/20 via-indigo-400/5',
  'from-cyan-400/15 via-cyan-400/5',
]

export function carName(car: Pick<Car, 'brand' | 'model'>) {
  return `${car.brand} ${car.model}`.trim()
}

export function carDetail(car: Pick<Car, 'version' | 'year' | 'plate'>) {
  return [car.version, car.year, car.plate].filter(Boolean).join(' · ')
}

export function CarAvatar({ car, className }: { car: Pick<Car, 'photoUrl' | 'brand' | 'model'>; className?: string }) {
  if (car.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cloudinaryUrl(car.photoUrl, 'c_fill,g_auto,w_160,h_160')}
        alt={carName(car)}
        className={cn('size-11 shrink-0 rounded-xl object-cover', className)}
      />
    )
  }
  return (
    <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-foreground', className)}>
      <CarFront className="size-5" />
    </div>
  )
}

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  back,
  leading,
  actions,
}: {
  title: React.ReactNode
  eyebrow?: React.ReactNode
  subtitle?: React.ReactNode
  back?: string | true
  /** Elemento a la izquierda del título cuando no hay botón de volver (p. ej. el logo). */
  leading?: React.ReactNode
  actions?: React.ReactNode
}) {
  const router = useRouter()
  return (
    <header className="flex items-center justify-between gap-3 border-b border-white/8 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 lg:px-10">
      <div className="flex min-w-0 items-center gap-3">
        {back &&
          (typeof back === 'string' ? (
            <Link
              href={back}
              aria-label="Volver"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
          ) : (
            <button
              onClick={() => router.back()}
              aria-label="Volver"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ))}
        {!back && leading}
        <div className="min-w-0">
          {eyebrow && <p className="truncate text-xs font-medium uppercase text-primary">{eyebrow}</p>}
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-7 sm:px-8 lg:px-10', className)}>{children}</div>
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      <Icon className="size-8 text-primary" />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="size-6 animate-spin rounded-full border-2 border-white/15 border-t-primary" />
    </div>
  )
}

/** Para un auto, trabajo, etc. que ya no existe (p. ej. se borró o viene de una notificación vieja). */
export function NotFound({ what, back = '/' }: { what: string; back?: string }) {
  return (
    <PageBody>
      <EmptyState
        icon={MapPinOff}
        title={`No encontramos ${what}`}
        description="Puede que se haya borrado o que el link sea viejo."
        action={
          <LinkButton href={back} variant="outline" size="lg">
            <ArrowLeft /> Volver
          </LinkButton>
        }
      />
    </PageBody>
  )
}
