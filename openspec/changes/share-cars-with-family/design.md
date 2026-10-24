# Design: share-cars-with-family

## Decisiones

### Modelo

- **`members` son mails en minúscula, hasta 2.** El dueño no figura en `members`. Se comparan con el mail del login en minúscula (`request.auth.token.email.lower()` en las reglas, `user.email.toLowerCase()` en el cliente). `allowlist/{mail}` ya exige mail verificado, y quien no entró nunca a la app no pasa `isAllowed()`: el auto le aparece la primera vez que entra.
- **El tipo `Car` suma `ownerUid`, `ownerName` y `members`.** `carFrom` en `lib/db.ts` hoy no los lee.
- **Estados de un trabajo:**
  - Lo crea el dueño → `approved`, como hoy.
  - Lo crea un miembro → `pending`.
  - El dueño aprueba → `approved` y se aplican sus efectos.
  - El dueño rechaza → `rejected`.
  - El miembro edita un trabajo `rejected` o `pending` → vuelve a `pending`.
  - `jobs` suma `reviewedAt` (timestamp, lo pone el dueño al aprobar o rechazar).
- **Un trabajo `pending` o `rejected` no tiene efectos.** No marca mantenimientos, no registra km y no cuenta en gastos, reportes ni logros. En `saveJob`, si quien escribe no es el dueño:
  - El trabajo se graba con `status: 'pending'`.
  - No hay batches de mantenimientos ni lectura de km, aunque el km sea mayor al actual.
  - `ruleIds` y `km` quedan guardados en el trabajo para aplicarlos al aprobar.
  - El usuario decidió que los km del familiar se apliquen al instante, pero eso es para los km sueltos y las cargas de combustible. Los km de un trabajo pendiente esperan, para que un trabajo rechazado no deje un km mal cargado.
- **Aprobar lo hace la app del dueño, con sus datos frescos.** Una función nueva (por ejemplo `approveJob`) arma lo mismo que hoy hace `saveJob` para los mantenimientos marcados y el km:
  - Los mantenimientos marcados se escriben en batches separados, con el mismo motivo documentado en `saveJob`.
  - El trabajo pasa a `approved` con `reviewedAt`.
  - Si `km` es mayor al km actual, registra la lectura con `createdBy` del miembro y su `source: 'job'`.
  - Reutilizá la lógica de `saveJob` en lugar de duplicarla. Por ejemplo, separá en una función propia la parte que arma los efectos.
- **Rechazar**: `status: 'rejected'` y `reviewedAt`. No toca nada más.
- **El miembro no ve "Volver al taller"** en el formulario de trabajo. Está fuera del alcance (ver la propuesta).
- **Lo que el miembro sí puede hacer en el auto:**
  - Al cargar km o combustible, actualizar `currentKm`, `kmUpdatedAt` y `avgKmPerDay`. Esto también lo hace la corrección automática de `syncCarKm`, que corre en el dispositivo del miembro.
  - Salir del auto: sacar su propio mail de `members`.

### Permisos en el cliente

- **Lógica pura en un módulo nuevo** (por ejemplo `lib/sharing.ts`) con pruebas vitest. Por ejemplo:
  - Si soy el dueño de un auto.
  - Si puedo editar o borrar una carga, una lectura o un trabajo (el dueño siempre; el miembro solo lo suyo, y en trabajos solo `pending` o `rejected`).
  - Validar un mail para sumar: formato, minúscula, que no sea el del dueño, que no esté repetido y que haya lugar (como mucho 2).
  - Qué registros cuentan para los logros de una persona.
  - Los componentes usan estas funciones en lugar de repetir condiciones.
- **"Lo mío" para los logros:**
  - Cargas y lecturas con `createdBy == uid`.
  - Trabajos con `createdBy == uid` y `status: 'approved'`.
  - Un registro con `createdBy == null` (no debería quedar ninguno después de la migración) cuenta como del dueño del auto.
  - En los autos compartidos conmigo, los mantenimientos no entran en mis logros, porque el plan es del dueño. Para esos autos, `carRecords` recibe `rules: []`.
  - El filtro va en `components/achievements/achievements-provider.tsx`, antes de `carRecords`. `lib/achievements.ts` no cambia.
