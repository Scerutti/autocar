import type { FuelLoad, Job, JobCategory } from './types'

export type ExpenseCategory = JobCategory | 'combustible'

export interface MonthTotals {
  /** Mes de 0 (enero) a 11 (diciembre). */
  month: number
  /** Trabajos sin los de `repuestos`. */
  jobs: number
  /** Trabajos de la categoría `repuestos`. */
  parts: number
  fuel: number
  total: number
}

export interface ExpenseSummary {
  year: number
  total: number
  /** Trabajos sin los de `repuestos`. */
  jobsTotal: number
  partsTotal: number
  fuelTotal: number
  months: MonthTotals[]
  byCategory: { category: ExpenseCategory; total: number }[]
  /** Promedio mensual desde el primer mes con gastos hasta hoy (o fin de año si es un año pasado). */
  monthlyAverage: number
}

function yearOf(date: string) {
  return Number(date.slice(0, 4))
}

function monthOf(date: string) {
  return Number(date.slice(5, 7)) - 1
}

/**
 * Porcentaje entero de cada monto sobre la suma, redondeado para que sumen 100 (al mayor resto): 71,4 + 18,7 + 9,9
 * da 71 + 19 + 10 y no 101. Sin nada que sumar, todos 0.
 */
export function percentShares(amounts: number[]): number[] {
  const total = amounts.reduce((s, a) => s + a, 0)
  if (total <= 0) return amounts.map(() => 0)
  const exact = amounts.map(a => (a / total) * 100)
  const shares = exact.map(Math.floor)
  const order = exact.map((e, i) => ({ i, rest: e - shares[i] })).sort((a, b) => b.rest - a.rest)
  const missing = 100 - shares.reduce((s, x) => s + x, 0)
  for (let k = 0; k < missing; k++) shares[order[k].i]++
  return shares
}

export function expenseYears(jobs: Job[], fuel: FuelLoad[], currentYear: number): number[] {
  const years = new Set<number>([currentYear])
  for (const j of jobs) years.add(yearOf(j.date))
  for (const f of fuel) years.add(yearOf(f.date))
  return [...years].sort((a, b) => b - a)
}

export function summarizeExpenses(jobs: Job[], fuel: FuelLoad[], year: number, today: Date): ExpenseSummary {
  const months: MonthTotals[] = Array.from({ length: 12 }, (_, month) => ({ month, jobs: 0, parts: 0, fuel: 0, total: 0 }))
  const byCategory = new Map<ExpenseCategory, number>()

  for (const j of jobs) {
    if (yearOf(j.date) !== year) continue
    if (j.category === 'repuestos') months[monthOf(j.date)].parts += j.cost
    else months[monthOf(j.date)].jobs += j.cost
    byCategory.set(j.category, (byCategory.get(j.category) ?? 0) + j.cost)
  }
  for (const f of fuel) {
    if (yearOf(f.date) !== year) continue
    months[monthOf(f.date)].fuel += f.total
    byCategory.set('combustible', (byCategory.get('combustible') ?? 0) + f.total)
  }
  for (const m of months) m.total = m.jobs + m.parts + m.fuel

  const jobsTotal = months.reduce((s, m) => s + m.jobs, 0)
  const partsTotal = months.reduce((s, m) => s + m.parts, 0)
  const fuelTotal = months.reduce((s, m) => s + m.fuel, 0)
  const total = jobsTotal + partsTotal + fuelTotal
  const firstMonth = months.findIndex(m => m.total > 0)
  const lastMonth = year < today.getFullYear() ? 11 : today.getMonth()
  const elapsedMonths = firstMonth === -1 || year > today.getFullYear() ? 0 : Math.max(1, lastMonth - firstMonth + 1)

  return {
    year,
    total,
    jobsTotal,
    partsTotal,
    fuelTotal,
    months,
    byCategory: [...byCategory.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total),
    monthlyAverage: elapsedMonths > 0 ? total / elapsedMonths : 0,
  }
}
