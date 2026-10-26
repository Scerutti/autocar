import { describe, expect, it } from 'vitest'
import { carRecords } from './achievements'
import {
  approvedJobs,
  authorLabel,
  canEditEntry,
  canEditJob,
  isCarOwner,
  isSharedCar,
  memberError,
  mineForAchievements,
  normalizeEmail,
} from './sharing'
import type { Car, FuelLoad, Job, MaintenanceRule, OdometerReading } from './types'

const OWNER = 'owner-uid'
const MEMBER = 'member-uid'

const car = (extra: Partial<Car> = {}): Car => ({
  id: 'c1',
  brand: 'Fiat',
  model: 'Cronos',
  version: null,
  year: null,
  plate: null,
  fuelTypes: ['nafta'],
  currentKm: 0,
  kmUpdatedAt: null,
  avgKmPerDay: null,
  photoUrl: null,
  photoPublicId: null,
  createdAt: new Date('2026-06-01T12:00:00'),
  ownerUid: OWNER,
  ownerName: 'Ana',
  members: ['beto@gmail.com'],
  ...extra,
})

const job = (extra: Partial<Job> = {}): Job => ({
  id: 'j1',
  carId: 'c1',
  date: '2026-09-01',
  km: 10000,
  title: 'Service',
  category: 'service',
  cost: 1000,
  workshop: null,
  notes: null,
  ruleIds: [],
  status: 'approved',
  createdBy: OWNER,
  createdByName: 'Ana',
  createdAt: new Date('2026-09-01T12:00:00'),
  ...extra,
})

const fuel = (extra: Partial<FuelLoad> = {}): FuelLoad => ({
  id: 'f1',
  carId: 'c1',
  date: '2026-09-01',
  km: null,
  fuelType: 'nafta',
  grade: 'super',
  quantity: 40,
  unitPrice: 1000,
  total: 40000,
  fullTank: true,
  station: null,
  createdBy: OWNER,
  createdByName: 'Ana',
  createdAt: new Date('2026-09-01T12:00:00'),
  ...extra,
})

const reading = (extra: Partial<OdometerReading> = {}): OdometerReading => ({
  id: 'r1',
  carId: 'c1',
  km: 10000,
  date: new Date('2026-09-01T12:00:00'),
  source: 'manual',
  sourceId: null,
  createdBy: OWNER,
  createdByName: 'Ana',
  createdAt: null,
  ...extra,
})

const rule = (extra: Partial<MaintenanceRule> = {}): MaintenanceRule => ({
  id: 'rule1',
  carId: 'c1',
  name: 'Service',
  intervalKm: 5000,
  intervalTime: null,
  repeat: true,
  baseKm: 10000,
  baseDate: '2026-09-01',
  lastDoneKm: 10000,
  lastDoneKmEstimated: false,
  lastDoneDate: '2026-09-01',
  lastDoneJobId: null,
  completedByJobId: null,
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
  ...extra,
})

describe('permisos', () => {
  it('el dueño puede editar todo', () => {
    const c = car()
    expect(isCarOwner(c, OWNER)).toBe(true)
    expect(canEditEntry(c, OWNER, fuel({ createdBy: MEMBER }))).toBe(true)
    expect(canEditEntry(c, OWNER, reading({ createdBy: MEMBER }))).toBe(true)
    expect(canEditJob(c, OWNER, job({ createdBy: MEMBER, status: 'pending' }))).toBe(true)
    expect(canEditJob(c, OWNER, job({ createdBy: MEMBER, status: 'approved' }))).toBe(true)
  })

  it('el miembro puede editar sólo lo suyo', () => {
    const c = car()
    expect(isCarOwner(c, MEMBER)).toBe(false)
    expect(canEditEntry(c, MEMBER, fuel({ createdBy: MEMBER }))).toBe(true)
    expect(canEditEntry(c, MEMBER, fuel())).toBe(false)
    expect(canEditEntry(c, MEMBER, reading({ createdBy: MEMBER }))).toBe(true)
    expect(canEditEntry(c, MEMBER, reading())).toBe(false)
  })

  it('un registro sin autoría cuenta como del dueño', () => {
    const c = car()
    expect(canEditEntry(c, MEMBER, fuel({ createdBy: null }))).toBe(false)
    expect(canEditEntry(c, OWNER, fuel({ createdBy: null }))).toBe(true)
  })

  it('el miembro no puede editar un trabajo suyo aprobado, y sí uno pendiente o rechazado', () => {
    const c = car()
    expect(canEditJob(c, MEMBER, job({ createdBy: MEMBER, status: 'approved' }))).toBe(false)
    expect(canEditJob(c, MEMBER, job({ createdBy: MEMBER, status: undefined }))).toBe(false)
    expect(canEditJob(c, MEMBER, job({ createdBy: MEMBER, status: 'pending' }))).toBe(true)
    expect(canEditJob(c, MEMBER, job({ createdBy: MEMBER, status: 'rejected' }))).toBe(true)
    expect(canEditJob(c, MEMBER, job({ createdBy: OWNER, status: 'pending' }))).toBe(false)
  })

  it('un auto está compartido si tiene miembros o si me lo compartieron', () => {
    expect(isSharedCar(car(), OWNER)).toBe(true)
    expect(isSharedCar(car({ members: [] }), OWNER)).toBe(false)
    expect(isSharedCar(car({ members: [] }), MEMBER)).toBe(true)
  })
})

