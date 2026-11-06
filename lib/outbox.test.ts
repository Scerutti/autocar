import { describe, expect, it } from 'vitest'
import type { FuelInput } from './db'
import {
  OUTBOX_DAYS,
  expectedFields,
  isEdit,
  originalFields,
  outboxDocPath,
  outboxEditHref,
  outboxEntry,
  outboxKey,
  outboxSummary,
  parseOutbox,
  serializeOutbox,
  serverHasWrite,
  visiblePending,
  withEntry,
  withFailure,
  withoutEntry,
  withoutExpired,
  type OutboxEntry,
} from './outbox'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 5, 12)

const fuel: FuelInput = {
  carId: 'c1',
  date: '2026-11-05',
  km: 48300,
  fuelType: 'nafta',
  grade: 'super',
  quantity: 40,
  unitPrice: 1250,
  total: 50000,
  fullTank: true,
  station: 'YPF',
}

function fuelEntry(id: string, over: Partial<OutboxEntry> = {}, original: FuelInput | null = null): OutboxEntry {
  return {
    ...outboxEntry({
      id,
      carId: 'c1',
      carLabel: 'Ford Focus',
      now: NOW,
      write: { kind: 'fuel', payload: { recordId: `f-${id}`, data: fuel, original } },
    }),
    ...over,
  } as OutboxEntry
}

describe('outboxKey', () => {
  it('es una clave por cuenta', () => {
    expect(outboxKey('u1')).toBe('autocar:outbox:u1')
    expect(outboxKey('u1')).not.toBe(outboxKey('u2'))
  })
})

describe('outboxEntry', () => {
  it('arranca pendiente, con la fecha y el texto de lo que se guardó', () => {
    const e = fuelEntry('a')
    expect(e.state).toBe('pending')
    expect(e.createdAt).toBe(NOW)
    expect(e.label).toContain('Carga de Nafta')
    expect(e.label).toContain('40 L')
    expect(isEdit(e)).toBe(false)
  })
})

describe('alta, confirmación y falla', () => {
  it('agrega una entrada nueva al final', () => {
    const list = withEntry([fuelEntry('a')], fuelEntry('b'))
    expect(list.map(e => e.id)).toEqual(['a', 'b'])
  })

  it('reemplaza la misma entrada (reintento o borrador) y la vuelve a pendiente sin el error', () => {
    const failed = withFailure([fuelEntry('a')], 'a', 'Sin permiso')
    const again = withEntry(failed, fuelEntry('a'))
    expect(again).toHaveLength(1)
    expect(again[0].state).toBe('pending')
    expect(again[0].error).toBeUndefined()
  })

  it('al confirmarse se borra', () => {
    expect(withoutEntry([fuelEntry('a'), fuelEntry('b')], 'a').map(e => e.id)).toEqual(['b'])
  })

  it('al fallar queda con el motivo', () => {
    const [e] = withFailure([fuelEntry('a')], 'a', 'Sin permiso')
    expect(e.state).toBe('failed')
    expect(e.error).toBe('Sin permiso')
  })

  it('una falla de una entrada descartada no la vuelve a agregar', () => {
    expect(withFailure([fuelEntry('b')], 'a', 'Sin permiso').map(e => e.id)).toEqual(['b'])
  })
})

describe('vencimiento', () => {
  it(`borra las de hace más de ${OUTBOX_DAYS} días`, () => {
    const old = fuelEntry('old', { createdAt: NOW - (OUTBOX_DAYS + 1) * DAY })
    const recent = fuelEntry('recent', { createdAt: NOW - (OUTBOX_DAYS - 1) * DAY })
    expect(withoutExpired([old, recent], NOW).map(e => e.id)).toEqual(['recent'])
  })
})

