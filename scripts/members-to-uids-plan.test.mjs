import { describe, expect, it } from 'vitest'
import { canonicalEmail, planCarMembers } from './members-to-uids-plan.mjs'

const NOW = new Date('2026-10-30T12:00:00Z')

const car = (data = {}) => ({
  id: 'c1',
  data: { brand: 'Ford', model: 'Ka', year: 2015, ownerUid: 'owner', ownerName: 'Ana', members: [], ...data },
})

const found = (uid, name = null) => ({ status: 'found', uid, name })
const missing = { status: 'missing' }

/** El auto después de escribir (para simular una segunda corrida). */
const applied = (c, plan) => (plan.carUpdate ? { id: c.id, data: { ...c.data, ...plan.carUpdate.data } } : c)

describe('planCarMembers', () => {
  it('un mail con cuenta pasa a memberUids con su perfil y queda en members', () => {
    const plan = planCarMembers({
      car: car({ members: ['beto@gmail.com'] }),
      accounts: { 'beto@gmail.com': found('u-beto', 'Beto') },
      invites: [],
      now: NOW,
    })
    expect(plan.carUpdate).toEqual({
      path: 'cars/c1',
      data: {
        members: ['beto@gmail.com'],
        memberUids: ['u-beto'],
        memberProfiles: { 'u-beto': { email: 'beto@gmail.com', name: 'Beto' } },
      },
    })
    expect(plan.inviteCreates).toEqual([])
    expect(plan.report).toMatchObject({ migrated: ['beto@gmail.com'], invited: [], ambiguous: [] })
  })

  it('un mail sin cuenta pasa a ser una invitación pendiente y sale de members', () => {
    const plan = planCarMembers({
      car: car({ members: ['j.doe@gmail.com'] }),
      accounts: { 'j.doe@gmail.com': missing },
      invites: [],
      now: NOW,
    })
    expect(plan.carUpdate?.data).toEqual({ members: [], memberUids: [], memberProfiles: {} })
    expect(plan.inviteCreates).toEqual([
      {
        path: 'invites/c1_jdoe@gmail.com',
        data: {
          carId: 'c1',
          ownerUid: 'owner',
          ownerName: 'Ana',
          carLabel: 'Ford Ka 2015',
          email: 'j.doe@gmail.com',
          emailKey: 'jdoe@gmail.com',
          status: 'pending',
          createdAt: NOW,
          expiresAt: new Date('2026-11-13T12:00:00Z'),
          respondedAt: null,
          acceptedUid: null,
        },
      },
    ])
    expect(plan.report).toMatchObject({ migrated: [], invited: ['j.doe@gmail.com'] })
  })

  it('si la invitación ya existe no la pisa, pero igual saca el mail', () => {
    const plan = planCarMembers({
      car: car({ members: ['caro@gmail.com'] }),
      accounts: { 'caro@gmail.com': missing },
      invites: ['c1_caro@gmail.com'],
      now: NOW,
    })
    expect(plan.inviteCreates).toEqual([])
    expect(plan.carUpdate?.data.members).toEqual([])
  })

  it('informa como ambiguos la cuenta del dueño, una lectura que falló y el tope de miembros, y no los toca', () => {
    const plan = planCarMembers({
      car: car({
        members: ['ana@gmail.com', 'raro@gmail.com', 'dani@gmail.com'],
        memberUids: ['u1', 'u2'],
        memberProfiles: { u1: { email: 'x@gmail.com', name: null }, u2: { email: 'y@gmail.com', name: null } },
      }),
      accounts: {
        'ana@gmail.com': found('owner'),
        'raro@gmail.com': { status: 'error', message: 'timeout' },
        'dani@gmail.com': found('u-dani'),
      },
      invites: [],
      now: NOW,
    })
    expect(plan.carUpdate).toBeNull()
    expect(plan.inviteCreates).toEqual([])
    expect(plan.report.ambiguous.map(a => a.mail)).toEqual(['ana@gmail.com', 'raro@gmail.com', 'dani@gmail.com'])
  })

  it('conserva los miembros por uid que ya había', () => {
    const plan = planCarMembers({
      car: car({ members: ['beto@gmail.com'], memberUids: ['u1'], memberProfiles: { u1: { email: 'x@gmail.com', name: 'X' } } }),
      accounts: { 'beto@gmail.com': found('u-beto') },
      invites: [],
      now: NOW,
    })
    expect(plan.carUpdate?.data.memberUids).toEqual(['u1', 'u-beto'])
    expect(plan.carUpdate?.data.memberProfiles).toEqual({
      u1: { email: 'x@gmail.com', name: 'X' },
      'u-beto': { email: 'beto@gmail.com', name: null },
    })
  })

  it('un auto sin members no cambia', () => {
    const plan = planCarMembers({ car: car({ members: undefined }), accounts: {}, invites: [], now: NOW })
    expect(plan).toEqual({ carUpdate: null, inviteCreates: [], report: { carId: 'c1', migrated: [], invited: [], skipped: [], ambiguous: [] } })
  })

  it('se puede volver a correr: la segunda vez no escribe nada', () => {
    const c = car({ members: ['beto@gmail.com', 'caro@gmail.com'] })
    const accounts = { 'beto@gmail.com': found('u-beto'), 'caro@gmail.com': missing }
    const first = planCarMembers({ car: c, accounts, invites: [], now: NOW })
    const second = planCarMembers({
      car: applied(c, first),
      accounts,
      invites: first.inviteCreates.map(w => w.path.slice('invites/'.length)),
      now: NOW,
    })
    expect(second.carUpdate).toBeNull()
    expect(second.inviteCreates).toEqual([])
    expect(second.report).toMatchObject({ migrated: [], invited: [], skipped: ['beto@gmail.com'] })
  })
})

describe('canonicalEmail', () => {
  it('calcula lo mismo que lib/sharing.ts', () => {
    expect(canonicalEmail('J.Doe+auto@GoogleMail.com')).toBe('jdoe@gmail.com')
    expect(canonicalEmail('j.doe+auto@hotmail.com')).toBe('j.doe+auto@hotmail.com')
  })
})
