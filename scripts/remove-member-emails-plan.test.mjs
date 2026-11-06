import { describe, expect, it } from 'vitest'
import { planRemoveMembers } from './remove-member-emails-plan.mjs'

const car = (data = {}) => ({
  id: 'c1',
  data: { brand: 'Ford', model: 'Ka', ownerUid: 'owner', ownerName: 'Ana', memberUids: [], memberProfiles: {}, ...data },
})

const profile = (email, name = null) => ({ email, name })

describe('planRemoveMembers', () => {
  it('borra members si cada mail es el de un miembro por uid', () => {
    const plan = planRemoveMembers({
      car: car({
        members: ['beto@gmail.com', 'caro@empresa.com'],
        memberUids: ['u-beto', 'u-caro'],
        memberProfiles: { 'u-beto': profile('beto@gmail.com', 'Beto'), 'u-caro': profile('caro@empresa.com') },
      }),
      ownerEmail: 'ana@gmail.com',
    })
    expect(plan.carUpdate).toEqual({ path: 'cars/c1' })
    expect(plan.report).toEqual({
      carId: 'c1',
      status: 'remove',
      covered: [
        { mail: 'beto@gmail.com', uid: 'u-beto' },
        { mail: 'caro@empresa.com', uid: 'u-caro' },
      ],
      owner: [],
      missing: [],
    })
  })

  it('compara con el mail canónico: en Gmail, sin puntos ni "+algo"', () => {
    const plan = planRemoveMembers({
      car: car({ members: ['j.doe+auto@googlemail.com'], memberUids: ['u1'], memberProfiles: { u1: profile('jdoe@gmail.com') } }),
      ownerEmail: null,
    })
    expect(plan.carUpdate).toEqual({ path: 'cars/c1' })
    expect(plan.report.covered).toEqual([{ mail: 'j.doe+auto@googlemail.com', uid: 'u1' }])
  })

  it('el mail del dueño no frena el borrado', () => {
    const plan = planRemoveMembers({ car: car({ members: ['a.na@gmail.com'] }), ownerEmail: 'Ana@Gmail.com' })
    expect(plan.carUpdate).toEqual({ path: 'cars/c1' })
    expect(plan.report).toMatchObject({ status: 'remove', owner: ['a.na@gmail.com'], missing: [] })
  })

  it('si un mail no tiene uid, no toca el auto y lo informa', () => {
    const plan = planRemoveMembers({
      car: car({ members: ['beto@gmail.com', 'dani@gmail.com'], memberUids: ['u-beto'], memberProfiles: { 'u-beto': profile('beto@gmail.com') } }),
      ownerEmail: 'ana@gmail.com',
    })
    expect(plan.carUpdate).toBeNull()
    expect(plan.report).toMatchObject({ status: 'keep', covered: [{ mail: 'beto@gmail.com', uid: 'u-beto' }], missing: ['dani@gmail.com'] })
  })

  it('un perfil de un uid que ya no está en memberUids no cuenta', () => {
    const plan = planRemoveMembers({
      car: car({ members: ['beto@gmail.com'], memberUids: [], memberProfiles: { 'u-beto': profile('beto@gmail.com') } }),
      ownerEmail: null,
    })
    expect(plan.carUpdate).toBeNull()
    expect(plan.report.missing).toEqual(['beto@gmail.com'])
  })

  it('sin memberUids ni memberProfiles (auto viejo), un mail no tiene uid', () => {
    const plan = planRemoveMembers({ car: { id: 'c1', data: { ownerUid: 'owner', members: ['beto@gmail.com'] } }, ownerEmail: null })
    expect(plan.carUpdate).toBeNull()
    expect(plan.report.status).toBe('keep')
  })

  it('members vacío, o con algo que no es texto, se borra', () => {
    expect(planRemoveMembers({ car: car({ members: [] }), ownerEmail: null }).carUpdate).toEqual({ path: 'cars/c1' })
    expect(planRemoveMembers({ car: car({ members: null }), ownerEmail: null }).carUpdate).toEqual({ path: 'cars/c1' })
    expect(planRemoveMembers({ car: car({ members: [42] }), ownerEmail: null }).carUpdate).toEqual({ path: 'cars/c1' })
  })

  it('un auto sin el campo members no cambia: se puede volver a correr', () => {
    const plan = planRemoveMembers({ car: car(), ownerEmail: null })
    expect(plan).toEqual({ carUpdate: null, report: { carId: 'c1', status: 'none', covered: [], owner: [], missing: [] } })
  })
})
