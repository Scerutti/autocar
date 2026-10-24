# Delta for Garage data

## ADDED Requirements

### Requirement: Los autos son documentos de primer nivel con dueño
El sistema MUST guardar cada auto en `cars/{carId}` con `ownerUid`, `ownerName` y `members`, y sus mantenimientos, trabajos, cargas y lecturas de km en subcolecciones de ese auto.

#### Scenario: Crear un auto
- GIVEN un usuario registrado
- WHEN crea un auto con sus km iniciales
- THEN existe `cars/{carId}` con `ownerUid` igual a su uid y `members` vacío
- AND existe una lectura inicial en `cars/{carId}/odometer`

#### Scenario: Otra cuenta no ve el auto
- GIVEN un auto de la cuenta A
- WHEN la cuenta B intenta leer el auto o cualquiera de sus subcolecciones
- THEN Firestore rechaza la lectura

### Requirement: Cada registro guarda quién lo cargó
El sistema MUST guardar `createdBy` y `createdByName` en cada trabajo, carga de combustible y lectura de km al crearlo, y MUST NOT cambiarlos al editarlo.

#### Scenario: Editar una carga
- GIVEN una carga creada por la cuenta A
- WHEN A la edita
- THEN `createdBy` sigue siendo el uid de A

#### Scenario: Deshacer un borrado
- GIVEN un trabajo borrado
- WHEN el usuario toca "Deshacer"
- THEN el trabajo vuelve con su `createdBy`, `createdByName` y `status` originales

### Requirement: Los trabajos tienen estado de aprobación
El sistema MUST guardar `status` en cada trabajo con uno de `approved`, `pending` o `rejected`. Un trabajo que carga el dueño SHALL quedar `approved`.

#### Scenario: Trabajo viejo sin estado
- GIVEN un trabajo guardado antes de este cambio, sin `status`
- WHEN la app lo lee
- THEN lo trata como `approved`

### Requirement: Migración de los datos existentes
El sistema MUST ofrecer un script que copie los datos de `users/{uid}/…` a `cars/…` manteniendo los ids, sin borrar el origen y sin pisar documentos que ya existen en el destino.

#### Scenario: Correr la migración dos veces
- GIVEN una migración ya aplicada
- WHEN se vuelve a correr con `--apply`
- THEN no se modifica ningún documento existente y solo se copian los que faltan

### Requirement: Borrar un auto borra todo lo asociado
El sistema MUST borrar las subcolecciones del auto antes que el documento del auto, de modo que no queden documentos huérfanos que nadie pueda borrar.

#### Scenario: Borrar un auto con datos cargados desde otro dispositivo
- GIVEN un auto con cargas que este dispositivo no tiene en memoria
- WHEN el dueño borra el auto
- THEN no queda ningún documento en `cars/{carId}` ni en sus subcolecciones

### Requirement: El usuario ve los mismos datos que antes
Después de migrar, la app MUST mostrar los mismos autos, registros, estados de mantenimiento, gastos y logros que antes de la migración.

#### Scenario: Primer ingreso después de migrar
- GIVEN una cuenta migrada
- WHEN el dueño abre la app
- THEN ve los mismos autos con los mismos km, mantenimientos, trabajos, cargas y gastos
- AND no aparece ninguna celebración de logros nueva
