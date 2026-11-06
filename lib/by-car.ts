/**
 * Agrupa una lista de registros por auto en una sola pasada (`DataProvider`). Cada auto de `carIds` tiene su entrada,
 * aunque no tenga registros (lista vacía). Dentro de cada auto se conserva el orden de la lista completa (los trabajos
 * y las cargas, si llegan ordenados por fecha, quedan así) y los mismos objetos. Un registro de un auto que no está en
 * `carIds` queda afuera.
 */
export function groupByCar<T extends { carId: string }>(carIds: Iterable<string>, list: readonly T[]): Map<string, T[]> {
  const byCar = new Map<string, T[]>()
  for (const id of carIds) byCar.set(id, [])
  for (const item of list) byCar.get(item.carId)?.push(item)
  return byCar
}
