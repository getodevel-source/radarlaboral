# Datos geográficos de localidades censales

Fuente: Servicio Georef, Argentina.gob.ar, recurso completo de localidades censales:
<https://apis.datos.gob.ar/georef/api/v2.0/localidades-censales?max=5000>

Consulta: 9 de octubre de 2026. El servicio publica sus datos bajo la licencia Creative Commons Atribución 4.0 Internacional (CC BY 4.0):
<https://www.argentina.gob.ar/georef/condiciones-de-uso-y-licencia>

Atribución: Servicio Georef – <https://www.argentina.gob.ar/georef>.

Modificación: `resources/georef/localities.json` conserva el identificador y el nombre de la localidad censal, departamento, gobierno local cuando está disponible, provincia y centroide. El programa `npm run refresh:geography` descarga la respuesta completa, comprueba sus campos e identificadores y ordena los registros de forma estable.

Radar compara los centroides oficiales de localidades censales en línea recta; no calcula distancia ni tiempo de viaje. Georef puede publicar más de un registro para un nombre de localidad cuando se consulta la capa de asentamientos. El recurso censal representa cada localidad una sola vez y evita tratar esos puntos componentes como localidades homónimas. Si un nombre todavía aparece varias veces dentro de una provincia, se puede indicar el departamento y, si hace falta, el gobierno local en el perfil para desambiguarlo. El gobierno local no está disponible para todos los registros; si la localidad sigue sin ser inequívoca, Radar conserva el aviso y explica que no aplicó el radio. Fuente de los campos y relaciones: [referencia del endpoint de localidades censales](https://georef.argentina.apidocs.ar/operations/get-localidades-censales).
