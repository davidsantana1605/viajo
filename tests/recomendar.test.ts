import { describe, it, expect } from 'vitest';
import { aMs, hm, rosario, fechaKey, proximaLlegada, momentos, recomendar, elegir, mensaje, OFFSET_H, type Rutina, type Reco } from '../src/recomendar';
import type { Ruta, Tramo } from '../src/trip';

const lugar = { nombre: 'X', lng: -60.65, lat: -32.95 };
const rutina = (o: Partial<Rutina> = {}): Rutina => ({
  id: 'r1', nombre: 'Trabajo', destino: lugar, origen: lugar, usarUbicacion: false,
  dias: [0, 1, 2, 3, 4, 5, 6], llegada: '08:00', margen: 5, activa: true, ...o,
});

describe('fechas en hora de Rosario (UTC-3)', () => {
  it('OFFSET_H es -3', () => expect(OFFSET_H).toBe(-3));
  it('aMs: 08:00 de Rosario = 11:00 UTC', () => {
    expect(aMs({ y: 2026, m: 11, d: 27 }, '08:00')).toBe(Date.UTC(2026, 10, 27, 11, 0));
  });
  it('aMs cruza de día: 23:30 de Rosario = 02:30 UTC del día siguiente', () => {
    expect(aMs({ y: 2026, m: 11, d: 27 }, '23:30')).toBe(Date.UTC(2026, 10, 28, 2, 30));
  });
  it('rosario() usa la fecha local, no la UTC', () => {
    const r = rosario(Date.UTC(2026, 0, 1, 1, 30)); // 31/12 22:30 en Rosario
    expect(r).toMatchObject({ y: 2025, m: 12, d: 31, hh: 22, mm: 30 });
  });
  it('hm / aMs son inversas', () => {
    const f = { y: 2026, m: 3, d: 9 };
    for (const h of ['00:00', '00:05', '07:45', '12:00', '23:59']) expect(hm(aMs(f, h))).toBe(h);
  });
  it('fechaKey rellena con ceros', () => expect(fechaKey({ y: 2026, m: 3, d: 9 })).toBe('2026-03-09'));
});

describe('proximaLlegada', () => {
  const vie = { y: 2026, m: 11, d: 27 };
  it('el 27/11/2026 es viernes', () => expect(rosario(aMs(vie, '12:00')).dow).toBe(5));

  it('hoy si todavía no pasó la hora', () => {
    const p = proximaLlegada(rutina({ dias: [5] }), aMs(vie, '06:00'))!;
    expect(p.fecha).toEqual(vie);
    expect(p.ms).toBe(aMs(vie, '08:00'));
  });
  it('usa el día de Rosario aunque en UTC ya sea otro día (22:00 Rosario = 01:00 UTC)', () => {
    const p = proximaLlegada(rutina({ dias: [5], llegada: '23:00' }), aMs(vie, '22:00'))!;
    expect(p.fecha).toEqual(vie);
    expect(p.ms).toBe(aMs(vie, '23:00'));
  });
  it('tolera 15 min de retraso y después salta al siguiente día', () => {
    const r = rutina({ dias: [5, 6] });
    expect(proximaLlegada(r, aMs(vie, '08:10'))!.fecha).toEqual(vie);
    expect(proximaLlegada(r, aMs(vie, '08:16'))!.fecha).toEqual({ y: 2026, m: 11, d: 28 });
  });
  it('cruza la medianoche: a las 23:50 con llegada 00:10 es el día siguiente', () => {
    const p = proximaLlegada(rutina({ llegada: '00:10' }), aMs(vie, '23:50'))!;
    expect(p.fecha).toEqual({ y: 2026, m: 11, d: 28 });
    expect(p.ms - aMs(vie, '23:50')).toBe(20 * 60_000);
  });
  it('cruza el fin de semana: rutina sólo de lunes, desde el viernes', () => {
    const p = proximaLlegada(rutina({ dias: [1] }), aMs(vie, '09:00'))!;
    expect(p.fecha).toEqual({ y: 2026, m: 11, d: 30 });
    expect(rosario(p.ms).dow).toBe(1);
  });
  it('cruza fin de mes y de año', () => {
    const p = proximaLlegada(rutina({ dias: [4] }), aMs({ y: 2026, m: 12, d: 31 }, '09:00'))!;
    expect(p.fecha).toEqual({ y: 2027, m: 1, d: 7 });
  });
  it('rutina de un solo día, hoy y ya pasó: la de la semana que viene (i=7)', () => {
    const p = proximaLlegada(rutina({ dias: [5] }), aMs(vie, '09:00'))!;
    expect(p.fecha).toEqual({ y: 2026, m: 12, d: 4 });
  });
  it('sin días devuelve null', () => expect(proximaLlegada(rutina({ dias: [] }), 0)).toBeNull());
});

