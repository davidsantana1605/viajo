# Viajo · Colectivos de Rosario

Demo web (móvil y escritorio) para explorar las líneas de colectivo de Rosario: mapa estilizado tipo Apple Maps con modo claro/oscuro, recorrido de ida y vuelta, paradas y próximos arribos.

## Uso

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # versión de producción en dist/
npm run data     # actualiza el respaldo de líneas/recorridos/paradas
```

## Cómo funciona

- **Mapa:** [MapLibre GL JS](https://maplibre.org/) con teselas vectoriales de [OpenFreeMap](https://openfreemap.org/) y un estilo propio (`src/mapStyle.ts`) en dos paletas.
- **Datos estáticos:** `scripts/fetch-data.mjs` guarda en `public/data/` las líneas, recorridos y paradas.
- **Arribos:** se consultan en vivo, por parada. Los marcados como "Actualizado" están corregidos por GPS; los demás son horarios programados.

## Limitaciones

- La API no expone la posición de los colectivos (coordenadas e interno vienen vacíos), por lo que el mapa no los dibuja. El código de los marcadores queda listo por si eso cambia.
- Los datos provienen de la API pública que usa la app oficial *Cómo Llego* (Municipalidad de Rosario / Ente de la Movilidad). No es una API documentada ni oficialmente soportada; no hay vínculo con el municipio.

## Créditos

© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap.
