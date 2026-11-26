# Worker de avisos (Web Push) — Viajo

Guarda las rutinas de cada dispositivo y, **cada minuto**, revisa si toca enviar un aviso:

| Aviso | Cuándo | Contenido |
|---|---|---|
| 1 | 2 h antes de la hora de llegada | línea recomendada, hora y parada, y cuándo salir de casa |
| 2 | 30 min antes de que salga el colectivo | "en 30 minutos sale…" (con el arribo en vivo si hay) |
| 3 | 15 min antes | "en 15 minutos sale… ya es hora de salir" |

Corre en [Cloudflare Workers](https://workers.cloudflare.com/) (plan gratuito alcanza). Usa el planificador oficial de Cómo Llego para elegir la mejor ruta.

## Publicarlo (una sola vez)

Necesitás una cuenta de Cloudflare (gratis). **Estos pasos los hacés vos**: `wrangler login` abre el navegador para autorizar tu cuenta.

```powershell
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create DB          # copiá el "id" que devuelve en wrangler.toml → [[kv_namespaces]] id
npm run keys                                 # genera las claves VAPID (worker/vapid-keys.json, NO se sube a git)
npx wrangler secret put VAPID_PUBLIC_KEY     # pegá "publicKey" de vapid-keys.json
npx wrangler secret put VAPID_PRIVATE_KEY    # pegá "privateKey" de vapid-keys.json
npx wrangler deploy
```

`deploy` imprime la URL del worker (`https://viajo-push.<tu-usuario>.workers.dev`). Después:

1. En GitHub: *Settings → Secrets and variables → Actions → Variables → New repository variable*
   `VITE_PUSH_URL` = esa URL (sin barra final). Se vuelve a publicar la web con la URL ya integrada.
2. Abrí la web, pestaña **Rutinas → Activar notificaciones → Enviar prueba**.

> **iPhone/iPad:** los avisos sólo funcionan si agregás Viajo a la pantalla de inicio (Compartir → *Agregar a inicio*) y la abrís desde ahí.

## Probar en local

```powershell
cd worker
npm run keys        # crea también worker/.dev.vars con DEBUG=1
npm run dev         # http://localhost:8787
```

Con `DEBUG=1` y `DEBUG_TOKEN` (ambos en `.dev.vars`) existe `GET /debug/tick?now=2026-11-26T18:00:00Z` con el header `Authorization: Bearer <DEBUG_TOKEN>` (modo simulación: devuelve los mensajes sin enviarlos).
`.env.local` de la app con `VITE_PUSH_URL=http://localhost:8787` conecta la web con este worker.

## Seguridad y privacidad

- La **clave privada VAPID** sólo vive como *secret* de Cloudflare y en `worker/vapid-keys.json` (ignorado por git). El repo es público: no la subas.
- Sólo se aceptan *endpoints* de servicios push conocidos (Google, Mozilla, Apple, Microsoft) y **sólo desde los orígenes de `ALLOWED_ORIGINS`** (CORS no es autenticación: es una barrera contra uso desde otras webs, no contra scripts). Una suscripción nueva se verifica mandándole un aviso de bienvenida; si el servicio push la rechaza, no se guarda.
- Abuso: tope de 200 suscripciones, cuerpos de hasta 32 KB, límite por IP (en memoria del isolate, best effort) y enfriamiento de 60 s para `/test`. Los errores son genéricos y no revelan detalles internos.
- `/debug/tick` sólo existe con `DEBUG=1` **y** el header `Authorization: Bearer <DEBUG_TOKEN>`. No definas `DEBUG` en producción (`wrangler.toml` no lo define; `worker/.dev.vars` es sólo local).
- **Qué se guarda** (en Cloudflare KV): la suscripción push (endpoint y claves del navegador), tu nombre (opcional), tus rutinas (nombres, direcciones/coordenadas de origen y destino, días y hora) y, **sólo si alguna rutina usa "mi ubicación"**, tu última ubicación enviada por la app abierta.
- **Por cuánto tiempo:** la ubicación se descarta a las 6 h (y se usa sólo si tiene menos de 3 h); toda la suscripción expira tras **45 días sin actividad** (se renueva cada vez que abrís la app y sincroniza). No se guardan historiales ni logs de ubicación.
- **Borrar todo:** *Rutinas → Desactivar* elimina del servidor tu suscripción, rutinas y ubicación (`POST /unsubscribe`). Borrar rutinas en la app también las quita del servidor al sincronizar.
- La app no puede seguir tu ubicación con el teléfono bloqueado; sin ubicación reciente se usa el origen fijo de cada rutina.
- Operador: Cloudflare puede registrar IPs de las solicitudes según su política; el worker no las guarda.

## Límites conocidos

- El planificador oficial sólo calcula "desde ahora", así que el aviso de 2 h es una **estimación** (hora de llegada − duración del viaje − colchón). Los avisos de 30 y 15 min se reajustan con el arribo en vivo.
- Si el servicio del municipio no responde desde los centros de datos de Cloudflare, el aviso no se calcula (se reintenta hasta 5 veces por día y rutina). Verificalo tras publicar con *Enviar prueba* y mirando los logs: `npx wrangler tail`.
- Los avisos se disparan en el minuto exacto; si Cloudflare se saltea una ejecución del cron, ese aviso se pierde.
