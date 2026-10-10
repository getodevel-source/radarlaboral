# Avisos de componentes de terceros

## OCR local

- `tesseract.js` 7.0.0 y `tesseract.js-core` 7.0.0: Apache-2.0. El texto de licencia está en [Apache-2.0.txt](third-party-licenses/Apache-2.0.txt).
- Los modelos `spa` y `eng` de `@tesseract.js-data` 1.0.0 (`4.0.0_best_int`): MIT. El texto de licencia está en [MIT-Tesseract-data.txt](third-party-licenses/MIT-Tesseract-data.txt). Los modelos se distribuyen dentro del instalador en `resources/ocr`.
- El motor WebAssembly incorpora Tesseract (Apache-2.0), Leptonica (BSD-2-Clause), libwebp (BSD-3-Clause), giflib (MIT), zlib y libpng (zlib/libpng), libjpeg, libtiff y openlibm. El mantenedor documenta las licencias y atribuciones en la [revisión oficial de licencias de tesseract.js-core](https://github.com/naptha/tesseract.js-core/issues/44).

La app carga los modelos locales desde el paquete instalado y desactiva la caché del motor OCR. El reconocimiento no necesita conectarse a un servicio externo.
