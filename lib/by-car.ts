type OfCar = { carId: string }

/** Los registros de un auto: cada lista en el mismo orden que la lista completa de la que sale. */
export interface CarRecords<R extends OfCar, J extends OfCar, F extends OfCar, O extends OfCar> {
  rules: R[]
  jobs: J[]
  fuel: F[]
  readings: O[]
}

/**
 * Agrupa los registros por auto en una sola pasada (`DataProvider`). Cada auto de `carIds` tiene su entrada, aunque no
 * tenga registros (listas vacías). Dentro de cada auto se conserva el orden de la lista completa (los trabajos y las
 * cargas, si llegan ordenados por fecha, quedan así). Un registro de un auto que no está en `carIds` queda afuera.
 */
export function groupByCar<R extends OfCar, J extends OfCar, F extends OfCar, O extends OfCar>(
  carIds: Iterable<string>,
  records: { rules: readonly R[]; jobs: readonly J[]; fuel: readonly F[]; readings: readonly O[] },
): Map<string, CarRecords<R, J, F, O>> {
  const byCar = new Map<string, CarRecords<R, J, F, O>>()
  for (const id of carIds) byCar.set(id, { rules: [], jobs: [], fuel: [], readings: [] })
  for (const rule of records.rules) byCar.get(rule.carId)?.rules.push(rule)
  for (const job of records.jobs) byCar.get(job.carId)?.jobs.push(job)
  for (const load of records.fuel) byCar.get(load.carId)?.fuel.push(load)
  for (const reading of records.readings) byCar.get(reading.carId)?.readings.push(reading)
  return byCar
}
