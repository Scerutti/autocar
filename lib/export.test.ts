import { describe, expect, it } from 'vitest'
import { buildExportCsvs, buildExportJson, buildExportZip, CSV_BOM, csvCell, exportCarLabel, exportFileName, toCsv, type ExportInput } from './export'
import { DEFAULT_SETTINGS, type Car, type FuelLoad, type Invite, type Job, type MaintenanceRule, type OdometerReading } from './types'

const ME = 'me-uid'
const OTHER = 'other-uid'

const car = (extra: Partial<Car> = {}): Car => ({
  id: 'c1',
  brand: 'Fiat',
  model: 'Cronos',
  version: '1.3',
  year: 2020,
  plate: 'AB123CD',
  fuelTypes: ['nafta', 'gnc'],
  currentKm: 45000,
  kmUpdatedAt: new Date('2026-09-01T12:00:00Z'),
  avgKmPerDay: 32.5,
  photoUrl: null,
  photoPublicId: null,
  createdAt: new Date('2026-01-01T12:00:00Z'),
  ownerUid: ME,
  ownerName: 'Ana',
  memberUids: [OTHER],
  memberProfiles: { [OTHER]: { email: 'beto@gmail.com', name: 'Beto' } },
  ...extra,
})

const rule: MaintenanceRule = {
  id: 'r1',
  carId: 'c1',
  name: 'Service',
  intervalKm: 10000,
  intervalTime: { amount: 1, unit: 'year' },
  repeat: true,
  baseKm: 30000,
  baseDate: '2025-09-01',
  lastDoneKm: 40000,
  lastDoneKmEstimated: false,
  lastDoneDate: '2026-03-01',
  lastDoneJobId: 'j1',
  completedByJobId: null,
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
}

const job = (extra: Partial<Job> = {}): Job => ({
  id: 'j1',
  carId: 'c1',
  date: '2026-03-01',
  km: 40000,
  title: 'Service; aceite "sintético"',
  category: 'service',
  cost: 85000.5,
  workshop: 'Taller\nNorte',
  notes: '=1+1',
  ruleIds: ['r1'],
  status: 'approved',
  revision: 0,
  createdBy: OTHER,
  createdByName: null,
  createdAt: new Date('2026-03-01T15:00:00Z'),
  ...extra,
})

const load: FuelLoad = {
  id: 'f1',
  carId: 'c1',
  date: '2026-09-01',
  km: 45000,
  fuelType: 'gnc',
  grade: null,
  quantity: 12.4,
  unitPrice: 600,
  total: 7440,
  fullTank: true,
  station: null,
  createdBy: ME,
  createdByName: 'Ana',
  createdAt: new Date('2026-09-01T12:00:00Z'),
}

const reading: OdometerReading = {
  id: 'fuel-f1',
  carId: 'c1',
  km: 45000,
  date: new Date('2026-09-01T12:00:00Z'),
  source: 'fuel',
  sourceId: 'f1',
  createdBy: ME,
  createdByName: 'Ana',
  createdAt: null,
}

const invite = (extra: Partial<Invite> = {}): Invite => ({
  id: 'c1_beto@gmail.com',
  carId: 'c1',
  ownerUid: ME,
  ownerName: 'Ana',
  carLabel: 'Fiat Cronos 2020',
  email: 'beto@gmail.com',
  emailKey: 'beto@gmail.com',
  status: 'accepted',
  createdAt: new Date('2026-02-01T12:00:00Z'),
  expiresAt: new Date('2026-02-15T12:00:00Z'),
  respondedAt: new Date('2026-02-02T12:00:00Z'),
  acceptedUid: OTHER,
  ...extra,
})

