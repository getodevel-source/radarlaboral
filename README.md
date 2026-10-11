# Radar Laboral

Una app de Windows para organizar tu búsqueda de trabajo: juntá avisos, comparalos con lo que buscás y llevá el seguimiento de cada postulación. Todo queda guardado en tu computadora.

## Descargar

👉 **[Descargar la última versión](https://github.com/getodevel-source/radarlaboral/releases/latest)**

Elegí el archivo `radarlaboral-Windows-<versión>-Setup.exe` e instalalo como cualquier programa.

> Al instalar, Windows puede mostrar un aviso de "editor desconocido": el instalador todavía no tiene firma digital. Es esperado. Descargalo siempre desde esta página de Releases y no desde enlaces de terceros.

## Primeros pasos

1. **Contale qué buscás.** En *Búsquedas*, creá un perfil con los puestos, palabras clave, localidades, modalidad y sueldo mínimo que te sirven.
2. **Cargá tu CV.** En *Mis CV*, subí una o varias versiones en PDF. Quedan en tu PC; si alguna página es escaneada, la app intenta leerla sola.
3. **Agregá de dónde mirar.** En *Fuentes*, sumá portales para abrir a mano o conectá fuentes automáticas verificadas (ya trae más de 70 listas para agregar con un clic).
4. **Revisá los avisos.** En *Vacantes*, cada aviso muestra por qué coincide con tu perfil y qué datos le faltan. Cambiá su estado a medida que avances: nueva, revisada, guardada, postulada o descartada.
5. **No pierdas el hilo.** En *Seguimiento*, anotá cuándo te postulaste y cuándo retomar el contacto: la app te avisa cuando llega la fecha.

Así se ve con datos de ejemplo:

![Resumen: tus perfiles y últimos avisos en un solo lugar](docs/images/resumen.png)

![Tus perfiles de búsqueda con puestos, localidad y sueldo](docs/images/busquedas.png)

![Vacantes con estado, porcentaje de coincidencia y seguimiento](docs/images/vacantes.png)

## Tus datos quedan en tu PC

Perfiles, avisos, CV, borradores y notas se guardan solo en tu computadora. Nada se sube a ningún servidor. Desde *Preferencias → Copias de seguridad* podés guardar una copia y restaurarla cuando quieras.

## Lo que NO hace (sin letra chica)

- **No se postula por vos.** Vos revisás cada aviso y enviás la postulación en el sitio de empleo. La app no inicia sesión en portales ni guarda sus contraseñas.
- **La ayuda con IA es opcional.** Solo se usa si la configurás y pedís redactar un mensaje; revisalo siempre antes de usarlo.
- **Las distancias son aproximadas.** El radio se calcula en línea recta entre localidades, no es tiempo de viaje.
- **Puede equivocarse.** Si un aviso no trae un dato (sueldo, fecha, localidad), lo conserva y te lo dice en vez de descartarlo.

## Actualizaciones

La app se actualiza sola: cuando hay una versión nueva la descarga y te avisa, y se instala al salir. También podés buscarla cuando quieras desde *Preferencias → Versión de la app*.

## Ayuda

- [Guía de uso](docs/guia-de-uso.md): el paso a paso completo.
- [Copias de seguridad](docs/copia-de-seguridad.md): qué se guarda y cómo restaurarlo.
- [Instalación](docs/instalacion.md): detalles de instalación y publicación.

## Para desarrolladores

```powershell
npm install
npm run dev
```

Necesitás Windows 10 o posterior y Node.js 24+. Los detalles de compilación, verificación y publicación están en [Instalación](docs/instalacion.md). Licencia [MIT](LICENSE).
