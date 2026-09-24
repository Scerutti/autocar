import { addMonths } from './dates'
import { formatDate, formatKm, formatMoney } from './format'
import type { RuleStatus, RuleWithState } from './maintenance'
import { FUEL_LABELS, JOB_CATEGORY_LABELS, type Car, type ISODate, type Job } from './types'

// Datos del PDF "Historial de mantenimiento": sólo trabajos (no cargas de combustible) y el estado
// de los mantenimientos periódicos. Es pura para poder testearla; el dibujo está en components/report.

export type ReportPeriod = 'all' | '1y' | '3y' | 'custom'

export interface ReportOptions {
  showCosts: boolean
  period: ReportPeriod
  /** Sólo con period 'custom'. */
  from?: ISODate | null
}

export interface ReportJob {
  id: string
  date: string
  km: string | null
  title: string
  category: string
  workshop: string | null
  notes: string | null
  cost: string | null
}

export interface ReportRule {
  name: string
  lastDate: string | null
  lastKm: string | null
  next: string | null
  status: RuleStatus
  statusLabel: string
}

export interface ServiceReport {
  carName: string
  carDetail: string
  fuel: string
  currentKm: string
  issuedOn: string
  periodLabel: string
  jobs: ReportJob[]
  total: string | null
  rules: ReportRule[]
}

const STATUS_LABELS: Record<RuleStatus, string> = { ok: 'Al día', soon: 'Próximo', overdue: 'Vencido', unknown: 'Sin datos' }

/** Fecha desde la que se incluyen trabajos; null = todo el historial. */
export function reportFrom(options: Pick<ReportOptions, 'period' | 'from'>, today: ISODate): ISODate | null {
  if (options.period === '1y') return addMonths(today, -12)
  if (options.period === '3y') return addMonths(today, -36)
  if (options.period === 'custom') return options.from || null
  return null
}

/**
 * Helvetica (la fuente del PDF) sólo tiene los caracteres de Windows-1252: sobran para el castellano,
 * pero un emoji en una observación saldría como basura. Se quitan, y los espacios raros pasan a espacio común.
 */
export function pdfText(s: string): string {
  return s
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[^\n\u0020-\u007e\u00a1-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

const optional = (s: string | null | undefined) => (s ? pdfText(s) || null : null)

export function buildServiceReport(input: {
  car: Car
  jobs: Job[]
  rules: RuleWithState[]
  options: ReportOptions
  today: ISODate
}): ServiceReport {
  const { car, options, today } = input
  const from = reportFrom(options, today)
  const jobs = input.jobs
    .filter(j => j.carId === car.id && (!from || j.date >= from))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime())

  // Sólo los periódicos: los de una sola vez ("volver al taller") son recordatorios, no historial.
  const rules = input.rules
    .filter(({ rule }) => rule.repeat)
    .map(({ rule, state }) => {
      const next = [state.nextKm != null ? `a los ${formatKm(state.nextKm)}` : null, state.nextDate ? `el ${formatDate(state.nextDate)}` : null]
        .filter(Boolean)
        .join(' o ')
      return {
        name: pdfText(rule.name),
        lastDate: rule.lastDoneDate ? formatDate(rule.lastDoneDate) : null,
        lastKm: rule.lastDoneKm != null && rule.intervalKm ? formatKm(rule.lastDoneKm) : null,
        next: next ? next[0].toUpperCase() + next.slice(1) : null,
        status: state.status,
        statusLabel: STATUS_LABELS[state.status],
      }
    })

  const oldest = jobs.at(-1)?.date
  const periodLabel = !jobs.length
    ? 'Sin trabajos en el período'
    : from
      ? `Desde el ${formatDate(from)}`
      : `Desde el ${formatDate(oldest!)}`

  return {
    carName: pdfText([car.brand, car.model, car.version].filter(Boolean).join(' ')),
    carDetail: pdfText([car.year, car.plate ? `Patente ${car.plate}` : null].filter(Boolean).join(' · ')),
    fuel: car.fuelTypes.map(t => FUEL_LABELS[t]).join(' + '),
    currentKm: formatKm(car.currentKm),
    issuedOn: formatDate(today),
    periodLabel,
    jobs: jobs.map(j => ({
      id: j.id,
      date: formatDate(j.date),
      km: j.km != null ? formatKm(j.km) : null,
      title: pdfText(j.title) || JOB_CATEGORY_LABELS[j.category],
      category: JOB_CATEGORY_LABELS[j.category],
      workshop: optional(j.workshop),
      notes: optional(j.notes),
      cost: options.showCosts ? pdfText(formatMoney(j.cost)) : null,
    })),
    total: options.showCosts ? pdfText(formatMoney(jobs.reduce((s, j) => s + j.cost, 0))) : null,
    rules,
  }
}

/** "autocar-historial-chevrolet-agile-2026-09-24.pdf" */
export function reportFileName(car: Pick<Car, 'brand' | 'model'>, today: ISODate) {
  const slug = `${car.brand} ${car.model}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `autocar-historial-${slug || 'auto'}-${today}.pdf`
}