const input = (extra: Partial<ExportInput> = {}): ExportInput => ({
  uid: ME,
  email: 'ana@gmail.com',
  settings: DEFAULT_SETTINGS,
  cars: [car()],
  rules: [rule],
  jobs: [job()],
  fuel: [load],
  odometer: [reading],
  achievements: [{ id: 'primer-auto', carId: 'c1', unlockedAt: new Date('2026-01-01T12:00:00Z'), celebratedAt: null }],
  invites: [invite()],
  myInvites: [invite({ id: 'c9_ana@gmail.com', carId: 'c9', ownerUid: OTHER, ownerName: 'Carla', carLabel: 'VW Gol', email: 'ana@gmail.com', status: 'pending', respondedAt: null, acceptedUid: null })],
  ...extra,
})

/** Las filas de una planilla, sin la marca UTF-8, separadas en celdas (sólo para planillas sin `;` adentro de una celda). */
const rows = (csv: string) =>
  csv
    .slice(CSV_BOM.length)
    .split('\r\n')
    .filter(Boolean)
    .map(line => line.split(';'))

describe('csvCell', () => {
  it('escribe vacío, números con coma decimal, booleanos y fechas ISO', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(85000.5)).toBe('85000,5')
    expect(csvCell(42)).toBe('42')
    expect(csvCell(Number.NaN)).toBe('')
    expect(csvCell(true)).toBe('sí')
    expect(csvCell(false)).toBe('no')
    expect(csvCell(new Date('2026-03-01T15:00:00Z'))).toBe('2026-03-01T15:00:00.000Z')
    expect(csvCell('2026-03-01')).toBe('2026-03-01')
  })

  it('pone entre comillas lo que tiene el separador, comillas, saltos de línea o espacios en los bordes', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""')
    expect(csvCell('Taller\nNorte')).toBe('"Taller\nNorte"')
    expect(csvCell(' Norte')).toBe('" Norte"')
    expect(csvCell('Ford, Ka')).toBe('Ford, Ka')
  })

  it('no deja que un texto se lea como fórmula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+54 11')).toBe("'+54 11")
    expect(csvCell('-cambio')).toBe("'-cambio")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(-5)).toBe('-5')
  })
})

describe('toCsv', () => {
  it('empieza con la marca UTF-8 y separa las filas con \\r\\n', () => {
    expect(toCsv(['Año', 'Km'], [[2020, 1500.5]])).toBe(`${CSV_BOM}Año;Km\r\n2020;1500,5\r\n`)
  })
})

describe('exportCarLabel', () => {
  it('arma el nombre del auto con la patente', () => {
    expect(exportCarLabel(car())).toBe('Fiat Cronos 1.3 2020 (AB123CD)')
    expect(exportCarLabel(car({ version: null, year: null, plate: null }))).toBe('Fiat Cronos')
    expect(exportCarLabel(undefined)).toBe('')
  })
})

describe('buildExportJson', () => {
  it('tiene todos los datos, la cuenta y las invitaciones separadas', () => {
    const json = JSON.parse(buildExportJson(input(), new Date('2026-11-06T12:00:00Z')))
    expect(json.exportedAt).toBe('2026-11-06T12:00:00.000Z')
    expect(json.account).toEqual({ uid: ME, email: 'ana@gmail.com' })
    expect(json.cars).toHaveLength(1)
    expect(json.cars[0].createdAt).toBe('2026-01-01T12:00:00.000Z')
    expect(json.rules[0].name).toBe('Service')
    expect(json.jobs[0].cost).toBe(85000.5)
    expect(json.fuel).toHaveLength(1)
    expect(json.odometer).toHaveLength(1)
    expect(json.achievements).toHaveLength(1)
    expect(json.invites.sent).toHaveLength(1)
    expect(json.invites.received).toHaveLength(1)
    expect(json.settings.timezone).toBe(DEFAULT_SETTINGS.timezone)
  })
})

