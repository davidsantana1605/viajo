// Descarga un snapshot de líneas, recorridos y paradas desde la API pública
// que usa la app oficial "Cómo Llego" (Municipalidad de Rosario / EMR).
// Salida: public/data/lineas.json  y  public/data/lineas/{idEmpresa}-{id}.json
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://ws.rosario.gob.ar/ubicaciones/public';
const OUT = new URL('../public/data/', import.meta.url);
await mkdir(new URL('lineas/', OUT), { recursive: true });

const r5 = (n) => Math.round(n * 1e5) / 1e5; // ~1 m de precisión, achica el JSON

const get = async (path) => {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(BASE + path);
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error('fallo ' + path);
};

const lineas = await get('/lineas?nombre=all');
const index = [];

for (const l of lineas) {
  const d = await get(
    `/linea/${l.idEmpresa}/${l.id}?conGeometria=true&usarCoordenadasWGS84=true&conParadas=true`,
  );
  const trazado = (g) =>
    (g?.coordinates ?? []).map((seg) => seg.map(([x, y]) => [r5(x), r5(y)]));
  const out = {
    id: l.id,
    idEmpresa: l.idEmpresa,
    empresa: l.nombreEmpresa,
    nombre: l.nombre,
    nombreCorto: l.nombreCorto,
    codigo: l.codigoEMR,
    variante: l.color,
    ida: trazado(d.geojsonIda),
    vuelta: trazado(d.geojsonVuelta),
    paradas: (d.paradas ?? []).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      desc: p.descripcion,
      lng: r5(p.longitud),
      lat: r5(p.latitud),
    })),
  };
  const file = `${l.idEmpresa}-${l.id}`;
  await writeFile(new URL(`lineas/${file}.json`, OUT), JSON.stringify(out));
  index.push({
    file,
    id: l.id,
    idEmpresa: l.idEmpresa,
    empresa: l.nombreEmpresa,
    nombre: l.nombre,
    nombreCorto: l.nombreCorto,
    codigo: l.codigoEMR,
    variante: l.color,
    paradas: out.paradas.length,
  });
  console.log('✓', l.nombre, out.paradas.length, 'paradas');
}

await writeFile(new URL('lineas.json', OUT), JSON.stringify(index));
await writeFile(new URL('meta.json', OUT), JSON.stringify({ generado: new Date().toISOString() }));
console.log('Listo:', index.length, 'líneas');
