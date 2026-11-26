import { vi } from 'vitest';

/** KV falso en memoria con registro de lecturas. */
export class FakeKV {
  m = new Map<string, string>();
  gets: string[] = [];
  async get(k: string) { this.gets.push(k); return this.m.get(k) ?? null; }
  async put(k: string, v: string) { this.m.set(k, v); }
  async delete(k: string) { this.m.delete(k); }
}

export const ORIGIN = 'https://davidsantana1605.github.io';
export const EP = (n: number | string) => `https://fcm.googleapis.com/fcm/send/${n}`;
export const MIN = 60_000;
/** Epoch de una hora de Rosario (UTC-3). */
export const R = (y: number, m: number, d: number, hh: number, mm: number, ss = 0) => Date.UTC(y, m - 1, d, hh + 3, mm, ss);

export const mkEnv = (extra: Record<string, unknown> = {}) => ({
  DB: new FakeKV(), VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'https://example.test',
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, ...extra,
}) as unknown as import('../src/index').Env & { DB: FakeKV };

export const rutina = (o: Record<string, unknown> = {}) => ({
  id: 'r1', nombre: 'Trabajo', usarUbicacion: false, dias: [4], llegada: '08:00', margen: 10, activa: true,
  origen: { nombre: 'Casa', lng: -60.65, lat: -32.95 }, destino: { nombre: 'Oficina', lng: -60.7, lat: -32.9 }, ...o,
});

/** Ruta cruda del planificador: camina 5 min, sube 10:10 y llega 10:40 (30 min desde que sube). */
export const rawRuta = (linea = '129', parada = 'P1') => {
  const lugar = (n: string, p?: string) => ({ coordinates: [-60.6, -32.9], properties: { nombre: n, parada: p } });
  const tramo = (modo: number, ini: string, fin: string, dur: number, extra: object = {}) => ({
    geometry: { type: 'LineString', coordinates: [[-60.6, -32.9], [-60.61, -32.91]] },
    properties: { modo, desde: lugar('A', modo === 1 ? parada : undefined), hasta: lugar('B'), distancia: 100, duracion: dur, inicio: `2026-11-26 ${ini}`, fin: `2026-11-26 ${fin}`, ...extra },
  });
  return {
    denominacion: 'x', duracion: 2400, distanciaTotal: 5000, distanciaCaminata: 300, cantidadTransbordos: 0,
    inicio: '2026-11-26 10:00:00', fin: '2026-11-26 10:40:00',
    tramos: { features: [
      tramo(0, '10:00:00', '10:05:00', 300),
      tramo(1, '10:10:00', '10:40:00', 1800, { linea: { id: '1', idEmpresa: '1', nombre: `Línea ${linea}`, codigoEMR: linea, nombreCorto: linea } }),
    ] },
  };
};

export interface Mundo {
  plan: { status: number; rutas: unknown[]; calls: string[]; hook?: () => Promise<void> | void };
  push: { status: number; calls: { url: string; body: unknown }[]; porUrl: Record<string, number> };
  eta: { calls: string[] };
}

/** fetch + timers falsos (el web-push se mockea en el test). Llamar en beforeEach. */
export function instalarMundo(): Mundo {
  const w: Mundo = { plan: { status: 200, rutas: [rawRuta()], calls: [] }, push: { status: 201, calls: [], porUrl: {} }, eta: { calls: [] } };
  vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; });
  vi.stubGlobal('fetch', async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/geojson/comollego')) {
      w.plan.calls.push(url);
      if (w.plan.hook) await w.plan.hook();
      return w.plan.status === 200 ? new Response(JSON.stringify({ rutas: w.plan.rutas }), { status: 200 }) : new Response('err', { status: w.plan.status });
    }
    if (url.includes('/cuandollega')) {
      w.eta.calls.push(url);
      return new Response(JSON.stringify([{ linea: { nombre: 'Línea 129' }, arribos: [{ arriboEnMinutos: 7, tipo: 'GPS' }] }]), { status: 200 });
    }
    // endpoint push
    w.push.calls.push({ url, body: init?.body });
    w.push.porUrl[url] = (w.push.porUrl[url] ?? 0) + 1;
    return new Response('', { status: w.push.status });
  });
  return w;
}