describe('buildExportCsvs', () => {
  const files = buildExportCsvs(input())
  const byName = new Map(files.map(f => [f.name, f.content]))

  it('arma una planilla por colección, todas con la marca UTF-8', () => {
    expect(files.map(f => f.name)).toEqual(['autos.csv', 'mantenimientos.csv', 'trabajos.csv', 'cargas.csv', 'km.csv', 'logros.csv', 'invitaciones.csv'])
    expect(files.every(f => f.content.startsWith(CSV_BOM))).toBe(true)
  })

  it('autos: combustibles, km, si es mío y los miembros', () => {
    const [header, row] = rows(byName.get('autos.csv')!)
    const cell = (name: string) => row[header.indexOf(name)]
    expect(cell('Patente')).toBe('AB123CD')
    expect(cell('Combustibles')).toBe('Nafta + GNC')
    expect(cell('Km por día')).toBe('32,5')
    expect(cell('Es mío')).toBe('sí')
    expect(cell('Miembros')).toBe('Beto <beto@gmail.com>')
  })

  it('mantenimientos: intervalo legible y si está cumplido', () => {
    const [header, row] = rows(byName.get('mantenimientos.csv')!)
    const cell = (name: string) => row[header.indexOf(name)]
    expect(cell('Auto')).toBe('Fiat Cronos 1.3 2020 (AB123CD)')
    expect(cell('Cada tiempo')).toBe('1 año')
    expect(cell('Cumplido')).toBe('no')
  })

  it('trabajos: escapa los textos y dice quién lo cargó', () => {
    const csv = byName.get('trabajos.csv')!
    expect(csv).toContain('"Service; aceite ""sintético"""')
    expect(csv).toContain('"Taller\nNorte"')
    expect(csv).toContain("'=1+1")
    expect(csv).toContain('85000,5')
    expect(csv).toContain(';Service;Aprobado;otra persona;')
  })

  it('cargas y km: unidad, origen y "vos" en lo propio', () => {
    const [fuelHeader, fuelRow] = rows(byName.get('cargas.csv')!)
    expect(fuelRow[fuelHeader.indexOf('Unidad')]).toBe('m³')
    expect(fuelRow[fuelHeader.indexOf('Calidad')]).toBe('')
    expect(fuelRow[fuelHeader.indexOf('Cargado por')]).toBe('vos')
    const [kmHeader, kmRow] = rows(byName.get('km.csv')!)
    expect(kmRow[kmHeader.indexOf('Origen')]).toBe('Carga de combustible')
    expect(kmRow[kmHeader.indexOf('Creado')]).toBe('')
  })

  it('invitaciones: las enviadas y las recibidas, sin repetir', () => {
    const lines = rows(byName.get('invitaciones.csv')!)
    expect(lines).toHaveLength(3)
    expect(lines[1][1]).toBe('Enviada')
    expect(lines[2][1]).toBe('Recibida')
    expect(lines[2][5]).toBe('Pendiente')
    const dup = buildExportCsvs(input({ myInvites: [invite()] })).find(f => f.name === 'invitaciones.csv')!
    expect(rows(dup.content)).toHaveLength(2)
  })

  it('sin datos, sólo los encabezados', () => {
    const empty = buildExportCsvs(input({ cars: [], rules: [], jobs: [], fuel: [], odometer: [], achievements: [], invites: [], myInvites: [] }))
    expect(empty.every(f => rows(f.content).length === 1)).toBe(true)
  })
})

describe('buildExportZip', () => {
  it('es un zip con el JSON y las planillas', () => {
    const zip = buildExportZip(input(), new Date('2026-11-06T12:00:00Z'))
    const text = new TextDecoder().decode(zip)
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50)
    for (const name of ['datos.json', 'autos.csv', 'mantenimientos.csv', 'trabajos.csv', 'cargas.csv', 'km.csv', 'logros.csv', 'invitaciones.csv']) {
      expect(text).toContain(name)
    }
  })

  it('se llama con la fecha del día', () => {
    expect(exportFileName('2026-11-06')).toBe('autocar-datos-2026-11-06.zip')
  })
})
