'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { subscribeUserData, type UserData } from '@/lib/db'
import { toISODate } from '@/lib/dates'
import { rulesWithState, type RuleWithState } from '@/lib/maintenance'
import { DEFAULT_SETTINGS, type Car } from '@/lib/types'
import { useAuth } from './auth-provider'

interface DataState extends UserData {
  uid: string
  loading: boolean
  error: Error | null
  today: string
  carById: Map<string, Car>
  /** Mantenimientos de cada auto con su estado, ordenados por urgencia. */
  rulesByCar: Map<string, RuleWithState[]>
}

const DataContext = createContext<DataState | null>(null)

const PARTS: (keyof UserData)[] = ['settings', 'cars', 'rules', 'jobs', 'fuel', 'odometer']

const EMPTY: UserData = { settings: DEFAULT_SETTINGS, cars: [], rules: [], jobs: [], fuel: [], odometer: [] }

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const uid = user!.uid
  const [data, setData] = useState<UserData>(EMPTY)
  const [loaded, setLoaded] = useState<Set<keyof UserData>>(new Set())
  const [error, setError] = useState<Error | null>(null)
  const [today, setToday] = useState(() => toISODate(new Date()))

  useEffect(() => {
    setData(EMPTY)
    setLoaded(new Set())
    return subscribeUserData(
      uid,
      (patch, part) => {
        setData(d => ({ ...d, ...patch }))
        setLoaded(s => (s.has(part) ? s : new Set(s).add(part)))
      },
      setError,
    )
  }, [uid])

  // Si la app queda abierta pasada la medianoche, recalcula los vencimientos.
  useEffect(() => {
    const id = setInterval(() => setToday(toISODate(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])

  const value = useMemo<DataState>(() => {
    const cars = [...data.cars].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
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
      loading: PARTS.some(p => !loaded.has(p)),
      error,
      today,
      carById,
      rulesByCar,
    }
  }, [data, loaded, error, today, uid])

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
