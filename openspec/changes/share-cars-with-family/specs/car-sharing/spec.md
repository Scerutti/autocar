# Delta for Car sharing

## ADDED Requirements

### Requirement: El dueño comparte un auto por mail
El sistema MUST permitir que el dueño agregue hasta 2 mails a un auto y los saque, y MUST mostrarle el auto a esas cuentas apenas entran con ese mail.

#### Scenario: Compartir con una persona
- GIVEN A dueña de un auto
- WHEN A agrega el mail de M y confirma
- THEN M ve el auto con "Compartido por A" la próxima vez que abre la app

#### Scenario: Tope de personas
- GIVEN un auto con 2 mails
- WHEN el dueño intenta agregar un tercero
- THEN la app no lo permite

### Requirement: El familiar carga pero no administra
Un miembro MUST poder cargar combustible, km y trabajos, y editar o borrar solo lo que cargó él. MUST NOT poder editar o borrar el auto, cambiar su foto ni cambiar el plan de mantenimiento.

#### Scenario: Carga ajena
- GIVEN una carga de combustible de A
- WHEN M la abre
- THEN la ve en modo solo lectura, con "Cargado por A"

#### Scenario: Km del familiar
- GIVEN M miembro de un auto
- WHEN M carga km más altos que los actuales
- THEN el km del auto sube enseguida para todos

### Requirement: Los trabajos del familiar se aprueban
Un trabajo cargado por un miembro MUST quedar pendiente y MUST NOT marcar mantenimientos, registrar km ni contar en gastos, reportes o logros hasta que el dueño lo apruebe.

#### Scenario: Aprobar
- GIVEN un trabajo pendiente de M que marca un mantenimiento
- WHEN A lo aprueba
- THEN el mantenimiento queda hecho en la fecha y km del trabajo, el trabajo cuenta en gastos y M ya no lo puede editar

#### Scenario: Rechazar y reenviar
- GIVEN un trabajo pendiente de M
- WHEN A lo rechaza
- THEN M lo ve como rechazado en la campanita, puede corregirlo y reenviarlo, y vuelve a quedar pendiente

### Requirement: Salir de un auto compartido
Un miembro MUST poder salir de un auto compartido. Al salir, el auto deja de aparecerle y lo que cargó queda en el auto.

#### Scenario: Salir
- GIVEN M miembro de un auto
- WHEN M toca "Salir de este auto" y confirma
- THEN el auto le desaparece a M y su mail ya no está en el auto

### Requirement: Los logros son de cada persona
Los logros de una persona MUST contar solo los registros que cargó ella y, en trabajos, solo los aprobados.

#### Scenario: Km cargados por otro
- GIVEN M carga km todas las semanas en el auto de A
- WHEN se evalúan los logros de A
- THEN esas lecturas no cuentan para A
