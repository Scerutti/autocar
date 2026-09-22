import { parseISODate } from './dates'
import type { IntervalUnit, ISODate, TimeInterval } from './types'

const numberFmt = new Intl.NumberFormat('es-AR')
const moneyFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const moneyFmt2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })
const dateFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const shortDateFmt = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' })
const longTodayFmt = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })

export const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

const UNIT_NAMES: Record<IntervalUnit, [string, string]> = {
  day: ['día', 'días'],
  week: ['semana', 'semanas'],
  month: ['mes', 'meses'],
  year: ['año', 'años'],
}

export function unitName(unit: IntervalUnit, amount: number) {
  return UNIT_NAMES[unit][amount === 1 ? 0 : 1]
}

/** "1 mes", "3 semanas", "2 años". */
export function formatInterval({ amount, unit }: TimeInterval) {
  return `${numberFmt.format(amount)} ${unitName(unit, amount)}`
}

/** "los domingos", "los martes"… (sábado y domingo llevan s en plural). */
export function everyWeekday(i: number) {
  const day = WEEKDAYS[i].toLowerCase()
  return `los ${i === 0 || i === 6 ? `${day}s` : day}`
}

export function formatNumber(n: number) {
  return numberFmt.format(n)
}

export function formatKm(n: number) {
  return `${numberFmt.format(Math.round(n))} km`
}

export function formatMoney(n: number) {
  return moneyFmt.format(n)
}

/** Con centavos; para precios por litro. */
export function formatMoneyPrecise(n: number) {
  return moneyFmt2.format(n)
}

export function formatDate(date: ISODate) {
  return dateFmt.format(parseISODate(date)).replace('.', '')
}

export function formatShortDate(date: ISODate) {
  return shortDateFmt.format(parseISODate(date)).replace('.', '').toUpperCase()
}

export function formatToday(d = new Date()) {
  return longTodayFmt.format(d).replace('.', '').toUpperCase()
}

export function timeAgo(d: Date, now = new Date()) {
  const minutes = Math.round((now.getTime() - d.getTime()) / 60_000)
  if (minutes < 1) return 'recién'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.round(days / 30)
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`
}

/** Parsea números escritos a la argentina: "1.234,56" o "1234.56". */
export function parseNumberInput(value: string): number | null {
  const v = value.trim().replace(/\s|\$/g, '')
  if (!v) return null
  let normalized = v
  if (v.includes(',')) normalized = v.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(v)) normalized = v.replace(/\./g, '')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}
