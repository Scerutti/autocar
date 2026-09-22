import type { ISODate } from './types'

const DAY_MS = 86_400_000

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** Fecha local de un Date como 'YYYY-MM-DD'. */
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DD' de hoy en una zona horaria dada (para el servidor, que corre en UTC). */
export function todayInTimeZone(timeZone: string, now = new Date()): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Día de la semana (0 = domingo) de una fecha ISO. */
export function weekdayOf(date: ISODate): number {
  return parseISODate(date).getUTCDay()
}

/** Parsea 'YYYY-MM-DD' a medianoche UTC; sólo se usa para aritmética de días. */
export function parseISODate(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function fromUTC(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(new Date(parseISODate(date).getTime() + Math.round(days) * DAY_MS))
}

/** Suma meses; si el día no existe en el mes destino, usa el último día (31/01 + 1 mes = 28/02). */
export function addMonths(date: ISODate, months: number): ISODate {
  const d = parseISODate(date)
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay))
  return fromUTC(target)
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / DAY_MS)
}

export function daysBetweenInstants(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS
}
