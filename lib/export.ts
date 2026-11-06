import { ACHIEVEMENT_BY_ID } from './achievements'
import { formatInterval } from './format'
import { authorLabel, carMembers } from './sharing'
import {
  FUEL_GRADE_LABELS,
  FUEL_LABELS,
  FUEL_UNITS,
  JOB_CATEGORY_LABELS,
  type AchievementRecord,
  type Car,
  type FuelLoad,
  type Invite,
  type Job,
  type MaintenanceRule,
  type OdometerReading,
  type UserSettings,
} from './types'
import { zipFiles } from './zip'

/** Lo que se exporta: lo que la app ya tiene en memoria (`useData()`), más la cuenta. */
export interface ExportInput {
  uid: string
  email: string | null
  settings: UserSettings
  cars: Car[]
  rules: MaintenanceRule[]
  jobs: Job[]
  fuel: FuelLoad[]
  odometer: OdometerReading[]
  achievements: AchievementRecord[]
  /** Las invitaciones que mandé como dueño. */
  invites: Invite[]
  /** Las invitaciones pendientes para mi mail. */
  myInvites: Invite[]
}

/** Un archivo de texto del export. */
export interface ExportFile {
  name: string
  content: string
}

/** Separador de las planillas: `;`, el que espera Excel con la configuración regional de Argentina. */
export const CSV_SEPARATOR = ';'

/** Marca de orden de bytes: sin ella Excel abre el UTF-8 como Latin-1 y rompe los acentos. */
export const CSV_BOM = '﻿'

/** Una celda que empieza con estos caracteres es una fórmula para la planilla: se le antepone un apóstrofo. */
const FORMULA_START = /^[=+\-@\t\r]/

/** Cuándo una celda va entre comillas: si tiene el separador, comillas, saltos de línea o espacios en los bordes. */
const NEEDS_QUOTES = /[";\r\n]|^\s|\s$/

/**
 * Una celda del CSV. Vacía para null o undefined; las fechas `Date`, en ISO 8601 (UTC); los números, con coma decimal
 * y sin separador de miles (como los lee Excel en es-AR); los booleanos, "sí" o "no". Un texto que empieza como una
 * fórmula (`=`, `+`, `-`, `@`) se escribe con un apóstrofo adelante, así un título cargado por otra persona no se
 * ejecuta al abrir la planilla.
 */
export function csvCell(value: unknown): string {
  if (value == null) return ''
  let text: string
  if (value instanceof Date) text = Number.isNaN(value.getTime()) ? '' : value.toISOString()
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value).replace('.', ',') : ''
  else if (typeof value === 'boolean') text = value ? 'sí' : 'no'
  else {
    text = String(value)
    if (FORMULA_START.test(text)) text = `'${text}`
  }
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Una planilla: la fila de encabezados y una fila por registro, con `\r\n` y la marca UTF-8 al principio. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map(row => row.map(csvCell).join(CSV_SEPARATOR))
  return CSV_BOM + lines.join('\r\n') + '\r\n'
}

/** "Ford Ka 1.5 2015 (AB123CD)": el auto como se muestra en las planillas. */
export function exportCarLabel(car: Pick<Car, 'brand' | 'model' | 'version' | 'year' | 'plate'> | undefined) {
  if (!car) return ''
  const name = [car.brand, car.model, car.version, car.year].filter(Boolean).join(' ')
  return car.plate ? `${name} (${car.plate})` : name
}

const STATUS_LABELS: Record<NonNullable<Job['status']>, string> = {
  approved: 'Aprobado',
  pending: 'Esperando aprobación',
  rejected: 'Rechazado',
}

const INVITE_STATUS_LABELS: Record<Invite['status'], string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  declined: 'Rechazada',
  revoked: 'Cancelada',
}

const SOURCE_LABELS: Record<OdometerReading['source'], string> = {
  initial: 'Alta del auto',
  manual: 'Carga de km',
  job: 'Trabajo',
  fuel: 'Carga de combustible',
}

/**
 * Las invitaciones de la cuenta sin repetir: las que mandé y las que recibí (una invitación que me mandé no existe,
 * las reglas no la dejan crear, pero por las dudas cuenta una vez).
 */
function allInvites(input: ExportInput): { invite: Invite; sent: boolean }[] {
  const seen = new Set<string>()
  const out: { invite: Invite; sent: boolean }[] = []
  for (const invite of input.invites) {
    seen.add(invite.id)
    out.push({ invite, sent: true })
  }
  for (const invite of input.myInvites) if (!seen.has(invite.id)) out.push({ invite, sent: false })
  return out
}

/**
 * El export completo en JSON: todos los datos como los usa la app (las fechas `Date`, en ISO 8601), con la fecha del
 * export y la cuenta. Las invitaciones van separadas en enviadas y recibidas.
 */
export function buildExportJson(input: ExportInput, now: Date): string {
  const data = {
    app: 'AutoCar',
    exportedAt: now,
    account: { uid: input.uid, email: input.email },
    settings: input.settings,
    cars: input.cars,
    rules: input.rules,
    jobs: input.jobs,
    fuel: input.fuel,
    odometer: input.odometer,
    achievements: input.achievements,
    invites: { sent: input.invites, received: input.myInvites },
  }
  return JSON.stringify(data, null, 2)
}

/**
 * Una planilla por colección, con encabezados en castellano: autos, mantenimientos, trabajos, cargas de combustible,
 * lecturas de km, logros e invitaciones. Cada registro de un auto lleva el nombre del auto y quién lo cargó
 * (`authorLabel`: "vos", el nombre, u "otra persona").
 */
