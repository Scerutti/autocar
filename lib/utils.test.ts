import { describe, expect, it } from 'vitest'
import { changedFields, isUnchanged, safeNextPath } from './utils'

const origin = 'https://autocar.test'

describe('safeNextPath', () => {
  it('deja pasar las rutas de la app', () => {
    expect(safeNextPath('/autos/abc?tab=km', origin)).toBe('/autos/abc?tab=km')
    expect(safeNextPath('/ajustes', origin)).toBe('/ajustes')
  })
  it('no redirige a otros sitios', () => {
    expect(safeNextPath('https://evil.test/login', origin)).toBe('/')
    expect(safeNextPath('//evil.test', origin)).toBe('/')
    expect(safeNextPath('/\\evil.test', origin)).toBe('/')
    expect(safeNextPath('javascript:alert(1)', origin)).toBe('/')
  })
  it('sin next vuelve al inicio', () => {
    expect(safeNextPath(null, origin)).toBe('/')
    expect(safeNextPath('', origin)).toBe('/')
  })
})

describe('changedFields', () => {
  it('devuelve sólo los primitivos que cambiaron', () => {
    const original = { title: 'Service', cost: 1000, km: 40_000, fullTank: true }
    expect(changedFields(original, { title: 'Service', cost: 1200, km: 40_000, fullTank: false })).toEqual({ cost: 1200, fullTank: false })
  })
  it('sin cambios devuelve vacío', () => {
    const original = { title: 'Service', cost: 1000 }
    const changes = changedFields(original, { ...original })
    expect(changes).toEqual({})
    expect(isUnchanged(changes)).toBe(true)
  })
  it('null y undefined cuentan igual', () => {
    expect(changedFields<{ km?: number | null }>({ km: undefined }, { km: null })).toEqual({})
    expect(changedFields<{ km?: number | null }>({}, { km: null })).toEqual({})
    expect(changedFields<{ km: number | null }>({ km: null }, { km: 0 })).toEqual({ km: 0 })
    expect(changedFields<{ km: number | null }>({ km: 0 }, { km: null })).toEqual({ km: null })
  })
  it('compara los mapas por contenido', () => {
    type Rule = { intervalTime: { amount: number; unit: string } | null }
    const original: Rule = { intervalTime: { amount: 6, unit: 'month' } }
    expect(changedFields<Rule>(original, { intervalTime: { unit: 'month', amount: 6 } })).toEqual({})
    expect(changedFields<Rule>(original, { intervalTime: { amount: 1, unit: 'year' } })).toEqual({ intervalTime: { amount: 1, unit: 'year' } })
    expect(changedFields<Rule>(original, { intervalTime: null })).toEqual({ intervalTime: null })
    expect(changedFields<Rule>({ intervalTime: null }, original)).toEqual(original)
  })
  it('compara las listas por elemento y en orden', () => {
    const original = { ruleIds: ['s', 'vtv'], fuelTypes: ['nafta', 'gnc'] }
    expect(changedFields(original, { ruleIds: ['s', 'vtv'], fuelTypes: ['nafta', 'gnc'] })).toEqual({})
    expect(changedFields(original, { ruleIds: ['s'], fuelTypes: ['nafta', 'gnc'] })).toEqual({ ruleIds: ['s'] })
    expect(changedFields(original, { ruleIds: ['s', 'vtv'], fuelTypes: ['nafta'] })).toEqual({ fuelTypes: ['nafta'] })
    expect(changedFields(original, { ruleIds: ['vtv', 's'], fuelTypes: ['nafta', 'gnc'] })).toEqual({ ruleIds: ['vtv', 's'] })
    expect(changedFields<{ ruleIds: string[] }>({ ruleIds: [] }, { ruleIds: [] })).toEqual({})
  })
  it('sólo mira las claves del borrador', () => {
    const original = { id: 'j1', title: 'Service', createdBy: 'u1' }
    expect(changedFields<{ title: string }>(original, { title: 'Aceite' })).toEqual({ title: 'Aceite' })
  })
})
