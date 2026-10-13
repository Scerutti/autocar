import { describe, expect, it } from 'vitest'
import { topReading } from './odometer'

const reading = (km: number, date: string) => ({ km, date: new Date(`${date}T12:00:00Z`) })

describe('topReading', () => {
  it('se queda con la lectura de más km aunque no vengan ordenadas', () => {
    const readings = [reading(50_000, '2026-09-01'), reading(50_500, '2026-09-03'), reading(50_200, '2026-09-02')]
    expect(topReading(readings)).toBe(readings[1])
  })
  it('manda el km aunque la lectura más alta tenga una fecha anterior', () => {
    // Una carga offline sincroniza tarde: no por ser la última en llegar baja el km.
    const readings = [reading(50_500, '2026-09-01'), reading(50_200, '2026-09-05')]
    expect(topReading(readings)).toBe(readings[0])
  })
  it('ante un empate de km elige la más reciente, sin importar el orden', () => {
    const readings = [reading(50_000, '2026-09-01'), reading(50_000, '2026-09-10'), reading(50_000, '2026-09-05')]
    expect(topReading(readings)).toBe(readings[1])
    expect(topReading([...readings].reverse())).toBe(readings[1])
  })
  it('sin lecturas devuelve null', () => {
    expect(topReading([])).toBeNull()
  })
})
