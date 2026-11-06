'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { groupByCar } from '@/lib/by-car'
import { subscribeUserData, syncCarKm, syncRuleProjection, type UserData } from '@/lib/db'
import { toISODate } from '@/lib/dates'
import {
  activeRules,
  isCompleted,
  projectionDiff,
  projectionKey,
  projectRule,
  projectRules,
  rulesWithState,
  type RuleWithState,
} from '@/lib/maintenance'
import { kmCorrection, topReading } from '@/lib/odometer'
import { canWrite, isCarOwner, isInviteOpen } from '@/lib/sharing'
import {
  DEFAULT_SETTINGS,
  type Actor,
  type Car,
  type FuelLoad,
  type Invite,
  type Job,
  type MaintenanceRule,
  type OdometerReading,
} from '@/lib/types'
import { useAuth } from './auth-provider'

/** Los registros de un auto: mantenimientos (con la proyección en memoria), trabajos, cargas y lecturas de km. */
interface CarData {
  rules: MaintenanceRule[]
  jobs: Job[]
  fuel: FuelLoad[]
  readings: OdometerReading[]
}

const NO_RECORDS: CarData = { rules: [], jobs: [], fuel: [], readings: [] }

/** Orden de trabajos y cargas: la fecha más nueva primero; en el mismo día, el último cargado. */
const byDateDesc = <T extends { date: string; createdAt: Date }>(a: T, b: T) =>
  b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime()

/** Orden de las lecturas de km: la más nueva primero. */
const byNewest = (a: OdometerReading, b: OdometerReading) => b.date.getTime() - a.date.getTime()

interface DataState extends UserData {
  uid: string
  /** Mail del login en minúscula (el de mi perfil al aceptar una invitación); null si la cuenta no tiene mail. */
  email: string | null
  /** Quién escribe: va como autor de lo que se crea. */
  actor: Actor
  loading: boolean
  error: Error | null
  today: string
  carById: Map<string, Car>
  /** Todos los mantenimientos, también los cumplidos, con la proyección calculada en memoria (`projectRules`). */
  rules: MaintenanceRule[]
  /** Mantenimientos activos de cada auto (sin los recordatorios cumplidos) con su estado, ordenados por urgencia. */
  rulesByCar: Map<string, RuleWithState[]>
  /**
   * Los registros de cada auto de `cars`, agrupados una vez por cambio de cada lista (`groupByCar`): todos los
   * mantenimientos con la proyección, trabajos y cargas por fecha descendente y lecturas por fecha descendente. Un auto
   * sin registros tiene listas vacías.
   */
  byCar: Map<string, CarData>
  /** Las invitaciones para mi mail que puedo responder: pendientes y sin vencer (se filtra al recalcular, con `today`). */
  myInvites: Invite[]
}

const DataContext = createContext<DataState | null>(null)

const PARTS: (keyof UserData)[] = ['settings', 'cars', 'rules', 'jobs', 'fuel', 'odometer', 'achievements', 'invites', 'myInvites']

const EMPTY: UserData = {
  settings: DEFAULT_SETTINGS,
  cars: [],
  rules: [],
  jobs: [],
  fuel: [],
  odometer: [],
  achievements: [],
  invites: [],
  myInvites: [],
}

