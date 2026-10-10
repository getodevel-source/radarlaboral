# Auditoría de dependencias

Revisión: **9 de octubre de 2026**. Paquete actual: Radar Laboral 0.4.139. Se conserva electron-builder `27.0.0-alpha.10`: la revalidación oficial de tags no encontró una versión estable 27 y la estable 26.17.0 informa ocho hallazgos moderados. Las auditorías completa y de producción del lockfile 0.4.139 informan cero vulnerabilidades. Evidencia del lockfile: [QA-DEPENDENCY-AUDIT.json](../package-evidence/0.4.139/QA-DEPENDENCY-AUDIT.json); revalidación de builder y tags: [QA-BUILDER-RECHECK.json](../package-evidence/0.4.139/QA-BUILDER-RECHECK.json).

Los tags consultados con `npm view electron-builder dist-tags --json` son `latest=26.15.3`, `v26=26.17.0` y `next=27.0.0-alpha.10`; el [registro oficial de lanzamientos](https://github.com/electron-userland/electron-builder/releases) marca 26.17.0 como estable y 27.0.0-alpha.10 como pre-release. La reauditoría aislada de 26.17.0 encontró ocho alertas moderadas en `@electron/get`, `app-builder-lib`, `dmg-builder`, `electron-builder`, `electron-builder-squirrel-windows`, `global-agent`, `roarr` y `sprintf-js`. npm propone 26.5.0 como corrección, pero su auditoría aislada presenta ocho alertas altas y una crítica. El registro actual y los hashes de ambos lockfiles están en [QA-BUILDER-RECHECK.json](../package-evidence/0.4.139/QA-BUILDER-RECHECK.json).

## Resultados

| Comprobación | Resultado | Alcance |
| --- | --- | --- |
| `npm audit` | 0 hallazgos | El lockfile 0.4.139 mantiene fuera del árbol las ocho alertas moderadas de electron-builder 26.17.0; ver [QA-DEPENDENCY-AUDIT.json](../package-evidence/0.4.139/QA-DEPENDENCY-AUDIT.json). |
| `npm audit --omit=dev` | 0 hallazgos | 25 dependencias de producción. Esta opción omite las herramientas de desarrollo. |
| Auditoría aislada de versiones estables | 26.15.3, 26.16.1 y 26.17.0: 8 moderadas cada una; 26.5.0: 8 altas y 1 crítica | Los candidatos se resolvieron en manifiestos aislados con `--package-lock-only --ignore-scripts`; los SHA-256 están en [QA-BUILDER-COMPATIBILITY.json](../package-evidence/0.4.124/QA-BUILDER-COMPATIBILITY.json). La reauditoría de 26.17.0 el 9 de octubre de 2026 confirma los ocho hallazgos en [QA-BUILDER-RECHECK.json](../package-evidence/0.4.139/QA-BUILDER-RECHECK.json). 26.17.0 pasó un build NSIS x64 y smoke de instalación en aislamiento; 26.15.3 y 26.16.1 no se compilaron. |
| Inspección de `app.asar` del paquete 0.4.139 | 918 rutas; excluye `tests/`, `sprintf-js`, `roarr`, `global-agent` y `@electron/get` | Confirmado por inspección del archivo y por el smoke del instalador 0.4.139; informe en `release/0.4.139/QA-PACKAGE.json`. |

El lockfile actual fija `electron-builder@27.0.0-alpha.10` y `app-builder-lib@27.0.0-alpha.10`; ambos usan `@electron/get@5.1.0`. El árbol no instala `sprintf-js`, `roarr` ni `global-agent`. Las auditorías actualizadas del proyecto informan cero hallazgos.

La [alerta GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) afecta `sprintf-js` hasta 1.1.3 y no enumera una versión corregida. Puede provocar una excepción `RangeError` ante especificadores de precisión sin límite cuando una entrada no confiable llega a esas funciones. [npm](https://www.npmjs.com/package/sprintf-js?activeTab=versions) sigue publicando 1.1.3. En el lockfile 0.4.139 el paquete no forma parte del árbol.

Con electron-builder 26.17.0, `npm audit` propone `26.5.0` como corrección automática. Esa degradación da nueve hallazgos (ocho altos y uno crítico), por lo que no se adopta. El re-chequeo 0.4.139 confirma los ocho moderados de 26.17.0 y cero en la alfa 27.0.0-alpha.10. Se mantiene la alfa fijada mientras no haya una versión estable compatible sin esos hallazgos.

## Interpretación y seguimiento

La auditoría completa incluye herramientas de compilación y `electron@44.7.0`; las dos auditorías del paquete 0.4.139 informan cero hallazgos. Electron se distribuye dentro de la aplicación y queda fuera de lo que omite `npm audit --omit=dev`. Sigue pendiente reemplazar electron-builder 27.0.0-alpha.10 por una versión estable que no recupere los hallazgos moderados. El build NSIS, el smoke de instalación y UI Automation del paquete 0.4.139 pasaron.

Repetir ambas auditorías si cambia el lockfile y antes de publicar. Revaluar la fijación cuando electron-builder 27 llegue a estable y revisar la compatibilidad antes de actualizar.
