# Instalación y publicación

Esta guía cubre la instalación del paquete Windows generado por este proyecto
y los pasos restantes para distribuirlo públicamente.

## Instalar desde el paquete local

1. Compilá y verificá el instalador:
   ```powershell
   npm run typecheck
   npm run lint
   npm run test
   npm run build
   npm run smoke:package
   ```
2. El instalador queda en `release/<versión>/Radar Laboral-Windows-<versión>-Setup.exe`.
3. Ejecutalo con una cuenta de Windows con permiso de instalación.
   El asistente NSIS permite elegir la carpeta de instalación.
4. Al abrir la app por primera vez, revisá **Preferencias**:
   la versión instalada aparece al pie. Creá un perfil en **Búsquedas**,
   cargá CV en **Mis CV** y agregá fuentes en **Fuentes**.
5. Si querés búsquedas con la app cerrada, activá
   **Buscar aunque Radar esté cerrado** en Preferencias.
   Windows registra una tarea programada para tu cuenta, sin contraseña
   y con privilegios mínimos.

Los datos (SQLite y CV) quedan en la carpeta de datos de Electron del
usuario. La desinstalación conserva los datos y no toca la tarea
programada (verificado por `smoke:package` con código de salida 0).

## Advertencia de editor desconocido

El instalador generado en este proyecto **no tiene firma digital** mientras
no se configure un certificado de publicación: Windows SmartScreen muestra
una advertencia de editor desconocido al ejecutarlo. Esto es esperado en
etapas de prueba internas y no afecta el funcionamiento.

## Firmar para distribución pública

1. Conseguí un certificado de firma de código con clave privada
   (proveedor de CA pública o PKI interna según el público objetivo).
2. Configuralo en el entorno de compilación con las variables que
   `electron-builder` reconoce para Windows
   (`CSC_LINK` con la ruta al certificado y `CSC_KEY_PASSWORD` con su
   clave), o firmá los artefactos (`Radar Laboral.exe` y el instalador
   `*-Setup.exe`) después de compilar con tu herramienta de firma.
3. Recompilá con `npm run build` y revalidá con `npm run smoke:package`:
   el informe `QA-PACKAGE.json` incluye el bloque `signatures` con el
   estado de firma del instalador y del ejecutable.
4. Publicá el instalador firmado junto con su `SHA256SUMS.txt`
   (`release/<versión>/`) para que cada instalación pueda verificarse.

Sin firma configurada, `electron-builder` informa `signing skipped`
y el smoke registra `NotSigned` en ambas firmas. No se distribuye
públicamente sin completar este paso.

## Actualizaciones automáticas (GitHub Releases)

La app busca actualizaciones en GitHub Releases con `electron-updater`,
las descarga en segundo plano y las instala al salir (**Preferencias →
Versión de la app → Buscar actualizaciones**; si ya está lista,
**Instalar y salir**). El chequeo también corre solo al abrir la app.

1. Creá el repo GitHub que alojará los releases y anotá `owner` y `repo`.
2. Generá la clave Ed25519 de manifiestos con `npx electron-builder create-update-key` (escribe `update-private-key.pem`): guardá el PEM fuera del repo y exportá `ELECTRON_BUILDER_UPDATE_SIGN_KEY_FILE` con su ruta (o el contenido en `ELECTRON_BUILDER_UPDATE_SIGN_KEY`). Sin esta clave, `build:publish` se niega a continuar porque electron-builder 27 exige `latest.yml` firmado.
3. Exportá en la máquina de build:
   `RADAR_UPDATE_GITHUB_OWNER=<owner>`,
   `RADAR_UPDATE_GITHUB_REPO=<repo>` y `GH_TOKEN` (token con permiso
   `contents:write`).
4. Publicá con `npm run build:publish`: typecheck + lint + tests +
   evidencia + `vite build` + resolución del bloque `publish` (falla sin clave Ed25519) +
   `electron-builder --win nsis --publish always`. El release incluye el
   instalador `radarlaboral-Windows-<versión>-Setup.exe` (sin espacios: el updater pide el asset con guiones) y `latest.yml` firmado,
   que la app instalada usa para detectar y verificar la descarga.
5. Subí la versión en `package.json` en cada release: el updater compara
   semver y solo ofrece versiones mayores.

Sin `owner`/`repo` configurados, el build local genera el instalador sin
publicar y la app muestra en Preferencias que las actualizaciones automáticas
no están configuradas todavía. En desarrollo (`npm run dev`, sin empaquetar)
el estado es el mismo a propósito: el updater solo corre empaquetado.
