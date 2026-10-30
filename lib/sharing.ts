import type { Authorship, Car, FuelLoad, Invite, Job, JobStatus, MaintenanceRule, OdometerReading } from './types'

/** Cuántas personas, además del dueño, pueden tener un auto. */
export const MAX_MEMBERS = 2

/** Cuántos días dura una invitación sin responder. Las reglas de Firestore aceptan hasta 15. */
export const INVITE_DAYS = 14

/** Sin "/": el mail canónico va en el id de la invitación, y un id de Firestore no puede tenerla. */
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

/** Dominios de Gmail: Google ignora los puntos y lo que va después de un "+" en la parte de antes de la arroba. */
const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']

/** Un mail como lo escribe el dueño y como lo compara la regla de Firestore con `members`: sin espacios y en minúscula. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/**
 * Mail con el que se compara una invitación: en minúscula y, en Gmail, sin puntos ni "+algo" (Google los ignora).
 * `googlemail.com` se trata como `gmail.com`. Los demás dominios, sólo en minúscula y sin espacios. Es el mismo
 * cálculo que `myEmailKey()` en firestore.rules.
 */
export function canonicalEmail(email: string): string {
  const e = normalizeEmail(email)
  const at = e.lastIndexOf('@')
  if (at < 0 || !GMAIL_DOMAINS.includes(e.slice(at + 1))) return e
  return `${e.slice(0, at).split('+')[0].replaceAll('.', '')}@gmail.com`
}

/** "j•••@gmail.com": el mail de una invitación para mostrarlo a otra cuenta sin revelarlo entero. */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}

/** Id de la invitación de un mail a un auto: `{carId}_{mail canónico}`. Una activa por auto y mail. */
export const inviteId = (carId: string, email: string) => `${carId}_${canonicalEmail(email)}`

/** El mail canónico que va en el id de una invitación (los ids de los autos no tienen "_"). */
export function inviteEmailKey(id: string) {
  const i = id.indexOf('_')
  return i < 0 ? '' : id.slice(i + 1)
}

/** Si la invitación se puede aceptar o rechazar: está pendiente y no venció. */
export const isInviteOpen = (invite: Pick<Invite, 'status' | 'expiresAt'>, now: Date) =>
  invite.status === 'pending' && invite.expiresAt.getTime() > now.getTime()

/** "Ford Ka 2015": cómo ve el auto el invitado antes de aceptar, sin poder leerlo. */
export const inviteCarLabel = (car: Pick<Car, 'brand' | 'model' | 'year'>) =>
  [car.brand, car.model, car.year].filter(Boolean).join(' ')

/** Un miembro del auto: por uid (aceptó una invitación) o, hasta #66, sólo por el mail viejo de `members` (uid null). */
export interface CarMember {
  uid: string | null
  email: string
  name: string | null
}

/**
 * Los miembros del auto: los de `memberUids` con su perfil y, después, los mails viejos de `members` que no son de
 * ninguno de ellos (comparados con `canonicalEmail`).
 */
export function carMembers(car: Pick<Car, 'members' | 'memberUids' | 'memberProfiles'>): CarMember[] {
  const byUid: CarMember[] = (car.memberUids ?? []).map(uid => {
    const profile = car.memberProfiles?.[uid]
    return { uid, email: profile?.email ?? '', name: profile?.name ?? null }
  })
  const known = new Set(byUid.map(m => canonicalEmail(m.email)))
  const legacy: CarMember[] = (car.members ?? [])
    .filter(email => !known.has(canonicalEmail(email)))
    .map(email => ({ uid: null, email, name: null }))
  return [...byUid, ...legacy]
}

/** Si soy el dueño del auto. */
export const isCarOwner = (car: Pick<Car, 'ownerUid'>, uid: string) => car.ownerUid === uid

/**
 * Si el auto está compartido desde mi lado: lo compartí con alguien (por uid o, hasta #66, por el mail viejo) o me lo
 * compartieron. Sólo en esos autos se muestra quién cargó cada cosa.
 */
export const isSharedCar = (car: Pick<Car, 'ownerUid' | 'members' | 'memberUids'>, uid: string) =>
  !isCarOwner(car, uid) || (car.memberUids?.length ?? 0) > 0 || (car.members?.length ?? 0) > 0

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

