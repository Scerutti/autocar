'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CarFront, Eye, LoaderCircle, LogOut, MapPinOff } from 'lucide-react'
import type { SignOutPhase } from '@/components/providers/auth-provider'
import { buttonVariants } from '@/components/ui/button'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import type { RuleStatus } from '@/lib/maintenance'
import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<RuleStatus, string> = {
  ok: 'Al día',
  soon: 'Próximo',
  overdue: 'Vencido',
  unknown: 'Sin datos',
}

export const STATUS_BAR: Record<RuleStatus, string> = {
  ok: 'bg-success',
  soon: 'bg-warning',
  overdue: 'bg-destructive',
  unknown: 'bg-muted-foreground/60',
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

/** Testigo de tablero: una luz del color del estado y su nombre, sin caja. */
function Telltale({ dot, text, label, className }: { dot: string; text: string; label: string; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium', text, className)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot)} />
      {label}
    </span>
  )
}

/** Estado de un mantenimiento como testigo de tablero (`STATUS_BAR` / `STATUS_TEXT`). */
export function StatusBadge({ status, className }: { status: RuleStatus; className?: string }) {
  return <Telltale dot={STATUS_BAR[status]} text={STATUS_TEXT[status]} label={STATUS_LABEL[status]} className={className} />
}

/** Etiqueta de un recordatorio de una vez que ya cumplió un trabajo (`completedByJobId`). */
export function CompletedBadge({ className }: { className?: string }) {
  return <Telltale dot="bg-primary" text="text-primary" label="Cumplido" className={className} />
}

/** Barra de progreso del intervalo consumido, coloreada por estado. */
export function RuleProgress({ progress, status, className }: { progress: number; status: RuleStatus; className?: string }) {
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-sm bg-track', className)}>
      <div className={cn('h-full rounded-sm transition-all', STATUS_BAR[status])} style={{ width: `${Math.min(100, progress)}%` }} />
    </div>
  )
}

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
        className={cn('size-11 shrink-0 rounded-md object-cover', className)}
      />
    )
  }
  return (
    <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-3 text-foreground', className)}>
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
    <header className="flex items-center justify-between gap-3 border-b border-line px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 lg:px-10">
      <div className="flex min-w-0 items-center gap-3">
        {back &&
          (typeof back === 'string' ? (
            <Link
              href={back}
              aria-label="Volver"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Link>
          ) : (
            <button
              onClick={() => router.back()}
              aria-label="Volver"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </button>
          ))}
        {!back && leading}
        <div className="min-w-0">
          {eyebrow && <p className="truncate text-sm text-muted-foreground">{eyebrow}</p>}
          <h1 className="mt-0.5 line-clamp-2 break-words font-display text-2xl font-semibold leading-tight tabular-nums sm:line-clamp-1 sm:text-3xl">{title}</h1>
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
    <div className="py-8">
      <div className="flex items-center gap-2.5">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <p className="font-medium">{title}</p>
      </div>
      {description && <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <div aria-hidden className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-primary" />
      {label ? <p className="text-sm text-muted-foreground">{label}</p> : <span className="sr-only">Cargando…</span>}
    </div>
  )
}

/**
 * Texto del botón "Salir": mientras `signOut` espera las escrituras pendientes, un indicador y "Sincronizando…" (el
 * botón va deshabilitado con `signingOut != null`). `icon`: con el ícono de salir.
 */
export function SignOutLabel({ phase, icon = false }: { phase: SignOutPhase; icon?: boolean }) {
  if (phase === 'syncing') {
    return (
      <>
        <LoaderCircle aria-hidden className="animate-spin" /> Sincronizando…
      </>
    )
  }
  return (
    <>
      {icon && <LogOut aria-hidden />} Salir
    </>
  )
}

/** Para un auto, trabajo, etc. que ya no existe (p. ej. se borró o viene de una notificación vieja). */
/**
 * Lo que ve un miembro `viewer` si llega a una pantalla para cargar algo en el auto (por un link viejo): no puede, y
 * vuelve al auto.
 */
export function ViewerOnly({ car }: { car: Pick<Car, 'id'> }) {
  return (
    <EmptyState
      icon={Eye}
      title="En este auto solo podés mirar"
      description="El dueño te dejó ver el auto y su historial, pero no cargar ni cambiar nada."
      action={
        <LinkButton href={`/autos/${car.id}`} variant="outline" size="lg">
          <ArrowLeft /> Volver
        </LinkButton>
      }
    />
  )
}

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