- **Gastos, reporte en PDF y totales de la pestaña Trabajos** del auto: solo trabajos `approved`, para todos. Las listas (historial, pestaña Trabajos) muestran todos, con una etiqueta "Pendiente" o "Rechazado".
- **Pantallas de solo lectura**: cuando no puedo editar un registro, su pantalla de detalle (trabajo, carga, km, mantenimiento) se ve sin guardar ni borrar, con "Cargado por <nombre>". El miembro no ve:
  - "Editar auto".
  - "Agregar mantenimiento".
  - Las acciones de los mantenimientos. La pantalla de un mantenimiento se le muestra con un aviso: "Solo el dueño puede cambiar el plan".
  - Los "Agregar" de carga, km y trabajo los sigue viendo.
- **"Cargado por <nombre>"** se muestra solo en autos compartidos (con miembros, o cuando yo soy miembro), en `ActivityRow` y en los detalles. En un auto sin compartir no cambia nada visible.
- **Confirmaciones** (decisión del producto: confirmar toda acción importante, con `useConfirm()`):
  - Sumar un mail.
  - Sacar un mail (tono de peligro).
  - Salir del auto (tono de peligro).
  - Aprobar.
  - Rechazar (tono de peligro).

### Compartir (UI)

- **En `components/forms/car-form.tsx`, solo al editar un auto que es mío**, una sección "Compartir":
  - La lista de mails, cada uno con su botón para sacarlo.
  - Un campo para sumar un mail, que se deshabilita con 2 mails cargados.
  - El texto "Tiene que ser el mail con el que la persona entra con Google".
  - Un botón **Avisarle** con `navigator.share` (título, un texto como "Te compartí mi <auto> en AutoCar. Entrá con tu cuenta de Google:" y la URL de la app). Si `navigator.share` no existe, copia el texto al portapapeles y avisa con un toast.
  - Los cambios en `members` se guardan apenas se confirman, con `updateCar`. No esperan al botón "Guardar" del formulario.
- **En la pantalla del auto, para un miembro**: debajo del nombre, "Compartido por <ownerName>", y una acción "Salir de este auto". Al salir vuelve al Inicio con un toast.
- **Para el dueño de un auto compartido**: en la pantalla del auto, "Compartido con N personas".

### Campanita (`lib/pending.ts`, `components/pending/pending-bell.tsx`)

- **Tipos de pendiente nuevos:**
  - Trabajo para revisar: al dueño, por cada trabajo `pending` de sus autos, con **Aprobar** y **Rechazar** y un link al detalle.
  - Trabajo rechazado: al miembro, por cada trabajo suyo `rejected`, con un link para corregirlo.
  - Auto compartido nuevo: al miembro, "<dueño> te compartió su <auto>", una vez por auto.
- **"Una vez por auto"** se guarda en el dispositivo con `lib/local-store.ts` (una clave con la lista de ids vistos). Se marca visto al abrir la campanita o al tocar el ítem.
- **Los tres tipos suman al número.** Orden: vencidos, trabajos para revisar, km, rechazados, autos compartidos nuevos, por vencer.
- **El detalle de un trabajo `pending`** también muestra Aprobar y Rechazar al dueño.

### Lectura (`subscribeUserData` en `lib/db.ts`)

- **Una segunda consulta de autos**: `where('members', 'array-contains', email)`, unida a la de `ownerUid`. Los listeners por auto se abren para la unión de las dos. `cars` publica la unión, y `carsReady` y `fromCache` tienen en cuenta las dos consultas.
- **Si la consulta de compartidos falla con `permission-denied`, no se rompe la app**: se toma como "sin autos compartidos" y se deja un `console.warn`. Pasa si se publica la app antes que las reglas nuevas: con las reglas de la 1.1.2, esa consulta se rechaza y hoy eso llevaría a "No se pudieron cargar tus datos" para todos. Cualquier otro error sigue yendo a `onError`.
- **Sacar a un miembro**: el auto desaparece de su consulta, y el manejo de "acceso revocado" que ya existe da de baja sus listeners.
- Si `user.email` no está, no se abre la consulta de compartidos.

### Reglas de Firestore (`firestore.rules`)

