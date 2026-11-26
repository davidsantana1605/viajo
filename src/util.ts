// Funciones puras (sin DOM) extraídas de main.ts para poder testearlas.
import type { Arribo } from './api';

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const fmtDur = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
export const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
export const fmtMin = (m: number) => (m <= 0 ? 'ahora' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);

/** Intervalo medio (min) entre los próximos arribos informados. Null si hay menos de dos. */
export function frecuencia(list: Arribo[]): number | null {
  const d: number[] = [];
  for (let i = 1; i < list.length; i++) {
    const g = list[i].arriboEnMinutos - list[i - 1].arriboEnMinutos;
    if (g > 0) d.push(g);
  }
  return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
}
