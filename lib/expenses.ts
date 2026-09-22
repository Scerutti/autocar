import type { FuelLoad, Job, JobCategory } from './types'

export type ExpenseCategory = JobCategory | 'combustible'

export interface MonthTotals {
  month: number // 0-11
  jobs: number
  fuel: number
  total: number
}

export interface ExpenseSummary {
  year: number
  total: number
  jobsTotal: number
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

export function expenseYears(jobs: Job[], fuel: FuelLoad[], currentYear: number): number[] {
  const years = new Set<number>([currentYear])
  for (const j of jobs) years.add(yearOf(j.date))
  for (const f of fuel) years.add(yearOf(f.date))
  return [...years].sort((a, b) => b - a)
}

export function summarizeExpenses(jobs: Job[], fuel: FuelLoad[], year: number, today: Date): ExpenseSummary {
  const months: MonthTotals[] = Array.from({ length: 12 }, (_, month) => ({ month, jobs: 0, fuel: 0, total: 0 }))
  const byCategory = new Map<ExpenseCategory, number>()

  for (const j of jobs) {
    if (yearOf(j.date) !== year) continue
    months[monthOf(j.date)].jobs += j.cost
    byCategory.set(j.category, (byCategory.get(j.category) ?? 0) + j.cost)
  }
  for (const f of fuel) {
    if (yearOf(f.date) !== year) continue
    months[monthOf(f.date)].fuel += f.total
    byCategory.set('combustible', (byCategory.get('combustible') ?? 0) + f.total)
  }
  for (const m of months) m.total = m.jobs + m.fuel

  const jobsTotal = months.reduce((s, m) => s + m.jobs, 0)
  const fuelTotal = months.reduce((s, m) => s + m.fuel, 0)
  const total = jobsTotal + fuelTotal
  const firstMonth = months.findIndex(m => m.total > 0)
  const lastMonth = year < today.getFullYear() ? 11 : today.getMonth()
  const elapsedMonths = firstMonth === -1 || year > today.getFullYear() ? 0 : Math.max(1, lastMonth - firstMonth + 1)

  return {
    year,
    total,
    jobsTotal,
    fuelTotal,
    months,
    byCategory: [...byCategory.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total),
    monthlyAverage: elapsedMonths > 0 ? total / elapsedMonths : 0,
  }
}
