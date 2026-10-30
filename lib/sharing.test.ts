import { describe, expect, it } from 'vitest'
import { carRecords } from './achievements'
import {
  approvedJobs,
  authorLabel,
  canEditEntry,
  canEditJob,
  canonicalEmail,
  carMembers,
  inviteCarLabel,
  inviteEmailKey,
  inviteId,
  isCarOwner,
  isInviteOpen,
  isSharedCar,
  jobEdit,
  maskEmail,
  memberError,
  mineForAchievements,
  normalizeEmail,
  reviewAlreadyDone,
} from './sharing'
import type { Car, FuelLoad, Invite, Job, MaintenanceRule, OdometerReading } from './types'

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
  revision: 0,
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

  it('cuenta los miembros por uid aunque no estén en el mail viejo', () => {
    expect(isSharedCar(car({ members: [], memberUids: [MEMBER] }), OWNER)).toBe(true)
    expect(isSharedCar(car({ members: [], memberUids: [] }), OWNER)).toBe(false)
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

const NOW = new Date('2026-10-30T12:00:00')

const invite = (extra: Partial<Invite> = {}): Invite => ({
  id: 'c1_caro@gmail.com',
  carId: 'c1',
  ownerUid: OWNER,
  ownerName: 'Ana',
  carLabel: 'Fiat Cronos',
  email: 'caro@gmail.com',
  emailKey: 'caro@gmail.com',
  status: 'pending',
  createdAt: new Date('2026-10-29T12:00:00'),
  expiresAt: new Date('2026-11-12T12:00:00'),
  respondedAt: null,
  acceptedUid: null,
  ...extra,
})

describe('canonicalEmail', () => {
  it('en Gmail saca los puntos y lo que va después de un "+"', () => {
    expect(canonicalEmail('j.doe@gmail.com')).toBe('jdoe@gmail.com')
    expect(canonicalEmail('jdoe+auto@gmail.com')).toBe('jdoe@gmail.com')
    expect(canonicalEmail('j.d.o.e+auto+otro@gmail.com')).toBe('jdoe@gmail.com')
  })

  it('trata googlemail.com como gmail.com', () => {
    expect(canonicalEmail('j.doe@googlemail.com')).toBe('jdoe@gmail.com')
  })

  it('pasa a minúscula y saca los espacios', () => {
    expect(canonicalEmail('  J.Doe@Gmail.COM ')).toBe('jdoe@gmail.com')
    expect(canonicalEmail('Juan.Perez@Empresa.com.ar')).toBe('juan.perez@empresa.com.ar')
  })

  it('en otros dominios deja los puntos y el "+"', () => {
    expect(canonicalEmail('j.doe+auto@hotmail.com')).toBe('j.doe+auto@hotmail.com')
    expect(canonicalEmail('j.doe@gmail.com.ar')).toBe('j.doe@gmail.com.ar')
  })
})

describe('invitaciones', () => {
  it('el id es el auto y el mail canónico', () => {
    expect(inviteId('c1', 'J.Doe+auto@gmail.com')).toBe('c1_jdoe@gmail.com')
    expect(inviteEmailKey('c1_jdoe@gmail.com')).toBe('jdoe@gmail.com')
    expect(inviteEmailKey('c1_j_doe@empresa.com')).toBe('j_doe@empresa.com')
    expect(inviteEmailKey('sin-guion')).toBe('')
  })

  it('tapa el mail', () => {
    expect(maskEmail('jdoe@gmail.com')).toBe('j•••@gmail.com')
    expect(maskEmail('raro')).toBe('•••')
  })

  it('está abierta si está pendiente y no venció', () => {
    expect(isInviteOpen(invite(), NOW)).toBe(true)
    expect(isInviteOpen(invite({ expiresAt: NOW }), NOW)).toBe(false)
    expect(isInviteOpen(invite({ status: 'declined' }), NOW)).toBe(false)
    expect(isInviteOpen(invite({ status: 'revoked' }), NOW)).toBe(false)
    expect(isInviteOpen(invite({ status: 'accepted' }), NOW)).toBe(false)
  })

  it('el auto se ve como marca, modelo y año', () => {
    expect(inviteCarLabel({ brand: 'Ford', model: 'Ka', year: 2015 })).toBe('Ford Ka 2015')
    expect(inviteCarLabel({ brand: 'Ford', model: 'Ka', year: null })).toBe('Ford Ka')
  })
})

describe('carMembers', () => {
  it('lista los miembros por uid y los mails viejos que no son de ninguno', () => {
    const c = car({
      members: ['j.doe@gmail.com', 'beto@gmail.com'],
      memberUids: [MEMBER],
      memberProfiles: { [MEMBER]: { email: 'jdoe@gmail.com', name: 'Juan' } },
    })
    expect(carMembers(c)).toEqual([
      { uid: MEMBER, email: 'jdoe@gmail.com', name: 'Juan' },
      { uid: null, email: 'beto@gmail.com', name: null },
    ])
  })

  it('sin los campos nuevos, sólo los mails viejos', () => {
    expect(carMembers(car())).toEqual([{ uid: null, email: 'beto@gmail.com', name: null }])
  })
})

describe('memberError', () => {
  const c = car({ members: [], memberUids: [], memberProfiles: {} })
  const ctx = { ownerEmail: 'ana@gmail.com', now: NOW }
  const withUid = (email: string) => car({ members: [], memberUids: [MEMBER], memberProfiles: { [MEMBER]: { email, name: null } } })

  it('acepta un mail nuevo en minúscula', () => {
    expect(memberError(c, [], 'caro@gmail.com', ctx)).toBeNull()
    expect(memberError(c, [], normalizeEmail('  Caro@Gmail.com '), ctx)).toBeNull()
  })

  it('rechaza un mail inválido', () => {
    expect(memberError(c, [], 'caro', ctx)).not.toBeNull()
    expect(memberError(c, [], 'caro@gmail', ctx)).not.toBeNull()
    expect(memberError(c, [], 'caro @gmail.com', ctx)).not.toBeNull()
    expect(memberError(c, [], 'ca/ro@gmail.com', ctx)).not.toBeNull()
  })

  it('rechaza un mail en mayúsculas', () => {
    expect(memberError(c, [], 'Caro@Gmail.com', ctx)).not.toBeNull()
  })

  it('rechaza mi propio mail, también escrito de otra forma', () => {
    expect(memberError(c, [], 'ana@gmail.com', ctx)).not.toBeNull()
    expect(memberError(c, [], 'a.na+auto@gmail.com', ctx)).not.toBeNull()
    expect(memberError(c, [], 'ana@gmail.com', { ...ctx, ownerEmail: 'Ana@Gmail.com' })).not.toBeNull()
  })

  it('rechaza el mail de un miembro, por uid o por el mail viejo', () => {
    expect(memberError(withUid('caro@gmail.com'), [], 'c.aro@gmail.com', ctx)).not.toBeNull()
    expect(memberError(car(), [], 'beto@gmail.com', ctx)).not.toBeNull()
  })

  it('rechaza un mail con una invitación pendiente, pero no una vencida, rechazada o cancelada', () => {
    expect(memberError(c, [invite()], 'c.aro@gmail.com', ctx)).not.toBeNull()
    expect(memberError(c, [invite({ expiresAt: NOW })], 'caro@gmail.com', ctx)).toBeNull()
    expect(memberError(c, [invite({ status: 'declined' })], 'caro@gmail.com', ctx)).toBeNull()
    expect(memberError(c, [invite({ status: 'revoked' })], 'caro@gmail.com', ctx)).toBeNull()
  })

  it('no cuenta las invitaciones de otros autos', () => {
    expect(memberError(c, [invite({ carId: 'c2' })], 'caro@gmail.com', ctx)).toBeNull()
  })

  it('el tope cuenta los miembros por uid más las invitaciones pendientes que no vencieron', () => {
    const eva = invite({ id: 'c1_eva@gmail.com', email: 'eva@gmail.com', emailKey: 'eva@gmail.com' })
    expect(memberError(withUid('beto@gmail.com'), [], 'dani@gmail.com', ctx)).toBeNull()
    expect(memberError(withUid('beto@gmail.com'), [invite()], 'dani@gmail.com', ctx)).not.toBeNull()
    expect(memberError(c, [invite(), eva], 'dani@gmail.com', ctx)).not.toBeNull()
    expect(memberError(withUid('beto@gmail.com'), [invite({ expiresAt: NOW })], 'dani@gmail.com', ctx)).toBeNull()
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

describe('jobEdit', () => {
  const pending = { status: 'pending' as const, revision: 2 }
  const rejected = { status: 'rejected' as const, revision: 2 }
  const approved = { status: 'approved' as const, revision: 2 }

  it('sin cambios no escribe nada', () => {
    expect(jobEdit(pending, {}, true)).toBeNull()
    expect(jobEdit(approved, {}, false)).toBeNull()
    expect(jobEdit(pending, {}, false)).toBeNull()
  })
  it('el miembro sube la revisión y no manda el estado si ya está pendiente', () => {
    expect(jobEdit(pending, { km: 41_000 }, true)).toEqual({ km: 41_000, revision: 3 })
  })
  it('el miembro vuelve a mandar uno rechazado, aunque no le cambie nada', () => {
    expect(jobEdit(rejected, {}, true)).toEqual({ status: 'pending', revision: 3 })
    expect(jobEdit(rejected, { cost: 5 }, true)).toEqual({ cost: 5, status: 'pending', revision: 3 })
  })
  it('el dueño no toca la revisión de uno aprobado ni el estado', () => {
    expect(jobEdit(approved, { title: 'Aceite' }, false)).toEqual({ title: 'Aceite' })
    expect(jobEdit({ revision: 0 }, { title: 'Aceite' }, false)).toEqual({ title: 'Aceite' })
  })
  it('el dueño que corrige uno sin aprobar sube la revisión y no le cambia el estado', () => {
    expect(jobEdit(pending, { km: 41_000 }, false)).toEqual({ km: 41_000, revision: 3 })
    expect(jobEdit(rejected, { km: 41_000 }, false)).toEqual({ km: 41_000, revision: 3 })
  })
})

describe('reviewAlreadyDone', () => {
  it('aprobar o rechazar dos veces, o desde dos dispositivos, ya está hecho', () => {
    expect(reviewAlreadyDone('approved', 'approved')).toBe(true)
    expect(reviewAlreadyDone('rejected', 'rejected')).toBe(true)
  })
  it('si quedó de otra forma, el trabajo cambió', () => {
    expect(reviewAlreadyDone('approved', 'pending')).toBe(false)
    expect(reviewAlreadyDone('approved', 'rejected')).toBe(false)
    expect(reviewAlreadyDone('rejected', 'approved')).toBe(false)
    expect(reviewAlreadyDone('rejected', 'pending')).toBe(false)
    expect(reviewAlreadyDone('approved', null)).toBe(false)
  })
})
