# Viajo · Colectivos de Rosario

Demo web (móvil y escritorio) para explorar las líneas de colectivo de Rosario: mapa estilizado tipo Apple Maps con modo claro/oscuro, recorrido de ida y vuelta, paradas y próximos arribos.

## Uso

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # versión de producción en dist/
npm run data     # actualiza el respaldo de líneas/recorridos/paradas
```

## Funciones

- Mapa estilo Apple Maps (claro/oscuro, edificios 3D) y 54 líneas con recorrido, paradas y arribos.
- **Planificar viaje** (planificador oficial de Cómo Llego) y **Iniciar viaje**: seguimiento en vivo, avisos de atraso y alternativas ("al mismo tiempo", "opción mejor").
- Colectivos 3D con posición **estimada** a partir de los arribos en vivo (la API no entrega la posición real).
- **Rutinas con notificaciones push**: elegís destino, días y hora de llegada y te avisa cuándo salir. Requiere publicar el worker de `worker/` (ver [worker/README.md](worker/README.md)).

## Cómo funciona

- **Mapa:** [MapLibre GL JS](https://maplibre.org/) con teselas vectoriales de [OpenFreeMap](https://openfreemap.org/) y un estilo propio (`src/mapStyle.ts`) en dos paletas.
- **Datos estáticos:** `scripts/fetch-data.mjs` guarda en `public/data/` las líneas, recorridos y paradas.
- **Arribos:** se consultan en vivo, por parada. Los marcados como "Actualizado" están corregidos por GPS; los demás son horarios programados.

## Limitaciones

- La API no expone la posición de los colectivos (coordenadas e interno vienen vacíos), por lo que el mapa no los dibuja. El código de los marcadores queda listo por si eso cambia.
- Los datos provienen de la API pública que usa la app oficial *Cómo Llego* (Municipalidad de Rosario / Ente de la Movilidad). No es una API documentada ni oficialmente soportada; no hay vínculo con el municipio.

## Privacidad y seguridad

- Sin cuenta ni analítica. Las rutinas y tu nombre se guardan en el `localStorage` de tu navegador.
- Si activás las notificaciones, la app envía al worker de avisos tu suscripción push, tu nombre, tus rutinas y (sólo si una rutina usa "mi ubicación") tu última ubicación; se conserva hasta 45 días sin actividad (la ubicación, 6 h) y *Rutinas → Desactivar* lo borra todo. Detalle en [worker/README.md](worker/README.md).
- La búsqueda de direcciones y los arribos se consultan directamente a la API del municipio; los mapas a OpenFreeMap (ven tu IP, como en cualquier web).
- La build incluye una Content-Security-Policy (`vite.config.ts`) y todo texto externo se escapa antes de insertarse en el HTML.

## Créditos

© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap.