export function buildExportCsvs(input: ExportInput): ExportFile[] {
  const carById = new Map(input.cars.map(c => [c.id, c]))
  const carOf = (carId: string) => exportCarLabel(carById.get(carId))
  const author = (record: { carId: string; createdBy?: string | null; createdByName?: string | null }) => {
    const car = carById.get(record.carId)
    return car ? authorLabel(record, car, input.uid) : (record.createdByName ?? '')
  }
  const ruleNames = new Map(input.rules.map(r => [r.id, r.name]))

  const cars = toCsv(
    ['Id', 'Marca', 'Modelo', 'Versión', 'Año', 'Patente', 'Combustibles', 'Km actual', 'Km actualizado', 'Km por día', 'Es mío', 'Dueño', 'Miembros', 'Foto', 'Creado'],
    input.cars.map(c => [
      c.id,
      c.brand,
      c.model,
      c.version,
      c.year,
      c.plate,
      c.fuelTypes.map(t => FUEL_LABELS[t]).join(' + '),
      c.currentKm,
      c.kmUpdatedAt,
      c.avgKmPerDay,
      c.ownerUid === input.uid,
      c.ownerName,
      carMembers(c)
        .map(m => (m.name ? `${m.name} <${m.email}>` : m.email))
        .join(', '),
      c.photoUrl,
      c.createdAt,
    ]),
  )

  const rules = toCsv(
    ['Id', 'Auto', 'Nombre', 'Cada km', 'Cada tiempo', 'Se repite', 'Última vez cargada (km)', 'Última vez cargada (fecha)', 'Última vez (km)', 'Km estimado', 'Última vez (fecha)', 'Cumplido', 'Avisar km antes', 'Avisar días antes'],
    input.rules.map(r => [
      r.id,
      carOf(r.carId),
      r.name,
      r.intervalKm,
      r.intervalTime ? formatInterval(r.intervalTime) : null,
      r.repeat,
      r.baseKm,
      r.baseDate,
      r.lastDoneKm,
      r.lastDoneKmEstimated,
      r.lastDoneDate,
      r.completedByJobId != null,
      r.warnKm,
      r.warnDays,
    ]),
  )

  const jobs = toCsv(
    ['Id', 'Auto', 'Fecha', 'Km', 'Título', 'Categoría', 'Costo', 'Taller', 'Notas', 'Mantenimientos', 'Estado', 'Cargado por', 'Creado'],
    input.jobs.map(j => [
      j.id,
      carOf(j.carId),
      j.date,
      j.km,
      j.title,
      JOB_CATEGORY_LABELS[j.category] ?? j.category,
      j.cost,
      j.workshop,
      j.notes,
      j.ruleIds.map(id => ruleNames.get(id) ?? id).join(', '),
      STATUS_LABELS[j.status ?? 'approved'],
      author(j),
      j.createdAt,
    ]),
  )

  const fuel = toCsv(
    ['Id', 'Auto', 'Fecha', 'Km', 'Combustible', 'Calidad', 'Cantidad', 'Unidad', 'Precio unitario', 'Total', 'Tanque lleno', 'Estación', 'Cargado por', 'Creado'],
    input.fuel.map(f => [
      f.id,
      carOf(f.carId),
      f.date,
      f.km,
      FUEL_LABELS[f.fuelType] ?? f.fuelType,
      f.grade ? FUEL_GRADE_LABELS[f.grade] : null,
      f.quantity,
      FUEL_UNITS[f.fuelType] ?? null,
      f.unitPrice,
      f.total,
      f.fullTank,
      f.station,
      author(f),
      f.createdAt,
    ]),
  )

  const km = toCsv(
    ['Id', 'Auto', 'Fecha', 'Km', 'Origen', 'Cargado por', 'Creado'],
    input.odometer.map(r => [r.id, carOf(r.carId), r.date, r.km, SOURCE_LABELS[r.source] ?? r.source, author(r), r.createdAt]),
  )

  const achievements = toCsv(
    ['Id', 'Logro', 'Auto', 'Conseguido', 'Festejado'],
    input.achievements.map(a => [a.id, ACHIEVEMENT_BY_ID.get(a.id)?.name ?? a.id, a.carId ? carOf(a.carId) : null, a.unlockedAt, a.celebratedAt]),
  )

  const invites = toCsv(
    ['Id', 'Tipo', 'Auto', 'Mail', 'Dueño', 'Estado', 'Creada', 'Vence', 'Respondida'],
    allInvites(input).map(({ invite: i, sent }) => [
      i.id,
      sent ? 'Enviada' : 'Recibida',
      i.carLabel,
      i.email,
      i.ownerName,
      INVITE_STATUS_LABELS[i.status] ?? i.status,
      i.createdAt,
      i.expiresAt,
      i.respondedAt,
    ]),
  )

  return [
    { name: 'autos.csv', content: cars },
    { name: 'mantenimientos.csv', content: rules },
    { name: 'trabajos.csv', content: jobs },
    { name: 'cargas.csv', content: fuel },
    { name: 'km.csv', content: km },
    { name: 'logros.csv', content: achievements },
    { name: 'invitaciones.csv', content: invites },
  ]
}

/** "autocar-datos-2026-11-06.zip": el nombre del archivo, con la fecha del día (`today`, ISO). */
export const exportFileName = (today: string) => `autocar-datos-${today}.zip`

/**
 * El export en un solo zip: `datos.json` (todo) y una planilla por colección (`buildExportCsvs`). Un solo archivo
 * porque en el celular (sobre todo en iOS) varias descargas seguidas se bloquean o piden permiso una por una.
 */
export function buildExportZip(input: ExportInput, now: Date): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const files = [{ name: 'datos.json', content: buildExportJson(input, now) }, ...buildExportCsvs(input)]
  return zipFiles(
    files.map(f => ({ name: f.name, data: encoder.encode(f.content) })),
    now,
  )
}
