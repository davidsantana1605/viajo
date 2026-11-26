// Lógica pura (sin DOM ni red) del aviso de bajada. La prueba: test/avisos.test.mjs
export type LL = [number, number];

/** Distancia en metros (haversine). */
export function distM(a: LL, b: LL): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------- umbrales de bajada ---------- */
export const UMBRALES = [400, 200, 80] as const;

/**
 * Devuelve el umbral a avisar ahora (el menor ya cruzado que todavía no se avisó) y marca como
 * avisados los mayores: si el primer dato ya llega a 150 m, se avisa el de 200 y no se repite el de 400.
 * `avisados` se modifica.
 */
export function umbralAAvisar(d: number, avisados: Set<number>): number | null {
  let out: number | null = null;
  for (const u of UMBRALES) {
    if (d <= u && !avisados.has(u)) { avisados.add(u); out = u; }
  }
  return out;
}

/* ---------- "te pasaste de parada" ---------- */
export interface EstadoPasaste { min: number; cerca: boolean; pasado: boolean }
export const nuevoEstadoPasaste = (): EstadoPasaste => ({ min: Infinity, cerca: false, pasado: false });
export const CERCA_M = 150; // hay que haber estado a menos de esto para considerar que "llegaste"
export const ALEJA_M = 90;  // y alejarte esto sobre el mínimo (absorbe el ruido del GPS)

/** Actualiza el estado con la distancia a la parada de bajada. `pasado` pasa a true una sola vez (se queda). */
export function actualizarPasaste(s: EstadoPasaste, d: number): { estado: EstadoPasaste; nuevo: boolean } {
  const min = Math.min(s.min, d);
  const cerca = s.cerca || min < CERCA_M;
  const pasado = s.pasado || (cerca && d - min >= ALEJA_M && d > 120);
  return { estado: { min, cerca, pasado }, nuevo: pasado && !s.pasado };
}

/* ---------- paradas que faltan ---------- */
interface Proy { s: number; off: number }
const K = (lat: number) => ({ x: 111320 * Math.cos((lat * Math.PI) / 180), y: 110574 });

/** Proyecta p sobre la poligonal: posición a lo largo (m) y distancia perpendicular (m). */
export function proyectar(poly: LL[], p: LL): Proy {
  const { x: kx, y: ky } = K(p[1]);
  let acum = 0, best: Proy = { s: 0, off: Infinity };
  for (let i = 1; i < poly.length; i++) {
    const ax = (poly[i - 1][0] - p[0]) * kx, ay = (poly[i - 1][1] - p[1]) * ky;
    const bx = (poly[i][0] - p[0]) * kx, by = (poly[i][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.off) best = { s: acum + t * len, off };
    acum += len;
  }
  return best;
}

export interface Recorrido { poly: number; sHasta: number; paradas: number[] } // paradas: posición a lo largo (m), ordenadas
const TOL_PARADA = 60;   // una parada "pertenece" al sentido si está a menos de esto de la traza
const FUSION = 80;       // paradas de ambas veredas (misma esquina) cuentan como una

/**
 * Las paradas de public/data/lineas/*.json vienen desordenadas y mezclan ida y vuelta: se ordenan proyectándolas
 * sobre la traza del sentido en que va el viaje. Elige el sentido donde caen a la vez la subida y la bajada, en ese orden.
 */
export function prepararRecorrido(routes: LL[][], stops: { lng: number; lat: number }[], desde: LL, hasta: LL): Recorrido | null {
  let best: { r: Recorrido; costo: number } | null = null;
  routes.forEach((poly, k) => {
    if (poly.length < 2) return;
    const a = proyectar(poly, desde), b = proyectar(poly, hasta);
    if (a.off > 150 || b.off > 150 || b.s <= a.s) return;
    const costo = a.off + b.off;
    if (best && best.costo <= costo) return;
    const ss: number[] = [];
    for (const st of stops) {
      const p = proyectar(poly, [st.lng, st.lat]);
      if (p.off <= TOL_PARADA) ss.push(p.s);
    }
    ss.sort((x, y) => x - y);
    const fus: number[] = [];
    for (const s of ss) if (!fus.length || s - fus[fus.length - 1] >= FUSION) fus.push(s);
    best = { r: { poly: k, sHasta: b.s, paradas: fus }, costo };
  });
  return best ? (best as { r: Recorrido }).r : null;
}

/** Paradas que faltan hasta la de bajada (contándola) y metros por la traza; null si el GPS está lejos de la traza o ya pasó. */
export function paradasRestantes(rec: Recorrido, poly: LL[], pos: LL): { paradas: number; metros: number } | null {
  const p = proyectar(poly, pos);
  if (p.off > 200 || p.s > rec.sHasta + 30) return null;
  let n = 0;
  for (const s of rec.paradas) if (s > p.s + 25 && s <= rec.sHasta + FUSION / 2) n++;
  return { paradas: Math.max(1, n), metros: Math.max(0, rec.sHasta - p.s) };
}

/** Avisar "X paradas antes": una vez, cuando restan <= x (x>=2; con 1 ya está el aviso de la próxima parada). */
export function avisarXParadas(x: number, restan: number | null, ya: boolean): boolean {
  return x >= 2 && restan !== null && restan <= x && !ya;
}
