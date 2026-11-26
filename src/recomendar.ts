// Lógica de rutinas compartida entre la app (vista previa) y el worker de notificaciones.
// Sin dependencias del navegador ni de import.meta.env: sólo tipos y aritmética de fechas.
import type { Ruta } from './trip';

/** Rosario está en UTC-3 todo el año (sin horario de verano). */
export const OFFSET_H = -3;

export interface Lugar2 { nombre: string; lng: number; lat: number }
export interface Rutina {
  id: string;
  nombre: string;
  destino: Lugar2;
  origen: Lugar2; // casa u origen fijo
  usarUbicacion: boolean; // si la app conoce una ubicación reciente, usarla en vez del origen fijo
  dias: number[]; // 0 = domingo … 6 = sábado
  llegada: string; // "HH:MM" hora de Rosario
  margen: number; // minutos de colchón
  activa: boolean;
}

export const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DIAS_L = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/* ---------- Fechas en hora de Rosario ---------- */
export interface Fecha { y: number; m: number; d: number }
export const rosario = (ms: number) => {
  const t = new Date(ms + OFFSET_H * 3600_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), dow: t.getUTCDay() };
};
export const fechaKey = (f: Fecha) => `${f.y}-${String(f.m).padStart(2, '0')}-${String(f.d).padStart(2, '0')}`;
/** Epoch (UTC) de una hora "HH:MM" de Rosario en una fecha. */
export function aMs(f: Fecha, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Date.UTC(f.y, f.m - 1, f.d, h, m) - OFFSET_H * 3600_000;
}
export const hm = (ms: number) => {
  const r = rosario(ms);
  return `${String(r.hh).padStart(2, '0')}:${String(r.mm).padStart(2, '0')}`;
};
export const minutoDe = (ms: number) => Math.floor(ms / 60_000);

/** Próxima llegada (hoy o en los días siguientes) de una rutina, desde `desde`. */
export function proximaLlegada(r: Rutina, desde: number): { ms: number; fecha: Fecha } | null {
  if (!r.dias.length) return null;
  const base = rosario(desde);
  for (let i = 0; i < 8; i++) {
    const t = new Date(Date.UTC(base.y, base.m - 1, base.d + i));
    const f: Fecha = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    if (!r.dias.includes(t.getUTCDay())) continue;
    const ms = aMs(f, r.llegada);
    if (ms > desde - 15 * 60_000) return { ms, fecha: f };
  }
  return null;
}

/* ---------- Recomendación ---------- */
export interface Reco {
  ruta: Ruta;
  linea: string; // código (129)
  lineaNombre: string;
  paradaId: string | null;
  paradaNombre: string;
  abordarMs: number; // hora a la que conviene estar subiendo al colectivo
  salidaMs: number; // hora a la que conviene salir de casa
  llegadaMs: number;
  caminaMin: number; // caminata hasta la parada
  viajeMin: number; // tiempo desde que subís hasta tu destino
}

/** La mejor ruta: la más corta, y a igualdad, con menos transbordos. */
export function elegir(rutas: Ruta[]): Ruta | null {
  const r = rutas.filter((x) => x.tramos.some((t) => t.modo === 'bus'));
  r.sort((a, b) => a.dur - b.dur || a.transbordos - b.transbordos);
  return r[0] ?? null;
}

/**
 * Dada la mejor ruta y la hora a la que querés llegar, calcula cuándo conviene salir
 * y a qué hora tomar el colectivo (llegada − margen − tiempo desde que subís).
 */
export function recomendar(rutas: Ruta[], llegadaMs: number, margenMin: number): Reco | null {
  const ruta = elegir(rutas);
  if (!ruta) return null;
  const bi = ruta.tramos.findIndex((t) => t.modo === 'bus');
  const bus = ruta.tramos[bi];
  const caminaS = ruta.tramos.slice(0, bi).reduce((s, t) => s + t.dur, 0);
  const desdeAbordar = ruta.finMs - bus.inicioMs; // incluye transbordos y caminata final
  const abordarMs = llegadaMs - margenMin * 60_000 - desdeAbordar;
  return {
    ruta,
    linea: bus.linea!.codigo,
    lineaNombre: bus.linea!.nombre,
    paradaId: bus.desde.parada ?? null,
    paradaNombre: bus.desde.nombre,
    abordarMs,
    salidaMs: abordarMs - caminaS * 1000,
    llegadaMs,
    caminaMin: Math.max(1, Math.round(caminaS / 60)),
    viajeMin: Math.round(desdeAbordar / 60_000),
  };
}

/* ---------- Avisos ---------- */
export type Aviso = 'n1' | 'n2' | 'n3';
export interface Mensaje { titulo: string; cuerpo: string }
const pr = (s: string) => s.replace(/\s+/g, ' ').trim();

/** n1: 2 h antes de llegar (recomendación). n2: 30 min antes de que salga el colectivo. n3: 15 min antes. */
export function mensaje(aviso: Aviso, o: { usuario: string; rutina: Rutina; reco: Reco; etaMin?: number | null; etaVivo?: boolean }): Mensaje {
  const { usuario, rutina: r, reco } = o;
  const u = usuario ? `${usuario}, ` : '';
  const bus = `${reco.linea} a las ${hm(reco.abordarMs)} en ${reco.paradaNombre}`;
  if (aviso === 'n1') {
    return {
      titulo: `Rutina «${r.nombre}»`,
      cuerpo: pr(`${u}tu rutina «${r.nombre}» para las ${r.llegada} recomienda tomar la línea ${bus}. Salí de casa a las ${hm(reco.salidaMs)} (${reco.caminaMin} min caminando hasta la parada).`),
    };
  }
  const en = aviso === 'n2' ? 30 : 15;
  const vivo = o.etaMin != null ? ` ${o.etaVivo ? 'En vivo: pasa' : 'Según horario pasa'} en ${o.etaMin <= 0 ? 'este momento' : o.etaMin + ' min'}.` : '';
  if (aviso === 'n2') {
    return { titulo: `En ${en} min sale tu colectivo`, cuerpo: pr(`${u}en ${en} minutos sale el colectivo recomendado para tu rutina «${r.nombre}»: línea ${bus}.${vivo}`) };
  }
  return { titulo: `¡En ${en} min, a salir!`, cuerpo: pr(`${u}en ${en} minutos sale el ${reco.linea} en ${reco.paradaNombre}. Tu parada está a ${reco.caminaMin} min caminando: ya es hora de salir.${vivo}`) };
}

/** Cuándo se dispara cada aviso (epoch ms), a partir de la llegada y la recomendación. */
export const momentos = (llegadaMs: number, abordarMs: number): Record<Aviso, number> => ({
  n1: llegadaMs - 120 * 60_000,
  n2: abordarMs - 30 * 60_000,
  n3: abordarMs - 15 * 60_000,
});