const tramo = (o: Partial<Tramo>): Tramo => ({
  modo: 'walk', desde: { lng: 0, lat: 0, nombre: 'Casa' }, hasta: { lng: 0, lat: 0, nombre: '' },
  dist: 0, dur: 0, inicio: '', fin: '', inicioMs: 0, finMs: 0, geom: [], ...o,
});
const T0 = aMs({ y: 2026, m: 11, d: 27 }, '07:00');
const ruta = (dur: number, transbordos: number, caminaS = 300, busMin = 20, codigo = '129'): Ruta => {
  const ini = T0 + caminaS * 1000;
  return {
    denom: 'r', dur, dist: 0, caminata: 0, transbordos, inicio: '', fin: '', inicioMs: T0, finMs: ini + busMin * 60_000,
    tramos: [
      tramo({ modo: 'walk', dur: caminaS, inicioMs: T0, finMs: ini }),
      tramo({
        modo: 'bus', dur: busMin * 60, inicioMs: ini, finMs: ini + busMin * 60_000,
        desde: { lng: 0, lat: 0, nombre: 'Córdoba y Corrientes', parada: 'P1' },
        linea: { id: 'L', idEmpresa: 'E', nombre: 'Línea ' + codigo, codigo },
      }),
    ],
  };
};

describe('elegir / recomendar', () => {
  it('elige la más corta y desempata por transbordos', () => {
    const a = ruta(30 * 60, 1, 300, 20, '101'), b = ruta(25 * 60, 1, 300, 20, '102'), c = ruta(25 * 60, 0, 300, 20, '103');
    expect(elegir([a, b, c])).toBe(c);
  });
  it('ignora rutas sin colectivo (todo caminando) y devuelve null si no hay ninguna', () => {
    const caminando: Ruta = { ...ruta(10, 0), tramos: [tramo({ modo: 'walk' })] };
    expect(elegir([caminando])).toBeNull();
    expect(recomendar([caminando], 0, 5)).toBeNull();
    expect(recomendar([], 0, 5)).toBeNull();
  });
  it('calcula abordaje, salida de casa y viaje restando margen', () => {
    const r = ruta(25 * 60, 0, 300, 20);
    const llegada = aMs({ y: 2026, m: 11, d: 27 }, '08:00');
    const reco = recomendar([r], llegada, 5)!;
    expect(reco.linea).toBe('129');
    expect(reco.paradaId).toBe('P1');
    expect(reco.paradaNombre).toBe('Córdoba y Corrientes');
    expect(reco.viajeMin).toBe(20);
    expect(reco.caminaMin).toBe(5);
    expect(hm(reco.abordarMs)).toBe('07:35'); // 08:00 − 5 margen − 20 viaje
    expect(hm(reco.salidaMs)).toBe('07:30'); // − 5 min caminando
  });
  it('caminaMin nunca baja de 1 y paradaId es null si falta', () => {
    const r = ruta(600, 0, 10, 5);
    r.tramos[1].desde.parada = undefined;
    const reco = recomendar([r], T0 + 3600_000, 0)!;
    expect(reco.caminaMin).toBe(1);
    expect(reco.paradaId).toBeNull();
  });
  it('si el bus es el primer tramo no hay caminata previa', () => {
    const r = ruta(600, 0, 0, 10);
    r.tramos.shift();
    const reco = recomendar([r], T0 + 3600_000, 0)!;
    expect(reco.salidaMs).toBe(reco.abordarMs);
  });
});