/**
 * Datos del usuario en vivo desde Firestore. Si la app queda abierta pasada la medianoche, recalcula los
 * vencimientos. El km de un auto con lecturas es el de su lectura más alta (`topReading`), aunque el guardado en el
 * auto sea mayor o menor (puede haber quedado mal hasta que se corrige); sin lecturas, el guardado.
 *
 * Los registros se agrupan por auto con `groupByCar`, cada lista por separado: se reagrupa sólo la que cambió (o todas
 * si cambian los ids de los autos, no otro campo de un auto). El km de cada auto, `rulesByCar`, la proyección, la
 * corrección del km, la reconciliación y `useCar` (vía `byCar`) leen de ahí en vez de filtrar las listas completas, y
 * cada uno depende sólo de las listas que usa: una carga nueva no reinicia la espera de la corrección del km. Un
 * mantenimiento de un auto que todavía no está en `cars` se proyecta con las listas completas.
 *
 * Corrección automática del km: si el km guardado en el auto no es el de su lectura más alta, sea mayor o menor,
 * escribe el de las lecturas (`kmCorrection`, `syncCarKm`). Las lecturas son la fuente de verdad: así se arregla un
 * km que dejó mal un dispositivo viejo, un cruce entre dispositivos o un miembro. Sólo corre con autos y lecturas
 * confirmados por el servidor (`synced`), no con la caché local: ahí podría faltar una lectura de otro dispositivo
 * y bajaría el km. `subscribeUserData` publica las lecturas recién cuando todos los autos entregaron las suyas, y
 * las marca como caché si alguna lo es; un auto nuevo que todavía no las entregó aparece sin lecturas y no se toca.
 * Espera un momento a que se asienten los datos (el auto y su lectura llegan en fotos separadas); una corrección que
 * falló no se reintenta. En los autos donde soy `viewer` no corrige nada: no puedo escribir el km.
 *
 * Mantenimientos: `rules` (y `rulesByCar`) llevan la proyección calculada en memoria con los trabajos aprobados y las
 * lecturas (`projectRules`), así la pantalla está bien antes de que la proyección llegue al servidor. Reconciliación:
 * en los autos propios (el plan es del dueño), si la proyección guardada no es la calculada (`projectionDiff`), la
 * escribe (`syncRuleProjection`). Arregla un batch de un trabajo que falló, un cambio hecho con la versión anterior de
 * la PWA o un estimado que se movió. Igual que el km: sólo con autos, mantenimientos, trabajos y lecturas confirmados
 * por el servidor, un momento después de que se asientan, y una clave `ruleId:patch` evita repetir la misma escritura
 * (una que falló no se reintenta). Es determinística: dos dispositivos escriben lo mismo y no compiten.
 */