- **Funciones nuevas**: el mail propio en minúscula, "soy miembro" para los datos de un auto, y sus versiones con `get()` y `getAfter()`, igual que `ownsCar` y `ownsCarAfter`.
- **`cars/{carId}`**:
  - Leer: dueño o miembro.
  - Crear y borrar: solo el dueño.
  - Editar, el dueño: como hoy.
  - Editar, el miembro, solo en dos casos:
    - Km: `diff(resource.data).affectedKeys().hasOnly(['currentKm', 'kmUpdatedAt', 'avgKmPerDay'])`.
    - Salir: `affectedKeys().hasOnly(['members'])`, y los `members` nuevos son los viejos menos su mail (con `toSet()` y `difference()`).
  - `validCar` además exige que `members` esté en minúscula: `members.join(',') == members.join(',').lower()`.
- **`rules` (mantenimientos)**: leer, dueño o miembro. Escribir, solo el dueño (como hoy).
- **`fuel` y `odometer`:**
  - Leer: dueño o miembro.
  - Crear: el dueño con cualquier `createdBy` (así puede usar "Deshacer" con algo de un miembro), o el miembro con `createdBy == request.auth.uid`.
  - Editar: el dueño, o el miembro si `resource.data.createdBy == request.auth.uid`. En los dos casos, `createdBy` no cambia.
  - Borrar: el dueño, o el miembro si es suyo.
- **`jobs`:**
  - Leer: dueño o miembro.
  - Crear: el dueño, con cualquier `createdBy` y `status`. El miembro, con `createdBy == request.auth.uid` y `status` `pending` o `rejected`, nunca `approved`. `rejected` es para que "Deshacer" pueda devolver un trabajo rechazado que se borró.
  - Editar, el dueño: cualquier `status`, y `createdBy` no cambia.
  - Editar, el miembro, solo si se cumple todo esto:
    - El trabajo es suyo y está `pending` o `rejected`.
    - El nuevo `status` es `pending`.
    - `createdBy` no cambia.
    - No toca `reviewedAt`.
  - Borrar: el dueño, o el miembro si es suyo y no está `approved`.
  - `validJob` suma `reviewedAt` (`optTime`).
- **Las reglas de `users/{uid}/…` quedan como están.**
- **Las reglas nuevas son compatibles con la app 1.1.2**: no le sacan nada al dueño. Por eso se publican **antes** de mergear.
- **Trampa:** Firestore tiene que poder probar la regla de lectura con la consulta. Con `where('members', 'array-contains', <mail en minúscula>)`, la regla tiene que comparar contra `request.auth.token.email.lower()`, el mismo valor. Si el simulador rechaza la consulta, es una condición de STOP.
- **Comentarios en las reglas**: solo encima de cada `function` o `match`, describiéndolo (CLAUDE.md).

### Novedad y CHANGELOG

- `lib/novedades.ts`: una entrada `version: '1.2.0'`, `destacado: true`, con la fecha del día del PR. El PR de release la corrige a la fecha real. Ítems para el usuario:
  - Compartir un auto con hasta 2 personas.
  - Qué puede hacer cada uno.
  - La aprobación de trabajos.
  - "Cargado por".
  - Sale primera en la lista, y `lib/novedades.test.ts` exige el orden por fecha.
- `CHANGELOG.md`: una entrada "## Próxima versión", con "### Novedades" para el usuario y "### Mantenimiento" para las reglas y lo técnico, y la aclaración de que hay que publicar las reglas antes del deploy. **No subas la versión** en `package.json`: la sube el PR de release.

## Orientación

