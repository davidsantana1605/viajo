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
export function dedupe<T extends Est>(list: T[], within = 140): T[] {
  const out: T[] = [];
  for (const e of list) if (!out.some((o) => dist([o.lng, o.lat], [e.lng, e.lat]) < within)) out.push(e);
  return out;
}

/* ---------- Geometría 3D ---------- */
// Un colectivo armado con prismas apilados (fill-extrusion): zócalo, carrocería, franja de ventanas con
// parantes, techo con aire acondicionado, cartel de destino, luces y ruedas. ~19 polígonos por colectivo.

/** Polígono dado en metros locales [adelante, derecha] → coordenadas geográficas, rotado según el rumbo. */
function local(c: LL, heading: number, s: number, pts: [number, number][]): LL[] {
  const kLat = 1 / 111320, kLng = 1 / (111320 * Math.cos(rad(c[1])));
  const h = rad(heading);
  const f = [Math.sin(h), Math.cos(h)], r = [Math.cos(h), -Math.sin(h)];
  const out = pts.map(([a, b]): LL => {
    const e = (f[0] * a + r[0] * b) * s, n = (f[1] * a + r[1] * b) * s;
    return [c[0] + e * kLng, c[1] + n * kLat];
  });
  out.push(out[0]);
  return out;
}
/** Rectángulo [f0,f1] × [r0,r1] con esquinas biseladas (bf adelante, br atrás). */
const rect = (f0: number, f1: number, r0: number, r1: number, bf = 0, br = 0): [number, number][] =>
  [[f1 - bf, r1], [f1, r1 - bf], [f1, r0 + bf], [f1 - bf, r0], [f0 + br, r0], [f0, r0 + br], [f0, r1 - br], [f0 + br, r1]];

/** Escala visual: a zoom lejano un colectivo real sería invisible, así que se agranda. */
export const busScale = (zoom: number) => Math.min(12, Math.max(1.3, 2 ** (18.2 - zoom)));

const L = 6, W = 1.275; // medio largo y medio ancho (12 m × 2,55 m)

export function busFeatures(buses: (Est & { color: string })[], zoom: number): GeoJSON.Feature[] {
  const s = busScale(zoom);
  const out: GeoJSON.Feature[] = [];
  for (const bus of buses) {
    const c: LL = [bus.lng, bus.lat];
    const part = (pts: [number, number][], color: string, base: number, top: number) =>
      out.push({ type: 'Feature', properties: { c: color, b: base * s, h: top * s }, geometry: { type: 'Polygon', coordinates: [local(c, bus.heading, s, pts)] } });
    const GLASS = '#1c2a40', DARK = '#16171a', WHITE = '#eef0f3';

    part(rect(-L + 0.2, L - 0.2, -W + 0.15, W - 0.15, 0.4, 0.2), DARK, 0.25, 0.9); // zócalo / chasis
    part(rect(-L, L, -W, W, 0.7, 0.3), bus.color, 0.9, 1.45); // carrocería inferior
    part(rect(-L, L, -W, W, 0.7, 0.3), GLASS, 1.45, 2.6); // franja de vidrios
    for (const f of [-4.6, -3.1, -1.6, -0.1, 1.4, 2.9, 4.4]) part(rect(f - 0.09, f + 0.09, -W - 0.05, W + 0.05), bus.color, 1.45, 2.6); // parantes
    part(rect(-L + 0.1, L - 0.1, -W + 0.1, W - 0.1, 0.6, 0.25), bus.color, 2.6, 2.85); // techo
    part(rect(-3.2, -0.2, -0.65, 0.65, 0.15, 0.15), WHITE, 2.85, 3.2); // equipo de aire
    part(rect(L - 0.25, L + 0.08, -0.95, 0.95), '#ffb800', 2.5, 2.95); // cartel de destino
    for (const side of [-1, 1]) part(rect(L - 0.05, L + 0.07, side * 0.75, side * 1.1), '#fff4c2', 0.5, 0.85); // faros
    for (const f of [3.7, -3.1]) for (const side of [-1, 1]) part(rect(f - 0.55, f + 0.55, side * (W - 0.02) - 0.12, side * (W - 0.02) + 0.12), '#0d0d0f', 0, 1.0); // ruedas
  }
  return out;
}