describe('momentos', () => {
  it('n1 = −2 h de la llegada; n2/n3 = −30/−15 min del abordaje', () => {
    const l = aMs({ y: 2026, m: 11, d: 27 }, '08:00'), a = aMs({ y: 2026, m: 11, d: 27 }, '07:35');
    const m = momentos(l, a);
    expect(hm(m.n1)).toBe('06:00');
    expect(hm(m.n2)).toBe('07:05');
    expect(hm(m.n3)).toBe('07:20');
  });
});

describe('mensaje', () => {
  const base = aMs({ y: 2026, m: 11, d: 27 }, '07:35');
  const reco = { linea: '129', lineaNombre: 'Línea 129', paradaNombre: 'Córdoba y  Corrientes', abordarMs: base, salidaMs: base - 5 * 60_000, caminaMin: 5 } as unknown as Reco;
  const r = rutina();
  it('n1 con usuario', () => {
    const m = mensaje('n1', { usuario: 'Ana', rutina: r, reco });
    expect(m.titulo).toBe('Rutina «Trabajo»');
    expect(m.cuerpo).toBe('Ana, tu rutina «Trabajo» para las 08:00 recomienda tomar la línea 129 a las 07:35 en Córdoba y Corrientes. Salí de casa a las 07:30 (5 min caminando hasta la parada).');
  });
  it('n1 sin usuario no deja coma colgada', () => {
    const m = mensaje('n1', { usuario: '', rutina: r, reco });
    expect(m.cuerpo.startsWith('tu rutina')).toBe(true);
  });
  it('n2 sin ETA', () => {
    const m = mensaje('n2', { usuario: 'Ana', rutina: r, reco });
    expect(m.titulo).toBe('En 30 min sale tu colectivo');
    expect(m.cuerpo).toBe('Ana, en 30 minutos sale el colectivo recomendado para tu rutina «Trabajo»: línea 129 a las 07:35 en Córdoba y Corrientes.');
  });
  it('n2 con ETA en vivo / programado / inminente', () => {
    expect(mensaje('n2', { usuario: '', rutina: r, reco, etaMin: 7, etaVivo: true }).cuerpo).toMatch(/ En vivo: pasa en 7 min\.$/);
    expect(mensaje('n2', { usuario: '', rutina: r, reco, etaMin: 7, etaVivo: false }).cuerpo).toMatch(/ Según horario pasa en 7 min\.$/);
    expect(mensaje('n2', { usuario: '', rutina: r, reco, etaMin: 0, etaVivo: true }).cuerpo).toMatch(/pasa en este momento\.$/);
  });
  it('n3 con y sin nombre / ETA', () => {
    const a = mensaje('n3', { usuario: 'Ana', rutina: r, reco });
    expect(a.titulo).toBe('¡En 15 min, a salir!');
    expect(a.cuerpo).toBe('Ana, en 15 minutos sale el 129 en Córdoba y Corrientes. Tu parada está a 5 min caminando: ya es hora de salir.');
    const b = mensaje('n3', { usuario: '', rutina: r, reco, etaMin: 3, etaVivo: true });
    expect(b.cuerpo).toBe('en 15 minutos sale el 129 en Córdoba y Corrientes. Tu parada está a 5 min caminando: ya es hora de salir. En vivo: pasa en 3 min.');
  });
  it('etaMin null equivale a sin ETA', () => {
    expect(mensaje('n3', { usuario: '', rutina: r, reco, etaMin: null }).cuerpo).not.toMatch(/pasa/);
  });
});
