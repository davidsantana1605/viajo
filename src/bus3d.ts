// Posición ESTIMADA de colectivos + geometría 3D simple (cajas extruidas, muy liviano).
// La API no entrega la posición real: se deduce a partir de los minutos que faltan para llegar a una parada.

export const SPEED_M_PER_MIN = 230; // ~14 km/h de velocidad comercial urbana

type LL = [number, number];
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Distancia aproximada en metros (equirectangular, suficiente a escala urbana). */
export function dist(a: LL, b: LL): number {
  const x = rad(b[0] - a[0]) * Math.cos(rad((a[1] + b[1]) / 2));
  const y = rad(b[1] - a[1]);
  return Math.hypot(x, y) * R;
}
/** Rumbo en grados (0 = norte, horario) de a → b. */
export function bearing(a: LL, b: LL): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface Est { lng: number; lat: number; heading: number }

const nearest = (poly: LL[], p: LL): { i: number; d: number } => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = dist(poly[i], p);
    if (d < bd) { bd = d; bi = i; }
  }
  return { i: bi, d: bd };
};

/** Rumbo del recorrido en el punto del trazado más cercano a p. */
export function headingNear(routes: LL[][], p: LL): number {
  let best: { poly: LL[]; i: number; d: number } | null = null;
  for (const poly of routes) {
    if (poly.length < 2) continue;
    const n = nearest(poly, p);
    if (!best || n.d < best.d) best = { poly, ...n };
  }
  if (!best) return 0;
  const i = Math.min(best.i, best.poly.length - 2);
  return bearing(best.poly[i], best.poly[i + 1]);
}

/**
 * Si un colectivo llega a `stop` en `minutes`, estima dónde está ahora:
 * retrocede por el trazado esa cantidad de minutos de recorrido.
 */
export function estimate(routes: LL[][], stop: LL, minutes: number): Est | null {
  let best: { poly: LL[]; i: number; d: number } | null = null;
  for (const poly of routes) {
    if (poly.length < 2) continue;
    const n = nearest(poly, stop);
    if (!best || n.d < best.d) best = { poly, ...n };
  }
  if (!best || best.d > 70) return null;
  const { poly } = best;
  let need = Math.max(0, minutes) * SPEED_M_PER_MIN;
  let j = best.i;
  while (j > 0) {
    const len = dist(poly[j - 1], poly[j]);
    if (len >= need) {
      const t = len === 0 ? 0 : need / len;
      return {
        lng: poly[j][0] + (poly[j - 1][0] - poly[j][0]) * t,
        lat: poly[j][1] + (poly[j - 1][1] - poly[j][1]) * t,
        heading: bearing(poly[j - 1], poly[j]),
      };
    }
    need -= len;
    j--;
  }
  return { lng: poly[0][0], lat: poly[0][1], heading: bearing(poly[0], poly[1]) };
}

/** Une estimaciones que caen casi en el mismo lugar (el mismo colectivo visto desde varias paradas). */
export function dedupe(list: Est[], within = 140): Est[] {
  const out: Est[] = [];
  for (const e of list) if (!out.some((o) => dist([o.lng, o.lat], [e.lng, e.lat]) < within)) out.push(e);
  return out;
}

/* ---------- Geometría 3D ---------- */
function box(c: LL, heading: number, len: number, wid: number): LL[] {
  const kLat = 1 / 111320, kLng = 1 / (111320 * Math.cos(rad(c[1])));
  const h = rad(heading);
  const f = [Math.sin(h), Math.cos(h)]; // adelante (este, norte)
  const r = [Math.cos(h), -Math.sin(h)]; // derecha
  const pts: LL[] = [];
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]] as const) {
    const e = f[0] * (a * len) / 2 + r[0] * (b * wid) / 2;
    const n = f[1] * (a * len) / 2 + r[1] * (b * wid) / 2;
    pts.push([c[0] + e * kLng, c[1] + n * kLat]);
  }
  return pts;
}

/** Escala visual: a zoom lejano el colectivo real sería invisible, así que se agranda. */
export const busScale = (zoom: number) => Math.min(12, Math.max(2.6, 2 ** (17.9 - zoom)));

export function busFeatures(buses: (Est & { color: string })[], zoom: number): GeoJSON.Feature[] {
  const s = busScale(zoom);
  const L = 12 * s, W = 2.6 * s, H = 3.1 * Math.min(s, 3.2);
  const out: GeoJSON.Feature[] = [];
  for (const b of buses) {
    const c: LL = [b.lng, b.lat];
    out.push({ type: 'Feature', properties: { c: b.color, b: 0.4 * Math.min(s, 3.2), h: H }, geometry: { type: 'Polygon', coordinates: [box(c, b.heading, L, W)] } });
    // franja de ventanas, un poco más ancha que la carrocería
    out.push({ type: 'Feature', properties: { c: '#dbeafe', b: H * 0.52, h: H * 0.86 }, geometry: { type: 'Polygon', coordinates: [box(c, b.heading, L * 0.86, W * 1.06)] } });
    // techo
    out.push({ type: 'Feature', properties: { c: '#f5f5f7', b: H * 0.86, h: H * 1.06 }, geometry: { type: 'Polygon', coordinates: [box(c, b.heading, L * 0.96, W * 0.96)] } });
  }
  return out;
}