describe('parseOutbox y serializeOutbox', () => {
  it('ida y vuelta', () => {
    const list = [fuelEntry('a'), withFailure([fuelEntry('b')], 'b', 'x')[0]]
    expect(parseOutbox(serializeOutbox(list))).toEqual(list)
  })

  it('sin entradas borra la clave', () => {
    expect(serializeOutbox([])).toBeNull()
  })

  it('descarta lo que no se puede leer', () => {
    expect(parseOutbox(null)).toEqual([])
    expect(parseOutbox('no es json')).toEqual([])
    expect(parseOutbox('{"id":"a"}')).toEqual([])
    expect(parseOutbox(JSON.stringify([{ id: 'a', kind: 'otro' }, fuelEntry('b')])).map(e => e.id)).toEqual(['b'])
  })
})

describe('serverHasWrite', () => {
  it('un alta está si el documento existe', () => {
    const e = fuelEntry('a')
    expect(serverHasWrite(e, { ...fuel })).toBe(true)
    expect(serverHasWrite(e, null)).toBe(false)
  })

  it('una edición está si el servidor tiene los campos que cambió', () => {
    const original = { ...fuel, quantity: 30, total: 37500 }
    const e = fuelEntry('a', {}, original)
    expect(expectedFields(e)).toEqual({ quantity: 40, total: 50000 })
    expect(serverHasWrite(e, { ...fuel, station: 'Shell', createdBy: 'u1' })).toBe(true)
    expect(serverHasWrite(e, { ...original })).toBe(false)
    expect(serverHasWrite(e, null)).toBe(false)
  })
})

describe('visiblePending y outboxSummary', () => {
  it('muestra sólo las pendientes que pasaron la espera', () => {
    const young = fuelEntry('young', { createdAt: NOW - 1000 })
    const old = fuelEntry('old', { createdAt: NOW - 5000 })
    const failed = fuelEntry('failed', { createdAt: NOW - 5000, state: 'failed' })
    expect(visiblePending([young, old, failed], NOW, 2500).map(e => e.id)).toEqual(['old'])
  })

  it('cuenta por tipo o, si se mezclan, como cambios', () => {
    expect(outboxSummary([])).toBeNull()
    expect(outboxSummary([fuelEntry('a')])).toBe('1 carga sin sincronizar')
    expect(outboxSummary([fuelEntry('a'), fuelEntry('b')])).toBe('2 cargas sin sincronizar')
    const km = outboxEntry({ id: 'k', carId: 'c1', carLabel: '', write: { kind: 'km', payload: { recordId: 'r', data: { km: 1, date: '2026-11-05' }, original: null } } })
    expect(outboxSummary([fuelEntry('a'), km])).toBe('2 cambios sin sincronizar')
  })
})

describe('outboxDocPath y outboxEditHref', () => {
  it('el documento de cada tipo', () => {
    expect(outboxDocPath(fuelEntry('a'))).toEqual(['cars', 'c1', 'fuel', 'f-a'])
    const car = outboxEntry({
      id: 'c',
      carId: 'c9',
      carLabel: 'Fiat Uno',
      write: {
        kind: 'car',
        payload: { recordId: 'c9', data: { brand: 'Fiat', model: 'Uno', version: null, year: null, plate: null, fuelTypes: ['nafta'] }, original: null, initialKm: 1000 },
      },
    })
    expect(outboxDocPath(car)).toEqual(['cars', 'c9'])
    expect(outboxEditHref(car, false)).toBe('/autos/nuevo?borrador=c')
  })

  it('un alta abre el formulario de alta; una edición, el registro si todavía existe', () => {
    expect(outboxEditHref(fuelEntry('a'), true)).toBe('/autos/c1/combustible/nuevo?borrador=a')
    const edit = fuelEntry('a', {}, fuel)
    expect(outboxEditHref(edit, true)).toBe('/autos/c1/combustible/f-a?borrador=a')
    expect(outboxEditHref(edit, false)).toBe('/autos/c1/combustible/nuevo?borrador=a')
  })
})

describe('originalFields', () => {
  it('toma del registro los campos del borrador, lo que falta como null', () => {
    const record = { id: 'f1', createdAt: new Date(0), ...fuel, station: undefined }
    expect(originalFields(record, fuel)).toEqual({ ...fuel, station: null })
  })
})