/**
 * Lo que se escribe al editar un trabajo (`update`), a partir de los campos que cambiaron (`changedFields`); null si no
 * hay nada que escribir. El miembro lo vuelve a `pending` si no lo estaba (volver a mandar uno rechazado, aunque no le
 * cambie nada) y siempre sube `revision` en 1: así el dueño no aprueba una versión que ya no es la última. El dueño no
 * le cambia el estado; en uno que no está aprobado (el de un miembro, pendiente o rechazado) también sube `revision`,
 * así otro dispositivo suyo no aprueba la versión de antes. En uno aprobado no la toca.
 */
export function jobEdit<T extends object>(job: Pick<Job, 'status' | 'revision'>, changes: T, member: boolean): (T & JobEditExtras) | null {
  const resend = member && job.status !== 'pending'
  if (!Object.keys(changes).length && !resend) return null
  const extras: JobEditExtras = {}
  if (resend) extras.status = 'pending'
  if (member || !isApproved(job)) extras.revision = job.revision + 1
  return { ...changes, ...extras }
}

/** Lo que `jobEdit` suma a los campos que cambiaron. */
type JobEditExtras = { status?: JobStatus; revision?: number }

/** Lo que el dueño quiere dejar en un trabajo al revisarlo. */
export type ReviewTarget = Extract<JobStatus, 'approved' | 'rejected'>

/**
 * Si una revisión del dueño que las reglas rechazaron ya está hecha: el trabajo en el servidor (`current`; null si no
 * existe) quedó como se quería, porque se aprobó o se rechazó dos veces, o desde dos dispositivos. Si no (el miembro lo
 * editó, lo borró o lo revisó otro dispositivo de otra forma), el trabajo cambió mientras el dueño lo revisaba.
 */
export const reviewAlreadyDone = (target: ReviewTarget, current: JobStatus | null) => current === target

/** "vos", el nombre de quien lo cargó o, si no lo tiene, "otra persona". */
export function authorLabel(record: Authorship, car: Pick<Car, 'ownerUid' | 'ownerName'>, uid: string) {
  const author = authorOf(record, car)
  if (author === uid) return 'vos'
  if (record.createdByName) return record.createdByName
  if (author === car.ownerUid && car.ownerName) return car.ownerName
  return 'otra persona'
}

/**
 * Error para mostrar si no se puede invitar a ese mail al auto, o null si está bien. Espera el mail ya normalizado
 * (`normalizeEmail`). Compara con `canonicalEmail`, así "j.doe@gmail.com" y "jdoe@gmail.com" son el mismo. Rechaza mi
 * propio mail (`ownerEmail`), el de un miembro (por uid o por el mail viejo) y el de una invitación pendiente que no
 * venció. El tope (`MAX_MEMBERS`) cuenta los miembros por uid más las invitaciones pendientes del auto que no vencieron.
 */
export function memberError(
  car: Pick<Car, 'id' | 'members' | 'memberUids' | 'memberProfiles'>,
  invites: Invite[],
  email: string,
  ctx: { ownerEmail: string | null; now: Date },
) {
  if (!EMAIL_RE.test(email)) return 'Ese mail no es válido.'
  if (email !== normalizeEmail(email)) return 'El mail tiene que estar en minúscula y sin espacios.'
  const key = canonicalEmail(email)
  if (ctx.ownerEmail && key === canonicalEmail(ctx.ownerEmail)) return 'Ese es tu mail: el auto ya es tuyo.'
  if (carMembers(car).some(m => canonicalEmail(m.email) === key)) return 'Ya compartiste el auto con ese mail.'
  const open = invites.filter(i => i.carId === car.id && isInviteOpen(i, ctx.now))
  if (open.some(i => i.emailKey === key)) return 'Ya invitaste a ese mail. Esperá que responda o cancelá la invitación.'
  if ((car.memberUids?.length ?? 0) + open.length >= MAX_MEMBERS) {
    return `Podés compartir el auto con hasta ${MAX_MEMBERS} personas, contando las invitaciones pendientes.`
  }
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
 * me compartieron no cuentan los mantenimientos, porque el plan es del dueño. Tampoco cuentan los recordatorios
 * cumplidos (`completedByJobId`): antes un trabajo los borraba, y así los logros siguen contando lo mismo.
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
      return car ? isCarOwner(car, uid) && r.completedByJobId == null : false
    }),
    jobs: data.jobs.filter(j => mine(j) && isApproved(j)),
    fuel: data.fuel.filter(mine),
    odometer: data.odometer.filter(mine),
  }
}
