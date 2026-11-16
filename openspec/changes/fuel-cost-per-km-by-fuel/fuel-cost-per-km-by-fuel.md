# fuel-cost-per-km-by-fuel

**Base:** plan approved in chat on 2026-11-15. No issue.

**Branch:** `feat/fuel-cost-per-km-by-fuel` from `develop`. The PR goes to `develop`.

## Problem

1. The "Costo por km" card in the car's Combustible tab (`app/(app)/autos/[carId]/page.tsx`, `FuelTab`) shows one number for all fuels with the hint "Todos los combustibles". In a nafta + GNC car the user cannot see how much of that number is nafta and how much is GNC.
2. In `/gastos`, the month detail under the bars (`MonthlyBars`, `components/charts.tsx`) is one `flex flex-wrap justify-between` row. On a phone it breaks: "Nov" sits alone on one line, the amounts spread out, and the total ends up next to Repuestos.

## Decisions

1. **Split by fuel, same window.** The cost per km of each fuel is what was spent on that fuel in the window divided by the same distance. The window is the one `computeCostPerKm` uses today: loads with km sorted by km, from the first to the last; the first load does not count; loads without km whose date falls strictly between the first and the last count (`sumBetween`). So the parts add up to the total (up to rounding to cents).
   - We do **not** compute "price per unit / consumption" per fuel: in a car with two fuels the km driven on each fuel are unknown, so that number would be made up.
2. **New pure function in `lib/fuel.ts`:** `costPerKmByFuel(loads: FuelLoad[]): { total: number; byFuel: { fuelType: FuelType; perKm: number }[] } | null`.
   - `null` in the same cases as today (fewer than 2 loads with km, or distance <= 0).
   - `total` = `round2(spent / distance)`, exactly what `computeCostPerKm` returns today.
   - `byFuel`: one entry per fuel type with spent > 0 in the window, `perKm = round2(spentOfType / distance)`, ordered by the key order of `FUEL_LABELS` (nafta, gasoil, gnc).
   - `computeCostPerKm(loads)` becomes `costPerKmByFuel(loads)?.total ?? null` (keep the export: achievements and `/gastos` use it). Its doc comment stays accurate.
3. **Car Combustible tab:** the card stays "Costo por km" with the total as value. Hint:
   - no data: "Necesita dos cargas con km" (unchanged);
   - `byFuel.length <= 1`: the label of that fuel (`FUEL_LABELS`), e.g. "Nafta"; if `byFuel` is empty, keep "Todos los combustibles" (cannot happen with a positive total, but stay safe);
   - `byFuel.length >= 2`: `"Nafta $ 129,90 · GNC $ 10,09"` (`FUEL_LABELS[t]` + `formatMoneyPrecise(perKm)`, joined with ` · `).
4. **`/gastos`:** the Combustible tile keeps its hint (share + total per km). No breakdown there; it would be too long on a phone.
5. **Month detail in `MonthlyBars`:**
   - Header row: month on the left (`font-medium`), total on the right (`font-semibold tabular-nums`).
   - Below: one row per series, color dot + name on the left (`text-muted-foreground`), amount on the right (`tabular-nums text-foreground`), so amounts line up in a column on a phone.
   - From `sm` up, the three series sit on one line (e.g. `sm:flex sm:gap-x-5` with each item inline); the header can stay on top.
   - Series order everywhere in the chart: **Trabajos, Repuestos, Combustible**, the same as the tiles above. Change the order in the detail and in the `Legend` in `app/(app)/gastos/page.tsx`, and the order of colors in the `ChartCard` description ("en azul… en verde… en naranja…"). Do **not** change the series colors or the stacking order of the bars.
   - The empty state ("Tocá un mes para ver el detalle.") stays. Keep `min-h-12`, the border and the background of the box.

## Tasks

1. `lib/fuel.ts`: `costPerKmByFuel` (with a `/** */` doc comment) and `computeCostPerKm` on top of it.
2. `lib/fuel.test.ts`: tests for `costPerKmByFuel`:
   - one fuel: one entry equal to the total;
   - nafta + GNC: two entries in order nafta, gnc; their sum equals the total within 0.01;
   - a load without km between the first and the last counts for its fuel; one after the last does not;
   - the first load's fuel gets nothing from that load (only from later ones);
   - fewer than 2 loads with km → `null`.
   Existing `computeCostPerKm` tests must still pass unchanged.
3. `app/(app)/autos/[carId]/page.tsx`: decision 3.
4. `components/charts.tsx` (`MonthlyBars`) and `app/(app)/gastos/page.tsx`: decision 5.
5. `SYSTEM_MAP.md`: add `costPerKmByFuel` to the `fuel.ts` row in "Lógica de dominio pura".
6. `CHANGELOG.md`: a `## Próxima versión` section at the top (above `## 1.8.0`) with the two items, in the house style (Spanish, user-facing first). Do not bump the version and do not touch `lib/novedades.ts` or `package.json`.
7. `openspec/changes/README.md`: add a row for this change with status `IN PROGRESS`.

## Constraints

- Comments: only `/** */` right above a declaration. No `//`, no `/* */` inside functions, no JSX comments.
- UI text in Rioplatense Spanish.
- Do not run build, tests, typecheck or eslint: the user runs them.
- Commits in English, conventional format (`feat(fuel): …`, `fix(expenses): …`), no Claude co-author trailer.
