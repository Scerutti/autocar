'use client'

import { useMemo, useState } from 'react'
import { formatDate, formatKm, formatMoney, MONTHS_SHORT } from '@/lib/format'
import { toISODate } from '@/lib/dates'
import type { MonthTotals } from '@/lib/expenses'
import { niceMax } from '@/lib/scale'
import { cn } from '@/lib/utils'

/** "$ 150 mil", "$ 1,2 M" para ejes. */
function compactMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

/** Tarjeta de gráfico: siempre con título y una línea que explica qué se ve y cómo leerlo. */
export function ChartCard({
  title,
  description,
  legend,
  children,
  className,
}: {
  title: string
  description: string
  legend?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-2xl border border-white/8 bg-card/60 p-5', className)}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        {legend}
      </div>
      {children}
    </section>
  )
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {items.map(i => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** Barras apiladas por mes: trabajos (abajo) + combustible (arriba). */
export function MonthlyBars({ months, currentMonth }: { months: MonthTotals[]; currentMonth: number | null }) {
  const [active, setActive] = useState<number | null>(null)
  const { top, step } = niceMax(Math.max(...months.map(m => m.total)))
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const shown = active ?? currentMonth

  return (
    <div>
      <div className="relative flex h-52 gap-2 pl-11">
        {/* Grilla y eje Y */}
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0">
          {ticks.map(t => (
            <div key={t} className="absolute left-0 right-0 flex items-center" style={{ bottom: `${(t / top) * 100}%` }}>
              <span className="w-10 -translate-y-px pr-2 text-right text-[10px] tabular-nums text-muted-foreground">{compactMoney(t)}</span>
              <div className={cn('h-px flex-1', t === 0 ? 'bg-white/20' : 'bg-white/[0.06]')} />
            </div>
          ))}
        </div>
        {months.map(m => {
          const jobsPct = (m.jobs / top) * 100
          const fuelPct = (m.fuel / top) * 100
          return (
            <button
              key={m.month}
              type="button"
              aria-label={`${MONTHS_SHORT[m.month]}: ${formatMoney(m.total)}`}
              onMouseEnter={() => setActive(m.month)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(m.month)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(a => (a === m.month ? null : m.month))}
              className={cn('relative flex flex-1 flex-col-reverse items-stretch rounded-t transition', shown === m.month && 'bg-white/[0.04]')}
            >
              {m.jobs > 0 && (
                <div className={cn('w-full bg-series-1', m.fuel === 0 && 'rounded-t-[4px]')} style={{ height: `${jobsPct}%` }} />
              )}
              {m.fuel > 0 && (
                <div
                  className={cn('w-full rounded-t-[4px] bg-series-2', m.jobs > 0 && 'mb-[2px]')}
                  style={{ height: `${fuelPct}%` }}
                />
              )}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex gap-2 pl-11">
        {months.map(m => (
          <span
            key={m.month}
            className={cn('flex-1 text-center text-[10px] text-muted-foreground', shown === m.month && 'font-medium text-foreground')}
          >
            {MONTHS_SHORT[m.month].slice(0, 1)}
            <span className="hidden sm:inline">{MONTHS_SHORT[m.month].slice(1)}</span>
          </span>
        ))}
      </div>
      {/* Detalle del mes activo (hover / tap), en texto: no depende del color */}
      <div className="mt-4 flex min-h-12 flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-background/30 px-4 py-3 text-sm">
        {shown != null ? (
          <>
            <span className="font-medium">{MONTHS_SHORT[shown]}</span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-sm bg-series-1" /> Trabajos{' '}
              <span className="tabular-nums text-foreground">{formatMoney(months[shown].jobs)}</span>
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2.5 rounded-sm bg-series-2" /> Combustible{' '}
              <span className="tabular-nums text-foreground">{formatMoney(months[shown].fuel)}</span>
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(months[shown].total)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Tocá un mes para ver el detalle.</span>
        )}
      </div>
    </div>
  )
}

/** Barras horizontales de una sola serie (gasto por categoría). */
export function CategoryBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value))
  const total = rows.reduce((s, r) => s + r.value, 0)
  return (
    <div className="space-y-3">
      {rows.map(r => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span>{r.label}</span>
            <span className="tabular-nums">
              {formatMoney(r.value)}{' '}
              <span className="text-xs text-muted-foreground">{total ? Math.round((r.value / total) * 100) : 0}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-series-1" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Línea del odómetro en el tiempo, con cruz y tooltip al pasar el dedo/mouse. */
export function KmChart({ readings }: { readings: { km: number; date: Date }[] }) {
  const points = useMemo(() => [...readings].sort((a, b) => a.date.getTime() - b.date.getTime()), [readings])
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Con dos o más registros vas a ver el gráfico.</p>
  }

  const W = 600
  const H = 180
  const pad = { l: 8, r: 8, t: 12, b: 8 }
  const t0 = points[0].date.getTime()
  const t1 = points[points.length - 1].date.getTime()
  const k0 = points[0].km
  const k1 = points[points.length - 1].km
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r)
  const y = (k: number) => H - pad.b - ((k - k0) / Math.max(1, k1 - k0)) * (H - pad.t - pad.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date.getTime()).toFixed(1)},${y(p.km).toFixed(1)}`).join(' ')
  const area = `${path} L${x(t1)},${H - pad.b} L${x(t0)},${H - pad.b} Z`

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].date.getTime()) - px) < Math.abs(x(points[best].date.getTime()) - px)) best = i
    }
    setHover(best)
  }

  const h = hover != null ? points[hover] : null
  return (
    <div>
      {/* Escala: km más alto arriba y más bajo abajo, para leer el gráfico sin adivinar */}
      <div className="mb-1 text-[11px] tabular-nums text-muted-foreground">{formatKm(k1)}</div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-44 w-full touch-none overflow-visible"
          preserveAspectRatio="none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Kilometraje de ${formatKm(k0)} a ${formatKm(k1)}`}
        >
          <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="rgba(255,255,255,0.2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="var(--series-1)" opacity="0.12" />
          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {h && (
            <line
              x1={x(h.date.getTime())}
              x2={x(h.date.getTime())}
              y1={pad.t}
              y2={H - pad.b}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-series-1"
            style={{ left: `${(x(h.date.getTime()) / W) * 100}%`, top: `${(y(h.km) / H) * 100}%` }}
          />
        )}
      </div>
      <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">{formatKm(k0)}</div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        {h ? (
          <span className="w-full text-center text-foreground">
            {formatDate(toISODate(h.date))} · <span className="font-medium tabular-nums">{formatKm(h.km)}</span>
          </span>
        ) : (
          <>
            <span>{formatDate(toISODate(points[0].date))}</span>
            <span>{formatDate(toISODate(points[points.length - 1].date))}</span>
          </>
        )}
      </div>
    </div>
  )
}
