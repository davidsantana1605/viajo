const API = 'https://ws.rosario.gob.ar/ubicaciones/public';

/** Convierte POSGAR 94 / Argentina faja 5 (EPSG:22185, lo que devuelve el geocodificador) a WGS84. Transversa de Mercator inversa (Snyder). */
export function posgarToWgs84(x: number, y: number): [number, number] {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x0 = 5500000, l0 = (-60 * Math.PI) / 180;
  const A = 1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256;
  const m = (p: number) =>
    a * (A * p - (3 * e2 / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p)
      + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const M = m(-Math.PI / 2) + y;
  const mu = M / (a * A);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const C = ep2 * c * c, T = t * t, N = a / Math.sqrt(1 - e2 * s * s), R = (a * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5);
  const D = (x - x0) / N;
  const lat = p1 - ((N * t) / R) * (D ** 2 / 2 - ((5 + 3 * T + 10 * C - 4 * C * C - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T + 298 * C + 45 * T * T - 252 * ep2 - 3 * C * C) * D ** 6) / 720);
  const lon = l0 + (D - ((1 + 2 * T + C) * D ** 3) / 6 + ((5 - 2 * C + 28 * T - 3 * C * C + 8 * ep2 + 24 * T * T) * D ** 5) / 120) / c;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

export interface Lugar { nombre: string; detalle: string; lng: number; lat: number }

interface Feat {
  geometry?: { type: string; coordinates: unknown };
  properties?: { name?: string; subtipo?: string; divs_admin?: { nombreTipo: string; valor: string }[] };
}

const flat = (c: unknown): number[][] => {
  if (Array.isArray(c) && typeof c[0] === 'number') return [c as number[]];
  return (c as unknown[]).flatMap(flat);
};

/** Busca direcciones, esquinas y lugares con el geocodificador oficial de Rosario. */
export async function buscarLugares(term: string, signal?: AbortSignal): Promise<Lugar[]> {
  const r = await fetch(`${API}/geojson/ubicaciones?term=${encodeURIComponent(term)}&extendido=true&conOtrasLocalidades=false`, { signal });
  if (!r.ok) return [];
  const d = (await r.json()) as { features?: Feat[] };
  const out: Lugar[] = [];
  for (const f of d.features ?? []) {
    if (!f.geometry || !f.properties?.name) continue;
    const pts = flat(f.geometry.coordinates);
    if (!pts.length) continue;
    const [x, y] = pts[Math.floor(pts.length / 2)];
    const [lng, lat] = posgarToWgs84(x, y);
    if (Math.abs(lng + 60.65) > 0.5 || Math.abs(lat + 32.95) > 0.5) continue; // fuera de la zona
    const barrio = f.properties.divs_admin?.find((x) => x.nombreTipo === 'Barrio')?.valor;
    const tipo = (f.properties.subtipo ?? '').split(',')[0].trim();
    const calle = f.geometry.type !== 'Point';
    out.push({
      nombre: titulo(f.properties.name),
      detalle: [calle ? 'Calle · agregá la altura para mayor precisión' : tipo.replace(/DIRECCI.N/i, 'Dirección'), barrio ? titulo(barrio) : ''].filter(Boolean).join(' · '),
      lng, lat,
    });
    if (out.length >= 6) break;
  }
  return out;
}

const titulo = (s: string) =>
  s.toLowerCase().replace(/(^|[\s(.-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\b(Y|De|Del|La|El|Los|Las)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase());
