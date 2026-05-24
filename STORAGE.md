# Almacenamiento local de medios

El proyecto guarda imagenes y audios en la VPS mediante un adapter (`LocalVpsStorageAdapter`) ubicado en `packages/platform-data/src/media`. La logica de negocio no escribe directo al filesystem: usa `saveImage`, `saveAudio`, `delete` y `resolvePublicUrl`.

## Configuracion

Hay dos variables de entorno de sistema:

- `MEDIA_STORAGE_BASE_PATH`: carpeta persistente donde se guardan archivos.
- `MEDIA_STORAGE_PUBLIC_BASE_URL`: URL publica que sirve esa carpeta, sin slash final.

La configuracion funcional vive en el board, dentro del detalle del tenant, en `Configuracion -> Almacenamiento de medios`. Se persiste en `tenants.bot_config.media_storage` e incluye toggles, limites, formatos permitidos, resize, calidad, formato de salida, thumbnails y EXIF.

## Flujo

- Upload manual: `POST /api/admin/tenants/[slug]/media` valida sesion del board, MIME real, limites configurados y formatos permitidos. Las imagenes pasan por `processImage`; los audios se guardan sin procesar.
- Listado/borrado: `GET` y `DELETE` del mismo endpoint leen o eliminan archivos del tenant desde el adapter.
- Productos: el campo existente `products.image_url` se reutiliza. No se agrego columna nueva.
- Importacion CSV: si `media_storage.enabled` y `media_storage.importProductsEnabled` estan activos, las imagenes externas se descargan, se procesan y `image_url` queda apuntando a la URL local.
- Bot: antes de enviar imagen/audio, `sender.js` resuelve la URL final con el adapter. Si la URL no pertenece al storage local, mantiene el comportamiento anterior.

## Cambiar a S3 en el futuro

Implementar un adapter con la misma interfaz del `LocalVpsStorageAdapter`:

- `saveImage(args)`
- `saveAudio(args)`
- `delete(relativePath)`
- `resolvePublicUrl(relativePath)`

Luego cambiar la factory usada por los endpoints/importadores/sender. La logica de productos, flows y WhatsApp no deberia cambiar.

## Pasos manuales en la VPS

1. Crear carpeta persistente:
   `sudo mkdir -p /var/lib/whatsapp-saas/media`
2. Asignar permisos al usuario del proceso Node/Docker:
   `sudo chown -R <usuario>:<grupo> /var/lib/whatsapp-saas/media`
3. Configurar env:
   `MEDIA_STORAGE_BASE_PATH=/var/lib/whatsapp-saas/media`
   `MEDIA_STORAGE_PUBLIC_BASE_URL=https://media.tudominio.com`
4. Servir la carpeta con Nginx, por ejemplo:
   `location / { alias /var/lib/whatsapp-saas/media/; try_files $uri =404; }`
5. Asegurar HTTPS para `MEDIA_STORAGE_PUBLIC_BASE_URL`.
6. Reiniciar dashboard y message-worker para tomar las nuevas variables.
7. En el board, activar `Almacenar imagenes y audios en la VPS` por tenant y ajustar limites/formato/calidad.