- `lib/types.ts`: `Car` con `ownerUid`, `ownerName` y `members`. `Job` con `reviewedAt`.
- `lib/db.ts`: `carFrom`, la consulta de compartidos en `subscribeUserData`, `saveJob` según quién escribe, aprobar y rechazar, y salir de un auto.
- `lib/sharing.ts` (nuevo) y su prueba: permisos, validación de mails y filtro de logros.
- `lib/pending.ts` y `lib/pending.test.ts`: los tipos de pendiente nuevos.
- `components/providers/data-provider.tsx`: el mail del usuario hacia la suscripción y el contexto.
- `components/pending/pending-bell.tsx`: los ítems nuevos con sus acciones.
- `components/forms/car-form.tsx`: la sección Compartir.
- `components/forms/job-form.tsx`, `fuel-form.tsx`, `rule-form.tsx` y las pantallas de `app/(app)/autos/[carId]/…`: modo solo lectura, "Cargado por", y Aprobar y Rechazar en el detalle del trabajo.
- `app/(app)/autos/[carId]/page.tsx`: "Compartido por" o "Compartido con", "Salir de este auto", ocultar acciones del dueño, totales con trabajos aprobados y etiquetas de estado.
- `components/activity.tsx`: "Cargado por" y la etiqueta de estado.
- `app/(app)/gastos/page.tsx` y `components/report/export-dialog.tsx`: solo trabajos aprobados.
- `components/achievements/achievements-provider.tsx`: el filtro de "lo mío".
- `firestore.rules`.
- `lib/novedades.ts`, `CHANGELOG.md` y `INSTRUCTIONS.md` (modelo de datos, la línea de "Datos" en Seguridad y una sección "Autos compartidos" con permisos y estados).
- **No tocar**: el cron (`app/api/cron/daily/route.ts`, `lib/notifications.ts`), `lib/achievements.ts`, `lib/expenses.ts`, `scripts/` y `package.json`.

## Comandos

Política del operador: **el ejecutor no corre build, tests, typecheck ni lint, ni toca Firebase**. Dice qué
correr y espera la salida. El CI (`.github/workflows/ci.yml`) corre `npx next typegen`, `npm run typecheck` y
`npm test` en cada PR.

**Trampa:** `tsc` en la raíz del repo no revisa `.claude/worktrees/*`, porque saltea carpetas que empiezan con
punto. vitest sí las levanta. El typecheck se corre dentro del worktree, o lo hace el CI.

| Para qué | Comando | Resultado esperado |
|---|---|---|
| Tipos | `npx next typegen; npm run typecheck`, dentro del worktree | sale con código 0. Lo corre el operador o el CI. |
| Pruebas | `npm test` | todas pasan, incluidas las nuevas. Lo corre el operador o el CI. |
| Build | `npm run build` | lo hace Vercel. No lo corras. |
| Publicar reglas | consola de Firebase o `npx firebase-tools deploy --only firestore:rules --project <id>` | publica sin errores. Lo hace el operador **antes de mergear**. |

No hay emulador. Las reglas se prueban con el Simulador de reglas de la consola, con los casos de `tasks.md`.

## Enfoque sugerido

1. Tipos, `carFrom` y `lib/sharing.ts` con sus pruebas.
2. Suscripción con la consulta de compartidos (con el `permission-denied` no fatal). El mail en `DataProvider`.
3. `saveJob` según quién escribe, aprobar, rechazar y salir.
4. Reglas.
   **Verificar**: el operador corre los casos del simulador y todos dan lo esperado.
5. UI: Compartir, la vista del miembro, solo lectura, "Cargado por", estados y Aprobar/Rechazar.
6. Campanita.
7. Gastos, reporte y logros con el filtro.
8. Novedad, CHANGELOG e INSTRUCTIONS.
   **Verificar**: el operador o el CI corren typecheck y tests en verde.

## Condiciones de STOP

Pará y avisá si:

- El simulador muestra que un miembro no puede listar sus autos compartidos con la consulta `array-contains`, o que la regla de lectura de `cars` no se puede probar con esa consulta.
- Firestore pide un índice compuesto.
- Aprobar un trabajo obliga a escribir algo que las reglas del dueño no permiten.
- El filtro de logros obliga a cambiar `lib/achievements.ts`.
- Hace falta tocar el cron o `lib/notifications.ts`.
- Un control falla dos veces después de un intento razonable de arreglo.

## Notas de mantenimiento

- **PR 3**: los avisos para los miembros, el estado de "avisado" por persona y el resumen diario de trabajos para revisar.
- **Qué mirar en la revisión**:
  - Cada regla nueva de las reglas, sobre todo `affectedKeys` en los casos de km y de salir del auto.
  - Que un miembro nunca pueda crear ni dejar un trabajo `approved`.
  - Que la consulta de compartidos no pueda tirar abajo la app.
  - Que gastos, reporte y logros excluyan lo pendiente.
- **Salida**: publicar las reglas, mergear y verificar con dos cuentas. **No hace falta migrar datos.**
