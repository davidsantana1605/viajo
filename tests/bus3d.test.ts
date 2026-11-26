import { describe, it, expect } from 'vitest';
import { dist, bearing, estimate, dedupe, headingNear, busFeatures, busScale, SPEED_M_PER_MIN } from '../src/bus3d';

type LL = [number, number];
const M_LAT = 1 / 111195; // grados de latitud por metro (R = 6371000)
// Trazado recto hacia el norte, 1 punto cada 100 m, 11 puntos (1 km).
const norte: LL[] = Array.from({ length: 11 }, (_, i) => [-60.65, -32.95 + i * 100 * M_LAT]);

describe('dist / bearing', () => {
  it('dist: 100 m al norte', () => expect(dist(norte[0], norte[1])).toBeCloseTo(100, 0));
  it('dist: simétrica y 0 consigo misma', () => {
    expect(dist(norte[0], norte[5])).toBeCloseTo(dist(norte[5], norte[0]), 6);
    expect(dist(norte[3], norte[3])).toBe(0);
  });
  it('dist: 1° de longitud a esta latitud ≈ 93 km', () => {
    expect(dist([-60, -32.95], [-61, -32.95])).toBeCloseTo(111195 * Math.cos((32.95 * Math.PI) / 180), -2);
  });
  it('bearing cardinal', () => {
    const o: LL = [-60.65, -32.95];
    expect(bearing(o, [o[0], o[1] + 0.01])).toBeCloseTo(0, 3);
    expect(bearing(o, [o[0] + 0.01, o[1]])).toBeCloseTo(90, 1);
    expect(bearing(o, [o[0], o[1] - 0.01])).toBeCloseTo(180, 3);
    expect(bearing(o, [o[0] - 0.01, o[1]])).toBeCloseTo(270, 1);
  });
  it('bearing siempre en [0, 360)', () => {
    for (let a = 0; a < 360; a += 15) {
      const t = (a * Math.PI) / 180;
      const b = bearing([-60.65, -32.95], [-60.65 + 0.01 * Math.sin(t), -32.95 + 0.01 * Math.cos(t)]);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe('estimate (retroceso por el trazado)', () => {
  const stop = norte[10];
  it('0 min: en la parada', () => {
    const e = estimate([norte], stop, 0)!;
    expect(dist([e.lng, e.lat], stop)).toBeLessThan(1);
    expect(e.heading).toBeCloseTo(0, 1);
  });
  it('retrocede SPEED_M_PER_MIN por minuto, aun entre vértices', () => {
    const e = estimate([norte], stop, 1)!;
    expect(dist([e.lng, e.lat], stop)).toBeCloseTo(SPEED_M_PER_MIN, 0);
    expect(e.lat).toBeLessThan(stop[1]);
    const e2 = estimate([norte], stop, 2.5)!; // cruza 5 vértices
    expect(dist([e2.lng, e2.lat], stop)).toBeCloseTo(2.5 * SPEED_M_PER_MIN, 0);
  });
  it('borde: si el recorrido es más largo que el trazado queda en el inicio', () => {
    const e = estimate([norte], stop, 60)!;
    expect(e.lng).toBe(norte[0][0]);
    expect(e.lat).toBe(norte[0][1]);
    expect(e.heading).toBeCloseTo(0, 1);
  });
  it('borde: parada en el primer punto devuelve el inicio', () => {
    const e = estimate([norte], norte[0], 3)!;
    expect([e.lng, e.lat]).toEqual(norte[0]);
  });
  it('minutos negativos se tratan como 0', () => {
    const e = estimate([norte], stop, -5)!;
    expect(dist([e.lng, e.lat], stop)).toBeLessThan(1);
  });
  it('parada a más de 70 m del trazado => null', () => {
    expect(estimate([norte], [-60.65 + 0.001, -32.95 + 500 * M_LAT], 1)).toBeNull(); // ~93 m al este
  });
  it('sin trazados válidos => null', () => {
    expect(estimate([], stop, 1)).toBeNull();
    expect(estimate([[norte[0]]], stop, 1)).toBeNull();
  });
  it('trazado con puntos repetidos no genera NaN', () => {
    const p: LL[] = [norte[0], norte[1], norte[1], norte[2]];
    const e = estimate([p], norte[2], 0.9)!;
    expect(Number.isFinite(e.lng) && Number.isFinite(e.lat) && Number.isFinite(e.heading)).toBe(true);
  });
  it('elige el trazado más cercano a la parada', () => {
    const lejos: LL[] = norte.map(([x, y]) => [x + 0.0003, y]); // ~28 m al este
    const e = estimate([lejos, norte], norte[10], 1)!;
    expect(Math.abs(e.lng - -60.65)).toBeLessThan(1e-7);
  });
});

describe('headingNear', () => {
  it('rumbo del trazado cercano', () => expect(headingNear([norte], norte[4])).toBeCloseTo(0, 1));
  it('en el último punto usa el último segmento', () => expect(headingNear([norte], norte[10])).toBeCloseTo(0, 1));
  it('sin trazados => 0', () => expect(headingNear([], norte[0])).toBe(0));
});

describe('dedupe', () => {
  const mk = (i: number) => ({ lng: norte[0][0], lat: norte[0][1] + i * 100 * M_LAT, heading: 0 });
  it('une los que están a menos de 140 m, conservando el primero', () => {
    const out = dedupe([mk(0), mk(1), mk(3)]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(mk(0));
    expect(out[1]).toEqual(mk(3));
  });
  it('umbral configurable y lista vacía', () => {
    expect(dedupe([mk(0), mk(1)], 50)).toHaveLength(2);
    expect(dedupe([])).toEqual([]);
  });
});

describe('busFeatures', () => {
  const buses = [{ lng: -60.65, lat: -32.95, heading: 37, color: '#ff0000' }, { lng: -60.66, lat: -32.94, heading: 0, color: '#00ff00' }];
  it('sin colectivos => vacío; cantidad proporcional', () => {
    expect(busFeatures([], 15)).toEqual([]);
    const uno = busFeatures(buses.slice(0, 1), 15).length;
    expect(uno).toBeGreaterThanOrEqual(15);
    expect(busFeatures(buses, 15).length).toBe(2 * uno);
  });
  it('polígonos cerrados y con coordenadas finitas', () => {
    for (const z of [10, 14, 17, 20]) {
      for (const f of busFeatures(buses, z)) {
        expect(f.geometry.type).toBe('Polygon');
        const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        for (const [x, y] of ring) { expect(Number.isFinite(x)).toBe(true); expect(Number.isFinite(y)).toBe(true); }
        expect(Number.isFinite(f.properties!.b)).toBe(true);
        expect(f.properties!.h).toBeGreaterThan(f.properties!.b);
      }
    }
  });
  it('usa el color del colectivo en la carrocería', () => {
    const cs = new Set(busFeatures(buses, 15).map((f) => f.properties!.c));
    expect(cs.has('#ff0000') && cs.has('#00ff00')).toBe(true);
  });
  it('el tamaño crece al alejar el zoom (escala por zoom)', () => {
    const ancho = (z: number) => {
      const xs = busFeatures(buses.slice(0, 1), z).flatMap((f) => (f.geometry as GeoJSON.Polygon).coordinates[0].map((p) => p[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(ancho(14)).toBeGreaterThan(ancho(17));
    expect(ancho(17)).toBeGreaterThan(ancho(19));
  });
  it('busScale: acotada entre 1.3 y 12', () => {
    expect(busScale(5)).toBe(12);
    expect(busScale(25)).toBe(1.3);
    expect(busScale(16)).toBeCloseTo(2 ** 2.2, 6);
  });
  it('alturas escaladas por busScale', () => {
    const f = busFeatures(buses.slice(0, 1), 16);
    const s = busScale(16);
    expect(Math.max(...f.map((x) => x.properties!.h))).toBeCloseTo(3.2 * s, 6);
  });
});
