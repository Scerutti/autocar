# Tasks: share-cars-with-family

## Implementación

- [x] 1.1 `lib/types.ts`: `Car` con `ownerUid`, `ownerName` y `members`. `Job` con `reviewedAt`. `carFrom` y `jobFrom` los leen.
- [x] 1.2 `lib/sharing.ts` (nuevo): permisos, validación de mails y filtro de "lo mío" para los logros, con sus pruebas.
- [x] 1.3 `subscribeUserData`: la consulta de compartidos unida a la de `ownerUid`. Un `permission-denied` en esa consulta no es fatal. El mail llega desde `DataProvider`.
- [x] 1.4 `lib/db.ts`: `saveJob` graba `pending` sin efectos si escribe un miembro, y al editar vuelve a `pending`. Aprobar aplica los efectos con los datos del dueño. Rechazar. Salir del auto. Sumar y sacar mails.
- [x] 1.5 `firestore.rules`: los permisos de miembro de design.md.
- [x] 1.6 Compartir en `car-form.tsx`: lista, sumar, sacar y Avisarle, con confirmaciones.
- [x] 1.7 Pantalla del auto: "Compartido por" o "Compartido con", "Salir de este auto", acciones del dueño ocultas para el miembro, totales con trabajos aprobados.
- [x] 1.8 Formularios y detalles: solo lectura cuando no se puede editar, "Cargado por", sin "Volver al taller" para el miembro, aviso en mantenimientos, etiquetas Pendiente y Rechazado, Aprobar y Rechazar en el detalle de un trabajo pendiente.
- [x] 1.9 `components/activity.tsx`: "Cargado por" en autos compartidos y la etiqueta de estado.
- [x] 1.10 Campanita: trabajos para revisar, rechazados y autos compartidos nuevos, con sus acciones y el orden de design.md.
- [x] 1.11 Gastos y reporte en PDF: solo trabajos aprobados. Logros con el filtro de "lo mío".
- [x] 1.12 `lib/novedades.ts` con la 1.2.0 destacada. `CHANGELOG.md` con "Próxima versión". `INSTRUCTIONS.md`: modelo, seguridad y "Autos compartidos".

## Pruebas y verificación manual

**Pruebas nuevas (vitest):**

- `lib/sharing.ts`:
  - El dueño puede editar todo.
  - El miembro puede editar solo lo suyo.
  - El miembro no puede editar un trabajo suyo `approved`, y sí uno `pending` o `rejected`.
  - Un mail inválido, en mayúsculas, el del dueño, repetido o un tercero se rechaza.
  - El filtro de logros deja afuera lo de otros y los trabajos no aprobados, y pone `rules: []` en un auto compartido conmigo.
- `lib/pending.ts`:
  - El dueño ve los trabajos para revisar.
  - El miembro ve sus rechazados.
  - Un auto compartido aparece hasta marcarlo visto.
  - El orden y el número son los de design.md.

**Simulador de reglas** (antes de publicar). A es el dueño, M es miembro del auto de A (su mail en minúscula está en `members`) y X es otra cuenta registrada:

1. M lee el auto de A → permitido. X lo lee → denegado.
2. M lista `cars` con `where('members', 'array-contains', <mail de M>)` → permitido.
3. M edita el auto de A cambiando solo `currentKm`, `kmUpdatedAt` y `avgKmPerDay` → permitido. Cambiando `brand` → denegado.
4. M saca su mail de `members` → permitido. Saca otro mail o agrega uno → denegado.
5. M crea una carga con `createdBy = M` → permitido. Con `createdBy = A` → denegado. Borra una carga de A → denegado.
6. M crea un trabajo `pending` con `createdBy = M` → permitido. `approved` → denegado.
7. M edita su trabajo `pending` dejándolo `pending` → permitido. Lo pasa a `approved` → denegado. Edita un trabajo suyo `approved` → denegado.
8. A pasa el trabajo de M a `approved` con `reviewedAt` → permitido.
9. M crea o edita un mantenimiento → denegado. Lo lee → permitido.
10. X crea una carga en el auto de A → denegado.

**Con dos cuentas** (después de publicar las reglas y desplegar), A dueña y M:

1. A agrega el mail de M en "Editar auto" → Compartir y confirma. **Avisarle** abre el menú de compartir del celular.
2. M entra. El auto aparece con "Compartido por A", y la campanita muestra "A te compartió su auto" una sola vez.
3. M ve trabajos, combustible, km, mantenimientos y gastos del auto. No ve "Editar auto" ni "Agregar mantenimiento".
4. M carga km. El km del auto sube enseguida, también para A.
5. M carga combustible. Aparece para A con "Cargado por M". M la puede editar y borrar. Una carga de A, M solo la ve.
6. M carga un trabajo que marca un mantenimiento. Queda "Pendiente": no cambia el mantenimiento ni los gastos. A lo ve en la campanita.
7. A rechaza el trabajo. M lo ve "Rechazado" en la campanita, lo corrige y lo reenvía. Vuelve a "Pendiente".
8. A lo aprueba. El mantenimiento vuelve a "al día", el trabajo suma en gastos y M no lo puede editar más.
9. Logros: lo que cargó M no le da logros a A, y viceversa.
10. M toca "Salir de este auto" y confirma. El auto le desaparece, y A ve que ya no está compartido.
11. A borra un auto compartido de prueba. Le desaparece a M sin la pantalla de error.

## Criterios de terminado

**Este es el contrato.** La revisión verifica estos resultados:

- [ ] Typecheck y tests en verde (los corre el operador o el CI). Las pruebas nuevas cubren los casos de arriba.
- [ ] Los 10 casos del simulador dan lo esperado (los confirma el operador antes de publicar).
- [x] Un miembro nunca puede crear ni dejar un trabajo `approved`: lo garantizan las reglas, no solo la UI.
- [x] La consulta de compartidos con `permission-denied` no muestra la pantalla de error.
- [x] Gastos, reporte y logros excluyen los trabajos `pending` y `rejected`.
- [x] Un auto sin compartir se ve igual que antes, sin "Cargado por" ni textos nuevos.
- [x] No cambia el cron, `lib/notifications.ts`, `lib/achievements.ts`, `lib/expenses.ts`, `scripts/` ni `package.json`.
- [x] No hay comentarios inline nuevos (CLAUDE.md).
- [x] La novedad 1.2.0 está destacada y el CHANGELOG tiene "Próxima versión", con el aviso de publicar las reglas antes del deploy.
- [ ] La fila de este cambio en `openspec/changes/README.md` está actualizada.
- [ ] Después del deploy (lo confirma el operador): los 11 pasos con dos cuentas dan lo esperado.
