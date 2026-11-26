import { describe, it, expect, vi, afterEach } from 'vitest';
import { posgarToWgs84, buscarLugares } from '../src/geo';

describe('posgarToWgs84 (EPSG:22185 → WGS84)', () => {
  it('punto conocido 1', () => {
    const [lng, lat] = posgarToWgs84(5436702.098497913, 6356900.170170514);
    expect(lng).toBeCloseTo(-60.676773, 4);
    expect(lat).toBeCloseTo(-32.928896, 4);
  });
  it('punto conocido 2', () => {
    const [lng, lat] = posgarToWgs84(5439793.946553064, 6355103.561697314);
    expect(lng).toBeCloseTo(-60.6438, 3);
    expect(lat).toBeCloseTo(-32.9453, 3);
  });
  it('el meridiano central (x = 5.500.000) cae en lng = -60', () => {
    expect(posgarToWgs84(5500000, 6356900)[0]).toBeCloseTo(-60, 8);
  });
  it('al este aumenta la longitud, al norte la latitud', () => {
    const a = posgarToWgs84(5436702, 6356900), e = posgarToWgs84(5436802, 6356900), n = posgarToWgs84(5436702, 6357000);
    expect(e[0]).toBeGreaterThan(a[0]);
    expect(n[1]).toBeGreaterThan(a[1]);
    expect(Math.abs(n[1] - a[1]) * 111195).toBeCloseTo(100, -1);
  });
});

afterEach(() => vi.unstubAllGlobals());
const feat = (name: string, x: number, y: number, type = 'Point', extra: object = {}) =>
  ({ geometry: { type, coordinates: type === 'Point' ? [x, y] : [[x, y], [x + 10, y + 10], [x + 20, y + 20]] }, properties: { name, ...extra } });

describe('buscarLugares', () => {
  const mock = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
  it('convierte coordenadas, titula nombres y arma el detalle', async () => {
    mock({ features: [feat('CORDOBA 1234', 5436702.098497913, 6356900.170170514, 'Point', { subtipo: 'DIRECCIÓN,x', divs_admin: [{ nombreTipo: 'Barrio', valor: 'CENTRO' }] })] });
    const [l] = await buscarLugares('cordoba 1234');
    expect(l.nombre).toBe('Cordoba 1234');
    expect(l.detalle).toBe('Dirección · Centro');
    expect(l.lng).toBeCloseTo(-60.676773, 4);
  });
  it('calles (no Point) piden altura; descarta puntos fuera de zona y sin nombre', async () => {
    mock({ features: [feat('SAN MARTIN Y DE LA PAZ', 5436702, 6356900, 'LineString'), feat('Lejos', 5000000, 6000000), { geometry: { type: 'Point', coordinates: [5436702, 6356900] }, properties: {} }] });
    const r = await buscarLugares('x');
    expect(r).toHaveLength(1);
    expect(r[0].nombre).toBe('San Martin y de la Paz');
    expect(r[0].detalle).toMatch(/^Calle/);
  });
  it('respuesta no ok => []', async () => {
    mock({}, false);
    expect(await buscarLugares('x')).toEqual([]);
  });
});
