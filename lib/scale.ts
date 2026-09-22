/** Escala del eje con valores redondos: el paso más chico que entra en 5 divisiones o menos. */
export function niceMax(max: number, maxTicks = 5) {
  if (max <= 0) return { top: 1, step: 0.25 }
  const pow = 10 ** Math.floor(Math.log10(max / maxTicks))
  const step = [1, 2, 2.5, 5, 10, 20].map(m => m * pow).find(s => Math.ceil(max / s) <= maxTicks)!
  return { top: Math.ceil(max / step) * step, step }
}
