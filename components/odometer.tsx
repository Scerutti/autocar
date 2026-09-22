import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

// Dos vueltas de dígitos: cada tambor gira una vuelta completa antes de frenar en su número.
const STRIP = Array.from({ length: 20 }, (_, i) => i % 10)

/**
 * Cuentakilómetros con tambores que giran hasta el valor (animación CSS pura, sin JS).
 * Con "reducir movimiento" muestra el valor directamente.
 */
export function Odometer({
  value,
  digits = 6,
  unit = 'km',
  className,
}: {
  value: number
  digits?: number
  unit?: string
  className?: string
}) {
  const chars = String(value).padStart(digits, '0').slice(-digits).split('').map(Number)
  const firstSignificant = chars.findIndex(d => d !== 0)

  return (
    <div role="img" aria-label={`${value} ${unit}`} className={cn('inline-flex items-end gap-3', className)}>
      <div className="flex gap-1 rounded-xl bg-black/70 p-1.5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
        {chars.map((d, i) => {
          const offset = `${(-(10 + d) / STRIP.length) * 100}%`
          return (
            <span
              key={i}
              className={cn(
                'relative block h-14 w-10 overflow-hidden rounded-md bg-gradient-to-b from-[#1a2029] via-[#0e1218] to-[#1a2029] sm:h-18 sm:w-12',
                i >= firstSignificant ? 'text-foreground' : 'text-white/25',
              )}
            >
              <span
                className="flex animate-odometer-roll flex-col motion-reduce:animate-none"
                style={
                  {
                    '--roll-to': offset,
                    translate: `0 ${offset}`,
                    animationDelay: `${200 + i * 90}ms`,
                    animationDuration: `${1300 + i * 170}ms`,
                  } as CSSProperties
                }
              >
                {STRIP.map((n, k) => (
                  <span
                    key={k}
                    className="flex h-14 items-center justify-center text-4xl font-bold tabular-nums sm:h-18 sm:text-5xl"
                  >
                    {n}
                  </span>
                ))}
              </span>
              {/* Curvatura del tambor */}
              <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/40" />
            </span>
          )
        })}
      </div>
      <span className="pb-1 text-sm font-medium text-muted-foreground">{unit}</span>
    </div>
  )
}