export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const uid = user!.uid
  const displayName = user!.displayName
  const email = user!.email ? user!.email.toLowerCase() : null
  const actor = useMemo<Actor>(() => ({ uid, name: displayName || null }), [uid, displayName])
  const [data, setData] = useState<UserData>(EMPTY)
  const [loaded, setLoaded] = useState<Set<keyof UserData>>(new Set())
  const [synced, setSynced] = useState<Set<keyof UserData>>(new Set())
  const [error, setError] = useState<Error | null>(null)
  const [today, setToday] = useState(() => toISODate(new Date()))

  useEffect(() => {
    setData(EMPTY)
    setLoaded(new Set())
    setSynced(new Set())
    return subscribeUserData(
      uid,
      email,
      (patch, part, fromCache) => {
        setData(d => ({ ...d, ...patch }))
        setLoaded(s => (s.has(part) ? s : new Set(s).add(part)))
        setSynced(s => {
          if (s.has(part) === !fromCache) return s
          const next = new Set(s)
          if (fromCache) next.delete(part)
          else next.add(part)
          return next
        })
      },
      setError,
    )
  }, [uid, email])

  useEffect(() => {
    const id = setInterval(() => setToday(toISODate(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])

  const carKey = data.cars.map(c => c.id).join('/')
  const carIds = useMemo(() => (carKey ? carKey.split('/') : []), [carKey])
  const jobs = useMemo(() => [...data.jobs].sort(byDateDesc), [data.jobs])
  const fuel = useMemo(() => [...data.fuel].sort(byDateDesc), [data.fuel])
  const odometer = useMemo(() => [...data.odometer].sort(byNewest), [data.odometer])
  const storedRulesByCar = useMemo(() => groupByCar(carIds, data.rules), [carIds, data.rules])
  const jobsByCar = useMemo(() => groupByCar(carIds, jobs), [carIds, jobs])
  const fuelByCar = useMemo(() => groupByCar(carIds, fuel), [carIds, fuel])
  const readingsByCar = useMemo(() => groupByCar(carIds, odometer), [carIds, odometer])

  const fixing = useRef(new Set<string>())
  const kmReady = synced.has('cars') && synced.has('odometer')
  useEffect(() => {
    if (!kmReady) return
    const id = setTimeout(() => {
      for (const car of data.cars) {
        if (!canWrite(car, uid)) continue
        const readings = readingsByCar.get(car.id) ?? []
        const fix = kmCorrection(car, readings)
        if (!fix) continue
        const key = `${car.id}:${fix.currentKm}`
        if (fixing.current.has(key)) continue
        fixing.current.add(key)
        syncCarKm(actor, car.id, readings)
          .then(() => fixing.current.delete(key))
          .catch(e => console.warn('No se pudo corregir el km del auto', car.id, e))
      }
    }, 2000)
    return () => clearTimeout(id)
  }, [data.cars, readingsByCar, kmReady, actor, uid])

  const projecting = useRef(new Set<string>())
  const projectionReady = kmReady && synced.has('rules') && synced.has('jobs')
  useEffect(() => {
    if (!projectionReady) return
    const id = setTimeout(() => {
      for (const car of data.cars) {
        if (!isCarOwner(car, uid)) continue
        const rules = storedRulesByCar.get(car.id) ?? []
        const carJobs = jobsByCar.get(car.id) ?? []
        const readings = readingsByCar.get(car.id) ?? []
        for (const change of projectionDiff(rules, carJobs, readings)) {
          const key = projectionKey(change)
          if (projecting.current.has(key)) continue
          projecting.current.add(key)
          syncRuleProjection(actor, change)
            .then(() => projecting.current.delete(key))
            .catch(e => console.warn('No se pudo actualizar el mantenimiento', change.ruleId, e))
        }
      }
    }, 2000)
    return () => clearTimeout(id)
  }, [data.cars, storedRulesByCar, jobsByCar, readingsByCar, projectionReady, actor, uid])

  const projection = useMemo(() => {
    const rulesOf = new Map<string, MaintenanceRule[]>()
    const projected = new Map<MaintenanceRule, MaintenanceRule>()
    for (const [carId, stored] of storedRulesByCar) {
      const next = projectRules(stored, jobsByCar.get(carId) ?? [], readingsByCar.get(carId) ?? [])
      stored.forEach((rule, i) => projected.set(rule, next[i]))
      rulesOf.set(carId, next)
    }
    const rules = data.rules.map(r => projected.get(r) ?? { ...r, ...projectRule(r, jobs, odometer) })
    return { rulesOf, rules }
  }, [storedRulesByCar, jobsByCar, readingsByCar, data.rules, jobs, odometer])

  const byCar = useMemo(() => {
    const map = new Map<string, CarData>()
    for (const id of carIds) {
      map.set(id, {
        rules: projection.rulesOf.get(id) ?? [],
        jobs: jobsByCar.get(id) ?? [],
        fuel: fuelByCar.get(id) ?? [],
        readings: readingsByCar.get(id) ?? [],
      })
    }
    return map
  }, [carIds, projection, jobsByCar, fuelByCar, readingsByCar])

  const value = useMemo<DataState>(() => {
    const cars = data.cars
      .map(c => {
        const top = topReading(readingsByCar.get(c.id) ?? [])
        return top ? { ...c, currentKm: top.km, kmUpdatedAt: top.date } : c
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const carById = new Map(cars.map(c => [c.id, c]))
    const rulesByCar = new Map<string, RuleWithState[]>()
    for (const car of cars) {
      rulesByCar.set(car.id, rulesWithState(activeRules(projection.rulesOf.get(car.id) ?? []), car, today))
    }
    return {
      ...data,
      cars,
      rules: projection.rules,
      jobs,
      fuel,
      odometer,
      myInvites: data.myInvites.filter(i => isInviteOpen(i, new Date())),
      uid,
      email,
      actor,
      loading: PARTS.some(p => !loaded.has(p)),
      error,
      today,
      carById,
      rulesByCar,
      byCar,
    }
  }, [data, jobs, fuel, odometer, readingsByCar, projection, byCar, loaded, error, today, uid, email, actor])

  return <DataContext value={value}>{children}</DataContext>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData fuera de DataProvider')
  return ctx
}

/**
 * Datos de un auto puntual; null si no existe (o todavía está cargando). `rules` son los mantenimientos activos con su
 * estado; `completed`, los recordatorios cumplidos, y `allRules`, todos (con la proyección en memoria). Las listas
 * salen de `byCar`: un auto que no existe las tiene vacías.
 */
export function useCar(carId: string) {
  const d = useData()
  const car = d.carById.get(carId) ?? null
  const records = d.byCar.get(carId) ?? NO_RECORDS
  const rules = d.rulesByCar.get(carId)
  return useMemo(
    () => ({
      car,
      rules: rules ?? [],
      completed: records.rules.filter(isCompleted),
      allRules: records.rules,
      jobs: records.jobs,
      fuel: records.fuel,
      readings: records.readings,
    }),
    [car, records, rules],
  )
}
