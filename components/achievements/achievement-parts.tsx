import { cn } from '@/lib/utils'

/** Aro de progreso general: "5 de 23". */
export function ProgressRing({ value, total, className }: { value: number; total: number; className?: string }) {
  const r = 42
  const length = 2 * Math.PI * r
  const fraction = total > 0 ? Math.min(1, value / total) : 0
  return (
    <div className={cn('relative aspect-square shrink-0', className)}>
      <svg viewBox="0 0 100 100" aria-hidden className="size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-white/8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${fraction * length} ${length}`}
          className="text-primary transition-[stroke-dasharray] duration-700 motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        <span className="mt-1 text-[11px] text-muted-foreground">de {total}</span>
      </div>
    </div>
  )
}

/** Barra fina de progreso de un logro. */
export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
    </div>
  )
}
