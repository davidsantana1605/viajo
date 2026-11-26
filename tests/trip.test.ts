import { describe, it, expect, vi, afterEach } from 'vitest';
import { planificar } from '../src/trip';

const pt = (x: number, y: number, nombre = '', parada?: string) => ({ coordinates: [x, y], properties: { nombre, parada } });
const fixture = {
  rutas: [{
    denominacion: 'Ruta 1', duracion: 1500, distanciaTotal: 5000, distanciaCaminata: 400, cantidadTransbordos: 0,
    inicio: '2026-11-25 23:43:36', fin: '2026-12-01 00:08:36',
    tramos: {
      features: [
        {
          geometry: { type: 'LineString', coordinates: [[-60.65, -32.95], [-60.651, -32.951]] },
          properties: { modo: 0, desde: pt(-60.65, -32.95, 'Origen'), hasta: pt(-60.651, -32.951, 'Parada', 'P9'), distancia: 100, duracion: 120, inicio: '2026-11-25 23:43:36', fin: '2026-11-25 23:45:36' },
        },
        {
          geometry: { type: 'MultiLineString', coordinates: [[[-60.651, -32.951], [-60.66, -32.96]], [[-60.66, -32.96], [-60.67, -32.97]]] },
          properties: {
            modo: 1, desde: pt(-60.651, -32.951, 'Parada', 'P9'), hasta: pt(-60.67, -32.97, 'Destino'), distancia: 4900, duracion: 1380,
            inicio: '2026-11-25 23:45:36', fin: '2026-12-01 00:08:36',
            linea: { id: '7', idEmpresa: '3', nombre: 'Línea 129 Roja', codigoEMR: '129', nombreCorto: '129R' },
          },
        },
      ],
    },
  }],
};

afterEach(() => vi.unstubAllGlobals());
const O = { lng: -60.65, lat: -32.95 }, D = { lng: -60.67, lat: -32.97 };

describe('planificar (fetch mockeado)', () => {
  it('parsea rutas, tramos, líneas y geometrías (simple y multi)', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => fixture }));
    vi.stubGlobal('fetch', f);
    const [r] = await planificar(O, D);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain('xOrigen=-60.65&yOrigen=-32.95&xDestino=-60.67&yDestino=-32.97&cantCuadras=8');
    expect(r).toMatchObject({ denom: 'Ruta 1', dur: 1500, dist: 5000, caminata: 400, transbordos: 0, inicio: '23:43', fin: '00:08' });
    expect(r.tramos.map((t) => t.modo)).toEqual(['walk', 'bus']);
    expect(r.tramos[0].geom).toHaveLength(2);
    expect(r.tramos[1].geom).toHaveLength(4);
    expect(r.tramos[0].linea).toBeUndefined();
    expect(r.tramos[1].linea).toEqual({ id: '7', idEmpresa: '3', nombre: 'Línea 129 Roja', codigo: '129' });
    expect(r.tramos[1].desde).toEqual({ lng: -60.651, lat: -32.951, nombre: 'Parada', parada: 'P9' });
  });

  it('código cae a nombreCorto si codigoEMR está vacío', async () => {
    const f = JSON.parse(JSON.stringify(fixture));
    f.rutas[0].tramos.features[1].properties.linea.codigoEMR = '';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => f })));
    expect((await planificar(O, D))[0].tramos[1].linea!.codigo).toBe('129R');
  });

  it('sin rutas => []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    expect(await planificar(O, D)).toEqual([]);
  });

  it('reintenta ante 500 y falla tras 3 intentos', async () => {
    const ok = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => fixture });
    vi.stubGlobal('fetch', ok);
    expect(await planificar(O, D)).toHaveLength(1);
    expect(ok).toHaveBeenCalledTimes(2);
    const mal = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', mal);
    await expect(planificar(O, D)).rejects.toThrow('planificador 500');
    expect(mal).toHaveBeenCalledTimes(3);
  }, 10_000);

  // ms() debe tratar "YYYY-MM-DD HH:MM:SS" como UTC-3 sea cual sea la zona del proceso.
  const zonas = ['UTC', 'America/Argentina/Buenos_Aires', 'America/New_York', 'Asia/Tokyo', 'Europe/Madrid'];
  it.each(zonas)('ms() independiente de la zona del proceso (TZ=%s)', async (tz) => {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => fixture })));
      const [r] = await planificar(O, D);
      expect(r.inicioMs).toBe(Date.UTC(2026, 10, 26, 2, 43, 36)); // 23:43:36 UTC-3 = 02:43:36 UTC del día siguiente
      expect(r.finMs).toBe(Date.UTC(2026, 11, 1, 3, 8, 36));
      expect(r.tramos[0].finMs - r.tramos[0].inicioMs).toBe(120_000);
      expect(r.tramos[1].inicioMs).toBe(r.tramos[0].finMs);
      expect(r.inicio).toBe('23:43'); // "HH:MM" se toma del texto, sin conversión
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });
});