describe('authorLabel', () => {
  it('dice vos, el nombre o el del dueño si el registro es viejo', () => {
    const c = car()
    expect(authorLabel(fuel({ createdBy: MEMBER }), c, MEMBER)).toBe('vos')
    expect(authorLabel(fuel({ createdBy: MEMBER, createdByName: 'Beto' }), c, OWNER)).toBe('Beto')
    expect(authorLabel(fuel({ createdBy: null, createdByName: null }), c, MEMBER)).toBe('Ana')
    expect(authorLabel(fuel({ createdBy: MEMBER, createdByName: null }), c, OWNER)).toBe('otra persona')
  })
})

describe('memberError', () => {
  const input = { ownerEmail: 'ana@gmail.com', members: ['beto@gmail.com'] }

  it('acepta un mail nuevo en minúscula', () => {
    expect(memberError('caro@gmail.com', input)).toBeNull()
    expect(memberError(normalizeEmail('  Caro@Gmail.com '), input)).toBeNull()
  })

  it('rechaza un mail inválido', () => {
    expect(memberError('caro', input)).not.toBeNull()
    expect(memberError('caro@gmail', input)).not.toBeNull()
    expect(memberError('caro @gmail.com', input)).not.toBeNull()
  })

  it('rechaza un mail en mayúsculas', () => {
    expect(memberError('Caro@Gmail.com', input)).not.toBeNull()
  })

  it('rechaza el mail del dueño', () => {
    expect(memberError('ana@gmail.com', input)).not.toBeNull()
    expect(memberError('ana@gmail.com', { ...input, ownerEmail: 'Ana@Gmail.com' })).not.toBeNull()
  })

  it('rechaza un mail repetido', () => {
    expect(memberError('beto@gmail.com', input)).not.toBeNull()
  })

  it('rechaza un tercero', () => {
    expect(memberError('dani@gmail.com', { ...input, members: ['beto@gmail.com', 'caro@gmail.com'] })).not.toBeNull()
  })
})

describe('approvedJobs', () => {
  it('deja sólo los aprobados (y los viejos sin estado)', () => {
    const jobs = [
      job({ id: 'a', status: 'approved' }),
      job({ id: 'p', status: 'pending' }),
      job({ id: 'r', status: 'rejected' }),
      job({ id: 'v', status: undefined }),
    ]
    expect(approvedJobs(jobs).map(j => j.id)).toEqual(['a', 'v'])
  })
})

describe('mineForAchievements', () => {
  const own = car({ id: 'own', ownerUid: OWNER })
  const shared = car({ id: 'shared', ownerUid: 'other-uid', ownerName: 'Caro', members: ['ana@gmail.com'] })
  const data = {
    cars: [own, shared],
    rules: [rule({ id: 'r-own', carId: 'own' }), rule({ id: 'r-shared', carId: 'shared' })],
    jobs: [
      job({ id: 'j-mine', carId: 'own' }),
      job({ id: 'j-other', carId: 'own', createdBy: MEMBER }),
      job({ id: 'j-pending', carId: 'shared', status: 'pending' }),
      job({ id: 'j-rejected', carId: 'shared', status: 'rejected' }),
      job({ id: 'j-shared-ok', carId: 'shared' }),
      job({ id: 'j-legacy', carId: 'own', createdBy: null }),
    ],
    fuel: [
      fuel({ id: 'f-mine', carId: 'own' }),
      fuel({ id: 'f-other', carId: 'own', createdBy: MEMBER }),
      fuel({ id: 'f-owner-of-shared', carId: 'shared', createdBy: 'other-uid' }),
    ],
    odometer: [
      reading({ id: 'o-mine', carId: 'shared' }),
      reading({ id: 'o-other', carId: 'own', createdBy: MEMBER }),
      reading({ id: 'o-legacy-shared', carId: 'shared', createdBy: null }),
    ],
  }

  it('deja afuera lo que cargaron otros y los trabajos no aprobados', () => {
    const mine = mineForAchievements(data, OWNER)
    expect(mine.jobs.map(j => j.id)).toEqual(['j-mine', 'j-shared-ok', 'j-legacy'])
    expect(mine.fuel.map(f => f.id)).toEqual(['f-mine'])
    expect(mine.odometer.map(r => r.id)).toEqual(['o-mine'])
  })

  it('no cuenta los recordatorios cumplidos, como cuando un trabajo los borraba', () => {
    const withDone = { ...data, rules: [...data.rules, rule({ id: 'r-done', carId: 'own', repeat: false, completedByJobId: 'j-mine' })] }
    expect(mineForAchievements(withDone, OWNER).rules.map(r => r.id)).toEqual(['r-own'])
  })

  it('pone rules: [] en un auto compartido conmigo', () => {
    const records = carRecords(mineForAchievements(data, OWNER), '2026-10-09')
    expect(records.find(r => r.car.id === 'own')?.rules.map(r => r.id)).toEqual(['r-own'])
    expect(records.find(r => r.car.id === 'shared')?.rules).toEqual([])
  })

  it('a quien carga en el auto de otro sólo le cuenta lo suyo', () => {
    const mine = mineForAchievements(data, MEMBER)
    expect(mine.jobs.map(j => j.id)).toEqual(['j-other'])
    expect(mine.fuel.map(f => f.id)).toEqual(['f-other'])
    expect(mine.odometer.map(r => r.id)).toEqual(['o-other'])
  })
})
