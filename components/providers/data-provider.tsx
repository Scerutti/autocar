'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { subscribeUserData, syncCarKm, type UserData } from '@/lib/db'
import { toISODate } from '@/lib/dates'
import { rulesWithState, type RuleWithState } from '@/lib/maintenance'
import { topReading } from '@/lib/odometer'
import { DEFAULT_SETTINGS, type Actor, type Car } from '@/lib/types'
import { useAuth } from './auth-provider'

interface DataState extends UserData {
  uid: string
  /** Quién escribe: va como autor de lo que se crea. */
  actor: Actor
  loading: boolean
  error: Error | null
  today: string
  carById: Map<string, Car>
  /** Mantenimientos de cada auto con su estado, ordenados por urgencia. */
  rulesByCar: Map<string, RuleWithState[]>
}

const DataContext = createContext<DataState | null>(null)

const PARTS: (keyof UserData)[] = ['settings', 'cars', 'rules', 'jobs', 'fuel', 'odometer', 'achievements']

const EMPTY: UserData = { settings: DEFAULT_SETTINGS, cars: [], rules: [], jobs: [], fuel: [], odometer: [], achievements: [] }

/**
 * Datos del usuario en vivo desde Firestore. Si la app queda abierta pasada la medianoche, recalcula los
 * vencimientos. Si una lectura supera al km guardado en el auto (que puede haber quedado viejo hasta que se
 * corrige), se muestra esa.
 *
 * Corrección automática del km: si el km guardado en el auto es menor que su lectura más alta, lo sube (el cron
 * lee el guardado). Nunca lo baja: un auto viejo con más km que sus lecturas queda como está, y los km que bajan
 * a propósito ya los escribe deleteReading; así dos dispositivos no se pelean. Sólo corre con autos y lecturas
 * confirmados por el servidor (`synced`), no con la caché local: ahí podría faltar una lectura de otro
 * dispositivo y bajaría el km. Espera un momento a que se asienten los datos; una corrección que falló no se
 * reintenta.
 */
export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const uid = user!.uid
  const displayName = user!.displayName
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
  }, [uid])

  useEffect(() => {
    const id = setInterval(() => setToday(toISODate(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])

  const fixing = useRef(new Set<string>())
  const kmReady = synced.has('cars') && synced.has('odometer')
  useEffect(() => {
    if (!kmReady) return
    const id = setTimeout(() => {
      for (const car of data.cars) {
        const readings = data.odometer.filter(r => r.carId === car.id)
        const top = topReading(readings)
        if (!top || top.km <= car.currentKm) continue
        const key = `${car.id}:${top.km}`
        if (fixing.current.has(key)) continue
        fixing.current.add(key)
        syncCarKm(actor, car.id, readings)
          .then(() => fixing.current.delete(key))
          .catch(e => console.warn('No se pudo corregir el km del auto', car.id, e))
      }
    }, 2000)
    return () => clearTimeout(id)
  }, [data.cars, data.odometer, kmReady, actor])

  const value = useMemo<DataState>(() => {
    const cars = data.cars
      .map(c => {
        const top = topReading(data.odometer.filter(r => r.carId === c.id))
        return top && top.km > c.currentKm ? { ...c, currentKm: top.km, kmUpdatedAt: top.date } : c
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const carById = new Map(cars.map(c => [c.id, c]))
    const rulesByCar = new Map<string, RuleWithState[]>()
    for (const car of cars) {
      rulesByCar.set(car.id, rulesWithState(data.rules.filter(r => r.carId === car.id), car, today))
    }
    const byDateDesc = <T extends { date: string; createdAt: Date }>(a: T, b: T) =>
      b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime()
    return {
      ...data,
      cars,
      jobs: [...data.jobs].sort(byDateDesc),
      fuel: [...data.fuel].sort(byDateDesc),
      odometer: [...data.odometer].sort((a, b) => b.date.getTime() - a.date.getTime()),
      uid,
      actor,
      loading: PARTS.some(p => !loaded.has(p)),
      error,
      today,
      carById,
      rulesByCar,
    }
  }, [data, loaded, error, today, uid, actor])

  return <DataContext value={value}>{children}</DataContext>
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData fuera de DataProvider')
  return ctx
}

/** Datos de un auto puntual; null si no existe (o todavía está cargando). */
export function useCar(carId: string) {
  const d = useData()
  const car = d.carById.get(carId) ?? null
  return useMemo(
    () => ({
      car,
      rules: d.rulesByCar.get(carId) ?? [],
      jobs: d.jobs.filter(j => j.carId === carId),
      fuel: d.fuel.filter(f => f.carId === carId),
      readings: d.odometer.filter(r => r.carId === carId),
    }),
    [car, carId, d.rulesByCar, d.jobs, d.fuel, d.odometer],
  )
}
