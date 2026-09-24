import { describe, expect, it } from 'vitest'
import { getRuleState } from './maintenance'
import { buildServiceReport, pdfText, reportFileName, reportFrom } from './report'
import type { Car, Job, MaintenanceRule } from './types'

const car: Car = {
  id: 'c1',
  brand: 'Chevrolet',
  model: 'Agile',
  version: '1.4 LT',
  year: 2012,
  plate: 'LIP798',
  fuelTypes: ['nafta', 'gnc'],
  currentKm: 198000,
  kmUpdatedAt: null,
  avgKmPerDay: null,
  photoUrl: null,
  photoPublicId: null,
  createdAt: new Date(0),
}

function job(p: Partial<Job>): Job {
  return {
    id: Math.random().toString(),
    carId: 'c1',
    date: '2026-01-10',
    km: 190000,
    title: 'Service',
    category: 'service',
    cost: 100000,
    workshop: null,
    notes: null,
    ruleIds: [],
    createdAt: new Date(0),
    ...p,
  }
}

function rule(p: Partial<MaintenanceRule>): MaintenanceRule {
  return {
    id: 'r',
    carId: 'c1',
    name: 'Service',
    intervalKm: 10000,
    intervalTime: { amount: 1, unit: 'year' },
    repeat: true,
    lastDoneKm: 190000,
    lastDoneDate: '2026-01-10',
    warnKm: 500,
    warnDays: 30,
    lastNotifiedAt: null,
    lastNotifiedStatus: null,
    ...p,
  }
}

const today = '2026-09-24'
const withState = (r: MaintenanceRule) => ({ rule: r, state: getRuleState(r, car, today) })

describe('buildServiceReport', () => {
  const jobs = [
    job({ date: '2024-05-01', title: 'Cambio de correa', category: 'reparacion', cost: 300000 }),
    job({ date: '2026-03-15', title: 'Frenos', category: 'frenos', notes: 'Pastillas nuevas 🚗', workshop: 'Taller Juan' }),
    job({ date: '2026-01-10' }),
    job({ carId: 'otro', date: '2026-02-01' }),
  ]

  it('lista los trabajos del auto, del más nuevo al más viejo', () => {
    const r = buildServiceReport({ car, jobs, rules: [], options: { showCosts: false, period: 'all' }, today })
    expect(r.jobs.map(j => j.title)).toEqual(['Frenos', 'Service', 'Cambio de correa'])
    expect(r.jobs[0]).toMatchObject({ workshop: 'Taller Juan', notes: 'Pastillas nuevas', category: 'Frenos' })
    expect(r.carName).toBe('Chevrolet Agile 1.4 LT')
    expect(r.carDetail).toBe('2012 · Patente LIP798')
    expect(r.fuel).toBe('Nafta + GNC')
  })

  it('oculta los costos si se pide', () => {
    const r = buildServiceReport({ car, jobs, rules: [], options: { showCosts: false, period: 'all' }, today })
    expect(r.total).toBeNull()
    expect(r.jobs.every(j => j.cost == null)).toBe(true)
  })

  it('muestra costos y total del período', () => {
    const r = buildServiceReport({ car, jobs, rules: [], options: { showCosts: true, period: '1y' }, today })
    expect(r.jobs).toHaveLength(2)
    expect(r.total).toBe('$ 200.000')
  })

  it('incluye sólo los mantenimientos periódicos, con última vez y próximo', () => {
    const rules = [withState(rule({})), withState(rule({ id: 'x', name: 'Volver al taller', repeat: false }))]
    const r = buildServiceReport({ car, jobs: [], rules, options: { showCosts: false, period: 'all' }, today })
    expect(r.rules).toHaveLength(1)
    expect(r.rules[0].next).toMatch(/^A los 200\.000 km o el /)
    expect(r.rules[0]).toMatchObject({ lastDate: '10 de ene de 2026', lastKm: '190.000 km' })
    // Faltan 2.000 km y avisa a los 500: todavía está al día.
    expect(r.rules[0].statusLabel).toBe('Al día')
  })
})

describe('reportFrom', () => {
  it('calcula el inicio del período', () => {
    expect(reportFrom({ period: 'all' }, today)).toBeNull()
    expect(reportFrom({ period: '1y' }, today)).toBe('2025-09-24')
    expect(reportFrom({ period: '3y' }, today)).toBe('2023-09-24')
    expect(reportFrom({ period: 'custom', from: '2025-01-01' }, today)).toBe('2025-01-01')
  })
})

describe('pdfText', () => {
  it('conserva el castellano y saca lo que Helvetica no puede dibujar', () => {
    expect(pdfText('Año, ñandú, ¿qué? — “ok” 😀')).toBe('Año, ñandú, ¿qué? — “ok”')
    expect(pdfText('$ 100')).toBe('$ 100')
  })
})

describe('reportFileName', () => {
  it('arma un nombre sin tildes ni espacios', () => {
    expect(reportFileName({ brand: 'Citroën', model: 'C4 Picasso' }, today)).toBe('autocar-historial-citroen-c4-picasso-2026-09-24.pdf')
  })
})
