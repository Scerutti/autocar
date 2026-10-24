import type { Authorship, Car, FuelLoad, Job, MaintenanceRule, OdometerReading } from './types'

/** Cuántas personas, además del dueño, pueden tener un auto. */
export const MAX_MEMBERS = 2

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Un mail como se guarda en `members` y como lo compara la regla de Firestore: sin espacios y en minúscula. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** Si soy el dueño del auto. */
export const isCarOwner = (car: Pick<Car, 'ownerUid'>, uid: string) => car.ownerUid === uid

/**
 * Si el auto está compartido desde mi lado: lo compartí con alguien o me lo compartieron. Sólo en esos autos
 * se muestra quién cargó cada cosa.
 */
export const isSharedCar = (car: Pick<Car, 'ownerUid' | 'members'>, uid: string) =>
  !isCarOwner(car, uid) || (car.members?.length ?? 0) > 0

/** Uid de quien cargó un registro. Uno sin autoría (anterior a la migración) cuenta como del dueño del auto. */
export const authorOf = (record: Authorship, car: Pick<Car, 'ownerUid'>) => record.createdBy ?? car.ownerUid ?? null

/** Un trabajo sin estado (guardado antes de compartir autos) cuenta como aprobado. */
export const isApproved = (job: Pick<Job, 'status'>) => (job.status ?? 'approved') === 'approved'

/** Los trabajos que cuentan en gastos, reportes y totales: sólo los aprobados. */
export const approvedJobs = <T extends Pick<Job, 'status'>>(jobs: T[]) => jobs.filter(isApproved)

/** Si puedo editar o borrar una carga o una lectura de km: el dueño siempre, el miembro sólo lo que cargó él. */
export function canEditEntry(car: Pick<Car, 'ownerUid'>, uid: string, record: Authorship) {
  return isCarOwner(car, uid) || authorOf(record, car) === uid
}

/** Si puedo editar o borrar un trabajo: el dueño siempre, el miembro sólo uno suyo que esté pendiente o rechazado. */
export function canEditJob(car: Pick<Car, 'ownerUid'>, uid: string, job: Pick<Job, 'status' | 'createdBy'>) {
  if (isCarOwner(car, uid)) return true
  return authorOf(job, car) === uid && !isApproved(job)
}

/** "vos", el nombre de quien lo cargó o, si no lo tiene, "otra persona". */
export function authorLabel(record: Authorship, car: Pick<Car, 'ownerUid' | 'ownerName'>, uid: string) {
  const author = authorOf(record, car)
  if (author === uid) return 'vos'
  if (record.createdByName) return record.createdByName
  if (author === car.ownerUid && car.ownerName) return car.ownerName
  return 'otra persona'
}

/**
 * Error para mostrar si el mail no se puede sumar al auto, o null si está bien. Espera el mail ya normalizado
 * (`normalizeEmail`): uno con mayúsculas no coincidiría con el del login en las reglas.
 */
export function memberError(email: string, input: { ownerEmail: string | null; members: string[] }) {
  if (!EMAIL_RE.test(email)) return 'Ese mail no es válido.'
  if (email !== normalizeEmail(email)) return 'El mail tiene que estar en minúscula y sin espacios.'
  if (input.ownerEmail && email === normalizeEmail(input.ownerEmail)) return 'Ese es tu mail: el auto ya es tuyo.'
  if (input.members.includes(email)) return 'Ya lo compartiste con ese mail.'
  if (input.members.length >= MAX_MEMBERS) return `Podés compartir el auto con hasta ${MAX_MEMBERS} personas.`
  return null
}

interface AchievementData {
  cars: Car[]
  rules: MaintenanceRule[]
  jobs: Job[]
  fuel: FuelLoad[]
  odometer: OdometerReading[]
}

/**
 * Lo que cuenta para mis logros: las cargas y lecturas que cargué yo y mis trabajos aprobados. En los autos que
 * me compartieron no cuentan los mantenimientos, porque el plan es del dueño.
 */
export function mineForAchievements(data: AchievementData, uid: string): AchievementData {
  const carById = new Map(data.cars.map(c => [c.id, c]))
  const mine = (r: Authorship & { carId: string }) => {
    const car = carById.get(r.carId)
    return car ? authorOf(r, car) === uid : false
  }
  return {
    cars: data.cars,
    rules: data.rules.filter(r => {
      const car = carById.get(r.carId)
      return car ? isCarOwner(car, uid) : false
    }),
    jobs: data.jobs.filter(j => mine(j) && isApproved(j)),
    fuel: data.fuel.filter(mine),
    odometer: data.odometer.filter(mine),
  }
}
