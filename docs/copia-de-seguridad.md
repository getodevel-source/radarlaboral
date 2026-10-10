# Copias de seguridad y restauración

Radar Laboral guarda perfiles, vacantes, fuentes, preferencias, postulaciones, borradores, datos confirmados del perfil personal y CV en el almacenamiento local de Windows. Para protegerlos ante la pérdida de la computadora o un problema del disco, se puede crear y restaurar una copia desde **Preferencias → Copias de seguridad**.

## Crear una copia

1. En Preferencias, elegí **Crear copia de seguridad**.
2. Seleccioná una carpeta de destino. La app crea dentro de ella una carpeta nueva con fecha e identificador.
3. Conservá esa carpeta completa. Incluye `manifest.json`, `radar-laboral.sqlite` y los PDF de CV en `resumes/`.

La app toma una instantánea de la base y copia solo los CV registrados en esa instantánea. Si falta un PDF o cambia mientras se crea la copia, se cancela la operación y elimina la carpeta incompleta. Se puede guardar más de una copia; cada ejecución usa una carpeta distinta.

## Restaurar

1. En Preferencias, elegí **Restaurar desde una copia** y confirmá la advertencia.
2. Seleccioná la carpeta creada por Radar Laboral, la que contiene directamente el manifiesto, la base y `resumes/`.
3. La app comprueba el formato y la integridad de SQLite, verifica las tablas requeridas, valida los PDF y que sus nombres correspondan a los CV guardados. Si falla una comprobación, conserva los datos actuales.
4. Si la copia es válida, Radar Laboral reemplaza sus datos locales por los de la copia y se reinicia. Las rutas internas de los CV se adaptan a la nueva ubicación local.

La restauración reemplaza los datos locales actuales incluidos en la copia, por lo que los cambios posteriores a la fecha de esa copia no estarán allí. Elegí una carpeta que contenga la copia completa; no selecciones la carpeta `resumes/` por separado.

## Privacidad y clave de IA

La base de datos y los CV contienen información personal y se guardan sin cifrar dentro de la copia. Guardala en un medio y ubicación a los que solo vos tengas acceso. Si la compartís o la subís a un servicio externo, esa persona o servicio podrá leer esos datos.

La clave opcional de IA se guarda cifrada con Electron `safeStorage`, que en Windows usa DPAPI. Windows normalmente permite descifrarla con las mismas credenciales de inicio de sesión que la protegieron; otra cuenta de Windows o una computadora distinta puede no poder recuperarla. Si al restaurar no se puede usar, configurá una clave nueva en Preferencias. [Documentación oficial de Electron sobre `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage).

## Alcance

La copia está pensada para recuperarse con Radar Laboral en Windows. El manifiesto incluye la versión de la app y la versión de formato de la copia. La restauración rechaza formatos que no reconoce; para versiones futuras conviene crear una copia nueva antes de actualizar. Los originales de CV que la persona haya guardado fuera de Radar Laboral no se incluyen.
