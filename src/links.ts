/** Enlaces profundos de Viajo: parseo y serialización del hash. Sin DOM, sin dependencias (se testea en node). */
export interface Pt { lng: number; lat: number; nombre: string }
export type Link =
  | { k: 'linea'; file: string; parada?: string }
  | { k: 'parada'; id: string }
  | { k: 'viaje'; o: Pt; d: Pt }
  | { k: 'rutinas' };

/** Gran Rosario (caja de ~±0,55° alrededor del centro). */
export const BOX = { lng: [-61.2, -60.1], lat: [-33.5, -32.4] } as const;
export const MAX_HASH = 700;
export const MAX_NOMBRE = 80;

const RE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const RE_NUM = /^-?\d{1,3}(\.\d{1,7})?$/;

export const inBox = (lng: number, lat: number) =>
  Number.isFinite(lng) && Number.isFinite(lat) && lng >= BOX.lng[0] && lng <= BOX.lng[1] && lat >= BOX.lat[0] && lat <= BOX.lat[1];

/** Limpia un nombre: sin caracteres de control ni < > (defensa extra; igual se escapa al pintar), recortado. */
export function limpiarNombre(s: string, fallback: string): string {
  const t = s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE);
  return t || fallback;
}

function parsePt(v: string | undefined, nombre: string | undefined, fallback: string): Pt | null {
  if (!v) return null;
  const m = v.split(',');
  if (m.length !== 2 || !RE_NUM.test(m[0]) || !RE_NUM.test(m[1])) return null;
  const lng = Number(m[0]), lat = Number(m[1]);
  if (!inBox(lng, lat)) return null;
  return { lng, lat, nombre: limpiarNombre(nombre ?? '', fallback) };
}

function dec(s: string): string | undefined {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return undefined; }
}

/** Interpreta un hash ("#viaje=…"). Devuelve null si no es un enlace válido. */
export function parseHash(hash: string): Link | null {
  if (typeof hash !== 'string' || hash.length > MAX_HASH) return null;
  const h = hash.replace(/^#/, '');
  if (!h) return null;
  if (h === 'rutinas') return { k: 'rutinas' };
  const q = new Map<string, string>();
  for (const part of h.split('&')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i);
    if (!['linea', 'parada', 'viaje', 'o', 'd'].includes(key) || q.has(key)) continue;
    const v = dec(part.slice(i + 1));
    if (v !== undefined) q.set(key, v);
  }
  const viaje = q.get('viaje');
  if (viaje !== undefined) {
    const [a, b, ...resto] = viaje.split('~');
    if (resto.length) return null;
    const o = parsePt(a, q.get('o'), 'Origen'), d = parsePt(b, q.get('d'), 'Destino');
    return o && d ? { k: 'viaje', o, d } : null;
  }
  const linea = q.get('linea'), parada = q.get('parada');
  if (linea !== undefined) {
    if (!RE_ID.test(linea)) return null;
    return { k: 'linea', file: linea, parada: parada !== undefined && RE_ID.test(parada) ? parada : undefined };
  }
  if (parada !== undefined && RE_ID.test(parada)) return { k: 'parada', id: parada };
  return null;
}

const r5 = (n: number) => String(Math.round(n * 1e5) / 1e5);

/** Serializa un enlace a hash ("#…"). Devuelve '' si los datos no son válidos. */
export function toHash(l: Link): string {
  switch (l.k) {
    case 'rutinas': return '#rutinas';
    case 'linea':
      if (!RE_ID.test(l.file)) return '';
      return `#linea=${l.file}${l.parada && RE_ID.test(l.parada) ? `&parada=${l.parada}` : ''}`;
    case 'parada': return RE_ID.test(l.id) ? `#parada=${l.id}` : '';
    case 'viaje': {
      if (!inBox(l.o.lng, l.o.lat) || !inBox(l.d.lng, l.d.lat)) return '';
      const n = (s: string, f: string) => encodeURIComponent(limpiarNombre(s, f));
      return `#viaje=${r5(l.o.lng)},${r5(l.o.lat)}~${r5(l.d.lng)},${r5(l.d.lat)}&o=${n(l.o.nombre, 'Origen')}&d=${n(l.d.nombre, 'Destino')}`;
    }
  }
}

export const mismoPunto = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
  Math.abs(a.lng - b.lng) < 2e-5 && Math.abs(a.lat - b.lat) < 2e-5;

/* ---- textos para compartir ---- */
export function textoViaje(o: { nombre: string }, d: { nombre: string }, x: { lineas: string[]; salgo?: string; llego?: string }): string {
  const lin = x.lineas.length ? `: ${x.lineas.join(' + ')}` : '';
  const hor = x.salgo && x.llego ? ` · salgo ${x.salgo}, llego ${x.llego}` : '';
  return `Viaje de ${o.nombre} a ${d.nombre}${lin}${hor} – Viajo`;
}
export const textoEta = (destino: string, llego: string) => `Voy en camino a ${destino}: llego estimado a las ${llego} – Viajo`;
export const textoLinea = (nombre: string) => `Línea ${nombre}: recorrido y colectivos en vivo – Viajo`;
export const textoParada = (parada: string, linea?: string) => `Parada ${parada}${linea ? ` (línea ${linea})` : ''}: próximos colectivos en vivo – Viajo`;
