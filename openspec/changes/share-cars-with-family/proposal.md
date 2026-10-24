# El dueño puede compartir un auto con hasta 2 personas

> **Instrucciones para el ejecutor**: tenés el repo. Hacé tu propio reconocimiento de los archivos del alcance
> antes de cambiar nada. Esta carpeta te da las decisiones, los límites y los criterios de terminado; el
> "Enfoque sugerido" de design.md es un consejo, no una ley. Pasá cada control de verificación y confirmá el
> resultado esperado. Si pasa algo de "Condiciones de STOP" en design.md, pará y avisá: no improvises alrededor
> de una decisión que la realidad contradice. Al terminar, actualizá la fila de este cambio en
> `openspec/changes/README.md`. Saltealo solo si te despachó un revisor de `execute` que dijo que mantiene el índice.
>
> **Build y commits**: según la política del proyecto (citada en design.md, "Comandos"). No hagas commit, push,
> cambio de rama ni worktree salvo que esa política o el operador lo pidan.

## Estado

- **Prioridad**: P1
- **Esfuerzo**: L
- **Riesgo**: HIGH (abre datos de un auto a otras cuentas; cambia las reglas de Firestore en producción)
- **Depende de**: `openspec/changes/move-cars-to-shareable-structure/` (DONE, salió en la 1.1.2)
- **Categoría**: direction
- **Planificado**: 2026-10-24
- **Origen**: ad hoc. PR 2 del "grupo familiar" (decisiones del usuario del 2026-10-23).

## Por qué

Desde la 1.1.2 cada auto vive en `cars/{carId}` con `ownerUid` y `members`, pero `members` está siempre vacío y
solo el dueño puede entrar. En una familia, el auto lo usan varias personas: hoy cada carga de combustible o km
que hace otra persona se pierde o la tiene que cargar el dueño. Este cambio permite que el dueño agregue hasta 2
mails al auto. Esas personas ven todo el auto y cargan combustible, km y trabajos. Los trabajos que cargan
esperan la aprobación del dueño antes de contar.

## Qué cambia

- **Compartir** (solo el dueño): en "Editar auto", una sección para agregar y sacar mails (hasta 2), con un botón para avisarle a la persona.
- **El familiar** ve el auto con "Compartido por <dueño>" apenas entra con ese mail, sin aceptar nada, y puede salir del auto.
- **Permisos**:
  - El familiar carga combustible, km y trabajos.
  - Edita o borra solo lo que cargó él. Un trabajo suyo, solo mientras está pendiente o rechazado.
  - No puede editar ni borrar el auto, cambiar la foto ni tocar el plan de mantenimiento.
  - El dueño sigue pudiendo todo.
- **Aprobación de trabajos**:
  - Un trabajo que carga el familiar queda `pending`. Cuando el dueño lo aprueba se aplican sus efectos (mantenimientos hechos, km). Si lo rechaza queda `rejected`, y el familiar lo puede corregir y reenviar, o borrar.
  - La campanita le muestra al dueño los trabajos para revisar, y al familiar los rechazados y los autos que le compartieron.
- **"Cargado por <nombre>"** en el historial y en los detalles de un auto compartido.
- **Gastos y reportes** cuentan solo los trabajos aprobados. **Los logros** de cada persona cuentan solo lo que cargó ella (y, en trabajos, solo lo aprobado).
- **Reglas de Firestore** que habilitan a los miembros.
- **Novedad destacada** para la 1.2.0 y la entrada del CHANGELOG en borrador.

## Fuera del alcance

- **Avisos push para los miembros** (vencimientos, pedido de km, resumen diario de trabajos para revisar): es el PR 3. Hace falta que el estado de "avisado" pase a ser por persona, y eso cambia el cron.
- **Mandar mails o invitaciones**: el usuario decidió no tener mailing. Alcanza con agregar el mail y avisar por WhatsApp con el botón de compartir.
- **Aceptar o rechazar la invitación**: el usuario decidió que el auto aparezca directo. El familiar puede salir cuando quiera.
- **"Volver al taller" en los trabajos del familiar**: crearía un mantenimiento, y el plan de mantenimiento es del dueño. Si se guardara para aplicarlo al aprobar, habría que sumar un campo nuevo. El familiar no ve esa opción.
- **Transferir el auto, varios dueños o roles intermedios**: no se pidieron.
- **El caso sin señal en que un trabajo deja el "hecho por última vez" de un mantenimiento más viejo que uno cargado mientras tanto en otro dispositivo**: con la aprobación, los efectos de un trabajo del familiar los aplica el dueño con datos frescos, así que el caso queda solo para los trabajos del dueño. Para resolverlo en las reglas, habría que distinguir una edición del formulario de un efecto de trabajo. Queda anotado.
- **Borrar los datos viejos de `users/{uid}/…`**: es el cambio de limpieza, aparte.
- **Subir la versión**: se hace en el PR de release (develop → main). Este cambio deja el CHANGELOG y la novedad listos.
