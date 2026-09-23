import { describe, expect, it } from 'vitest'
import { safeNextPath } from './utils'

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
