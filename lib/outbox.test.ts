import { describe, expect, it } from 'vitest'
import type { FuelInput } from './db'
import {
  NOT_SAVED,
  NO_ACCESS,
  OUTBOX_DAYS,
  checkServer,
  deniedReason,
  draftMatches,
  draftSeed,
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

  it('una falla por un cambio en otro dispositivo queda marcada, y un reintento la desmarca', () => {
    const [e] = withFailure([fuelEntry('a')], 'a', 'Cambió', true)
    expect(e.conflict).toBe(true)
    expect(withFailure([e], 'a', 'Sin permiso')[0].conflict).toBeUndefined()
    expect(withEntry([e], fuelEntry('a'))[0].conflict).toBeUndefined()
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

describe('checkServer', () => {
  it('un alta está si el documento existe', () => {
    const e = fuelEntry('a')
    expect(checkServer(e, { ...fuel })).toBe('saved')
    expect(checkServer(e, null)).toBe('not-saved')
  })

  it('una edición está si el servidor tiene los campos que cambió', () => {
    const original = { ...fuel, quantity: 30, total: 37500 }
    const e = fuelEntry('a', {}, original)
    expect(expectedFields(e)).toEqual({ quantity: 40, total: 50000 })
    expect(checkServer(e, { ...fuel, station: 'Shell', createdBy: 'u1' })).toBe('saved')
    expect(checkServer(e, null)).toBe('not-saved')
  })

  it('una edición que el servidor tiene como antes no se guardó: se puede reintentar', () => {
    const original = { ...fuel, quantity: 30, total: 37500 }
    const e = fuelEntry('a', {}, original)
    expect(checkServer(e, { ...original })).toBe('not-saved')
    expect(checkServer(e, { ...original, station: 'Shell' })).toBe('not-saved')
  })

  it('una edición con otro valor en un campo que cambió es de otro dispositivo', () => {
    const original = { ...fuel, quantity: 30, total: 37500 }
    const e = fuelEntry('a', {}, original)
    expect(checkServer(e, { ...fuel, total: 60000 })).toBe('changed')
    expect(checkServer(e, { ...original, quantity: 35 })).toBe('changed')
  })
})

describe('deniedReason', () => {
  it('un alta que no se puede leer no existe, si el auto sigue visible', () => {
    expect(deniedReason(fuelEntry('a'), true)).toBe(NOT_SAVED)
    expect(deniedReason(fuelEntry('a'), false)).toBe(NO_ACCESS)
  })

  it('un auto nuevo nunca está visible: no es falta de acceso', () => {
    const car = outboxEntry({
      id: 'c',
      carId: 'c9',
      carLabel: 'Ford Ka',
      write: { kind: 'car', payload: { recordId: 'c9', data: { brand: 'Ford', model: 'Ka', version: null, year: null, plate: null, fuelTypes: ['nafta'] }, original: null, initialKm: 1000 } },
    })
    expect(deniedReason(car, false)).toBe(NOT_SAVED)
  })

  it('una edición denegada es falta de acceso', () => {
    expect(deniedReason(fuelEntry('a', {}, { ...fuel, total: 1 }), true)).toBe(NO_ACCESS)
  })
})

describe('draftSeed y draftMatches', () => {
  it('al editar, lo de ahora con lo que cambió el borrador encima', () => {
    const original = { ...fuel, quantity: 30, total: 37500 }
    const e = fuelEntry('a', {}, original)
    if (e.kind !== 'fuel') throw new Error()
    const now = { ...original, total: 60000, station: 'Shell' }
    expect(draftSeed(now, e)).toEqual({ ...now, quantity: 40, total: 50000 })
  })

  it('en un alta o si el registro ya no está, los datos del borrador; sin borrador, el registro', () => {
    const e = fuelEntry('a', {}, { ...fuel, total: 1 })
    if (e.kind !== 'fuel') throw new Error()
    expect(draftSeed(undefined, e)).toEqual(fuel)
    expect(draftSeed({ ...fuel, total: 2 }, null)).toEqual({ ...fuel, total: 2 })
  })

  it('el borrador tiene que ser del auto y del registro de la pantalla', () => {
    const e = fuelEntry('a')
    expect(draftMatches(e, 'c1', null)).toBe(true)
    expect(draftMatches(e, 'c1', 'f-a')).toBe(true)
    expect(draftMatches(e, 'c2', null)).toBe(false)
    expect(draftMatches(e, 'c1', 'f-b')).toBe(false)
    expect(draftMatches(e, null, null)).toBe(true)
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
