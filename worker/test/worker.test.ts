import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, { tick } from '../src/index';
import { FakeKV, ORIGIN, EP, MIN, R, mkEnv, rutina, instalarMundo, rawRuta, type Mundo } from './helpers';

// Web Push real necesita claves VAPID válidas: se reemplaza por un payload mínimo (el fetch al endpoint también es falso).
const pushPayloads: { data: { title: string; body: string; tag: string } }[] = [];
vi.mock('@block65/webcrypto-web-push', () => ({
  buildPushPayload: async (msg: { data: { title: string; body: string; tag: string } }) => { pushPayloads.push(msg); return { method: 'POST', headers: {}, body: JSON.stringify(msg.data) }; },
}));

let env: ReturnType<typeof mkEnv>;
let mundo: Mundo;
beforeEach(() => { env = mkEnv(); mundo = instalarMundo(); pushPayloads.length = 0; });

const call = (path: string, body: unknown, init: { origin?: string | null; method?: string; raw?: string; headers?: Record<string, string> } = {}) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...init.headers };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  const m = init.method ?? 'POST';
  return worker.fetch(new Request('https://w.test' + path, { method: m, headers, body: m === 'GET' || m === 'OPTIONS' ? undefined : (init.raw ?? JSON.stringify(body)) }), env, {} as ExecutionContext);
};
const sync = (endpoint: unknown, rutinas: unknown[], extra: Record<string, unknown> = {}) =>
  call('/sync', { subscription: { endpoint, keys: { p256dh: 'k', auth: 'a' } }, rutinas, usuario: 'Ana', ...extra });
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const leer = async (ep: string): Promise<any> => JSON.parse(env.DB.m.get(`s:${await sha(ep)}`) ?? 'null');

// Jueves 26/11/2026, llegada 08:00 → recomendación: abordar A-40, n1 A-120, n2 A-70, n3 A-55
const A = R(2026, 11, 26, 8, 0);
const at = (min: number, sec = 20) => A + min * MIN + sec * 1000;

describe('avisos n1/n2/n3', () => {
  it('se disparan en el minuto exacto y una sola vez, aunque el tick se repita', async () => {
    await sync(EP(1), [rutina()]);
    const out: string[] = [];
    for (const min of [-130, -121, -120, -120, -119, -90, -71, -70, -70, -69, -56, -55, -55, -54, -10, 0]) {
      for (const e of await tick(env, at(min), false)) out.push(`${min}:${e.aviso}`);
    }
    expect(out).toEqual(['-120:n1', '-70:n2', '-55:n3']);
    expect(mundo.push.calls).toHaveLength(3);
    expect(mundo.plan.calls).toHaveLength(1); // se calcula una sola vez
  });

  it('el contenido refleja la línea, la parada y el ETA en vivo', async () => {
    await sync(EP(1), [rutina()]);
    await tick(env, at(-120), false); await tick(env, at(-70), false);
    expect(pushPayloads[0].data.body).toContain('129');
    expect(pushPayloads[0].data.body).toContain('07:20'); // abordar = 08:00 - 10 - 30 = 07:20
    expect(pushPayloads[1].data.body).toContain('En vivo: pasa en 7 min');
    expect(pushPayloads[1].data.tag).toBe('r1-n2');
  });

  it('el reloj es por minuto aunque el cron llegue con segundos de retraso', async () => {
    await sync(EP(1), [rutina()]);
    expect(await tick(env, at(-120, 59), false)).toHaveLength(1);
  });
});

describe('días y medianoche', () => {
  it('filtra por días de la semana y no llama al planificador', async () => {
    await sync(EP(1), [rutina({ dias: [1, 2, 3] })]); // jueves = 4
    for (const min of [-120, -70, -55]) expect(await tick(env, at(min), false)).toEqual([]);
    expect(mundo.plan.calls).toHaveLength(0);
    expect(mundo.push.calls).toHaveLength(0);
  });
  it('rutinas inactivas o sin días no avisan', async () => {
    await sync(EP(1), [rutina({ activa: false }), rutina({ id: 'r2', dias: [] })]);
    expect(await tick(env, at(-120), false)).toEqual([]);
  });

  const casos: [string, number[], [number, number, number], [number, number, number], boolean][] = [
    ['jueves 00:30 avisa el miércoles 22:30', [4], [2026, 11, 26], [2026, 11, 25], true],
    ['jueves 00:30 NO avisa el jueves 22:30', [4], [2026, 11, 26], [2026, 11, 26], false],
    ['lunes 00:30 avisa el domingo 22:30', [1], [2026, 11, 30], [2026, 11, 29], true],
    ['domingo 00:30 avisa el sábado 22:30', [0], [2026, 11, 29], [2026, 11, 28], true],
    ['domingo 00:30 NO avisa el domingo 22:30', [0], [2026, 11, 29], [2026, 11, 29], false],
    ['1/12 00:30 (martes) avisa el 30/11 22:30 (cruce de mes)', [2], [2026, 12, 1], [2026, 11, 30], true],
    ['1/1/2027 00:30 (viernes) avisa el 31/12 22:30 (cruce de año)', [5], [2027, 1, 1], [2026, 12, 31], true],
  ];
  for (const [nombre, dias, [ly, lm, ld], [ty, tm, td], avisa] of casos) {
    it(nombre, async () => {
      await sync(EP(1), [rutina({ dias, llegada: '00:30' })]);
      const llegada = R(ly, lm, ld, 0, 30);
      const ahora = R(ty, tm, td, 22, 30, 10);
      const ev = await tick(env, ahora, false);
      if (avisa) {
        expect(ahora).toBe(llegada - 120 * MIN + 10_000);
        expect(ev.map((e) => e.aviso)).toEqual(['n1']);
        expect((await leer(EP(1))).estado.r1.fecha).toBe(`${ly}-${String(lm).padStart(2, '0')}-${String(ld).padStart(2, '0')}`);
      } else expect(ev).toEqual([]);
    });
  }
  it('00:30: n2 y n3 también caen el día anterior, y no se repiten pasada la medianoche', async () => {
    await sync(EP(1), [rutina({ dias: [4], llegada: '00:30' })]); // jueves 00:30; abordar 23:50 del miércoles
    const L = R(2026, 11, 26, 0, 30);
    const out: string[] = [];
    for (const m of [-120, -70, -55, -54, 0]) for (const e of await tick(env, L + m * MIN, false)) out.push(e.aviso);
    expect(out).toEqual(['n1', 'n2', 'n3']);
    expect(await tick(env, L + 2 * MIN, false)).toEqual([]);
  });
});

describe('cálculo tardío', () => {
  const run = async (inicio: number) => {
    await sync(EP(1), [rutina()]);
    const out: string[] = [];
    for (const min of [inicio, -70, -55].filter((m, i) => i === 0 || m > inicio)) for (const e of await tick(env, at(min), false)) out.push(e.aviso);
    return out;
  };
  it('calculada a A-90: n1 ya pasó y se omite; n2 y n3 salen', async () => { expect(await run(-90)).toEqual(['n2', 'n3']); });
  it('calculada a A-65: n1 y n2 pasaron; sale n3', async () => { expect(await run(-65)).toEqual(['n3']); });
  it('calculada a A-50: no sale nada y nada se re-envía', async () => { expect(await run(-50)).toEqual([]); });
  it('después de A-20 ya no se calcula (ni se llama al planificador)', async () => {
    await sync(EP(1), [rutina()]);
    await tick(env, at(-19), false); await tick(env, at(-5), false);
    expect(mundo.plan.calls).toHaveLength(0);
  });
  it('antes de A-121 no se calcula', async () => {
    await sync(EP(1), [rutina()]);
    await tick(env, at(-124), false);
    expect(mundo.plan.calls).toHaveLength(0);
  });
});

describe('planificador caído', () => {
  it('reintenta (3 fetch por intento) y se rinde tras 5 intentos por día', async () => {
    mundo.plan.status = 500;
    await sync(EP(1), [rutina()]);
    for (let i = 0; i < 8; i++) expect(await tick(env, at(-121 + i), false)).toEqual([]);
    expect(mundo.plan.calls).toHaveLength(5 * 3);
    expect((await leer(EP(1))).estado.r1.intentos).toBe(5);
    expect(mundo.push.calls).toHaveLength(0);
  });
  it('se recupera si el planificador vuelve antes de agotar los intentos', async () => {
    mundo.plan.status = 500;
    await sync(EP(1), [rutina()]);
    await tick(env, at(-121), false); await tick(env, at(-120), false);
    mundo.plan.status = 200;
    const ev = await tick(env, at(-119), false); // n1 ya pasó → sin aviso, pero queda calculada
    expect(ev).toEqual([]);
    expect((await leer(EP(1))).estado.r1.linea).toBe('129');
    expect((await tick(env, at(-70), false)).map((e) => e.aviso)).toEqual(['n2']);
  });
  it('respuesta sin rutas de colectivo: cuenta como intento fallido, no rompe', async () => {
    mundo.plan.rutas = [];
    await sync(EP(1), [rutina()]);
    expect(await tick(env, at(-120), false)).toEqual([]);
  });
});

describe('push caído', () => {
  for (const status of [404, 410]) {
    it(`${status} borra la suscripción y el índice, y las demás siguen recibiendo`, async () => {
      await sync(EP(1), [rutina()]); await sync(EP(2), [rutina()]);
      const base = globalThis.fetch;
      vi.stubGlobal('fetch', async (i: string | Request, init?: RequestInit) => {
        const url = typeof i === 'string' ? i : i.url;
        if (url === EP(1)) { mundo.push.porUrl[url] = (mundo.push.porUrl[url] ?? 0) + 1; return new Response('', { status }); }
        return base(i, init);
      });
      const ev = await tick(env, at(-120), false);
      expect(ev.map((e) => e.enviado)).toEqual([false, true]);
      expect(mundo.push.porUrl[EP(2)]).toBe(1);
      expect(env.DB.m.get(`s:${await sha(EP(1))}`)).toBeUndefined();
      expect(JSON.parse(env.DB.m.get('idx')!)).toEqual([await sha(EP(2))]);
      expect(JSON.parse(env.DB.m.get('win')!)[await sha(EP(1))]).toBeUndefined();
    });
  }
  it('error 500 del servicio push no borra la suscripción', async () => {
    await sync(EP(1), [rutina()]); mundo.push.status = 500;
    const ev = await tick(env, at(-120), false);
    expect(ev[0].enviado).toBe(false);
    expect(await leer(EP(1))).not.toBeNull();
  });
  it('/test con 410 borra la suscripción', async () => {
    await sync(EP(1), [rutina()]); mundo.push.status = 410;
    const r = await call('/test', { endpoint: EP(1) });
    expect(r.status).toBe(502);
    expect(await leer(EP(1))).toBeNull();
  });
  it('/test OK', async () => {
    await sync(EP(1), []);
    expect((await call('/test', { endpoint: EP(1) })).status).toBe(200);
  });
});

describe('/sync: validación', () => {
  it('recorta a 10 rutinas, strings largos y normaliza campos', async () => {
    const muchas = Array.from({ length: 15 }, (_, i) => rutina({ id: 'x' + i }));
    muchas[0] = rutina({ id: 'i'.repeat(100), nombre: 'n'.repeat(500), destino: { nombre: 'd'.repeat(500), lng: -60, lat: -32 }, margen: 999, dias: [4, 4, -1, 7, 1.5, '2', 2] });
    const r = await sync(EP(1), muchas, { usuario: 'u'.repeat(200) });
    expect(await r.json()).toEqual({ ok: true, rutinas: 10 });
    const s = await leer(EP(1));
    expect(s.rutinas).toHaveLength(10);
    expect(s.rutinas[0].id).toHaveLength(40);
    expect(s.rutinas[0].nombre).toHaveLength(60);
    expect(s.rutinas[0].destino.nombre).toHaveLength(120);
    expect(s.rutinas[0].margen).toBe(10); // fuera de rango → por defecto
    expect(s.rutinas[0].dias).toEqual([4, 2]);
    expect(s.usuario).toHaveLength(40);
  });
  it('descarta rutinas con coordenadas, hora o lugares inválidos', async () => {
    const malas = [
      rutina({ id: 'a', destino: { nombre: 'x', lng: 200, lat: 0 } }),
      rutina({ id: 'b', origen: { nombre: 'x', lng: 0, lat: -91 } }),
      rutina({ id: 'c', origen: { nombre: 'x', lng: '1', lat: 1 } }),
      rutina({ id: 'd', destino: null }),
      rutina({ id: 'e', llegada: '24:00' }), rutina({ id: 'f', llegada: '8:00' }), rutina({ id: 'g', llegada: '08:60' }), rutina({ id: 'h', llegada: 800 }),
      null, 'x', 5,
    ];
    malas.unshift(rutina({ id: 'ok' }));
    const r = await sync(EP(1), malas);
    expect(await r.json()).toEqual({ ok: true, rutinas: 1 });
    expect((await leer(EP(1))).rutinas[0].id).toBe('ok');
  });
  it('dias ausente → vacío; ids repetidos se renombran', async () => {
    await sync(EP(1), [{ ...rutina({ id: 'dup' }), dias: undefined }, rutina({ id: 'dup' })]);
    const s = await leer(EP(1));
    expect(s.rutinas[0].dias).toEqual([]);
    expect(s.rutinas[0].id).not.toBe(s.rutinas[1].id);
  });
  it('rechaza endpoints no permitidos', async () => {
    for (const ep of ['https://evil.example/x', 'http://fcm.googleapis.com/x', 'https://googleapis.com.evil.com/x', 'https://evilgoogleapis.com/x', 'javascript:alert(1)', 'nada', '', 5, null]) {
      const r = await sync(ep, [rutina()]);
      expect(r.status, String(ep)).toBe(400);
    }
    expect(env.DB.m.size).toBe(0);
  });
  it('acepta los servicios push conocidos', async () => {
    for (const ep of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2.notify.windows.com/x', EP(1)]) expect((await sync(ep, [])).status).toBe(200);
  });
  it('exige claves p256dh y auth', async () => {
    expect((await call('/sync', { subscription: { endpoint: EP(1), keys: { p256dh: 'k' } } })).status).toBe(400);
    expect((await call('/sync', { subscription: { endpoint: EP(1) } })).status).toBe(400);
    expect((await call('/sync', {})).status).toBe(400);
  });
  it('tope de 200 suscripciones (las existentes siguen pudiendo sincronizar)', async () => {
    await sync(EP('existente'), []);
    const ids = [await sha(EP('existente')), ...Array.from({ length: 199 }, (_, i) => 'f' + i)];
    env.DB.m.set('idx', JSON.stringify(ids));
    expect((await sync(EP('nueva'), [])).status).toBe(503);
    expect((await sync(EP('existente'), [])).status).toBe(200);
    expect(JSON.parse(env.DB.m.get('idx')!)).toHaveLength(200);
  });
  it('cuerpo > 64 KB: por content-length y también sin él', async () => {
    const grande = JSON.stringify({ subscription: { endpoint: EP(1), keys: { p256dh: 'k', auth: 'a' } }, relleno: 'x'.repeat(70_000) });
    expect((await call('/sync', null, { raw: grande })).status).toBe(413);
    expect((await call('/sync', null, { raw: '{}', headers: { 'content-length': '70000' } })).status).toBe(413);
    expect(env.DB.m.size).toBe(0);
  });
  it('JSON inválido / no objeto → 400', async () => {
    expect((await call('/sync', null, { raw: '{no' })).status).toBe(400);
    expect((await call('/sync', null, { raw: 'null' })).status).toBe(400);
    expect((await call('/sync', null, { raw: '[]' })).status).toBe(400);
  });
  it('el índice no duplica al re-sincronizar', async () => {
    await sync(EP(1), []); await sync(EP(1), [rutina()]);
    expect(JSON.parse(env.DB.m.get('idx')!)).toHaveLength(1);
  });
  it('re-sincronizar conserva lo calculado hoy, salvo que la rutina cambie', async () => {
    await sync(EP(1), [rutina()]);
    await tick(env, at(-120), false);
    await sync(EP(1), [rutina({ nombre: 'otro nombre' })]); // sólo el nombre: conserva (no repite n1)
    expect(await tick(env, at(-120), false)).toEqual([]);
    expect((await leer(EP(1))).estado.r1.enviados.n1).toBeDefined();
    await sync(EP(1), [rutina({ llegada: '09:00' })]); // cambió la hora: la recomendación vieja ya no vale
    expect((await leer(EP(1))).estado.r1).toBeUndefined();
  });
});

describe('/loc, /unsubscribe y desconocidos', () => {
  it('/loc valida y guarda; /unsubscribe borra todo', async () => {
    await sync(EP(1), []);
    expect((await call('/loc', { endpoint: EP(1), lng: 999, lat: 0 })).status).toBe(400);
    expect((await call('/loc', { endpoint: EP(1), lng: -60.6, lat: -32.9 })).status).toBe(200);
    expect((await leer(EP(1))).loc.lng).toBe(-60.6);
    expect((await call('/unsubscribe', { endpoint: EP(1) })).status).toBe(200);
    expect(await leer(EP(1))).toBeNull();
    expect(JSON.parse(env.DB.m.get('idx')!)).toEqual([]);
  });
  it('suscripción desconocida → 404; endpoint inválido → 400; ruta inexistente → 404', async () => {
    expect((await call('/loc', { endpoint: EP(9), lng: 0, lat: 0 })).status).toBe(404);
    expect((await call('/loc', { endpoint: 'https://evil.example', lng: 0, lat: 0 })).status).toBe(400);
    expect((await call('/nada', {}, { method: 'GET' })).status).toBe(404);
  });
  it('/health y /vapid', async () => {
    expect((await (await call('/health', null, { method: 'GET' })).json())).toMatchObject({ ok: true });
    expect((await (await call('/vapid', null, { method: 'GET' })).json())).toEqual({ publicKey: 'pub' });
  });
  it('/debug/tick sólo con DEBUG=1', async () => {
    expect((await call('/debug/tick', null, { method: 'GET' })).status).toBe(404);
    env = mkEnv({ DEBUG: '1' });
    expect((await call('/debug/tick?now=basura', null, { method: 'GET' })).status).toBe(400);
    expect((await call('/debug/tick', null, { method: 'GET' })).status).toBe(200);
  });
});

describe('CORS', () => {
  it('origen permitido: encabezados; ajeno: 403 en POST y sin encabezados', async () => {
    const ok = await call('/sync', {}, { origin: ORIGIN });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const mal = await call('/sync', {}, { origin: 'https://evil.example' });
    expect(mal.status).toBe(403);
    expect(mal.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('preflight', async () => {
    const ok = await call('/sync', null, { method: 'OPTIONS', origin: ORIGIN });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const mal = await call('/sync', null, { method: 'OPTIONS', origin: 'https://evil.example' });
    expect(mal.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('sin Origin (curl) se acepta', async () => { expect((await sync(EP(1), [])).status).toBe(200); });
  it('localhost permitido', async () => {
    expect((await call('/sync', {}, { origin: 'http://localhost:5173' })).headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});

describe('ubicación', () => {
  const origenUsado = () => new URL(mundo.plan.calls[0]).searchParams.get('xOrigen');
  const conLoc = async (haceMin: number, usar: boolean) => {
    await sync(EP(1), [rutina({ usarUbicacion: usar })]);
    const s = await leer(EP(1)); s.loc = { lng: -61.1, lat: -32.1, ts: at(-120) - haceMin * MIN };
    env.DB.m.set(`s:${s.id}`, JSON.stringify(s));
    await tick(env, at(-120), false);
  };
  it('reciente (<3 h) con usarUbicacion → usa la ubicación', async () => { await conLoc(60, true); expect(origenUsado()).toBe('-61.1'); });
  it('vieja (>3 h) → usa el origen fijo', async () => { await conLoc(181, true); expect(origenUsado()).toBe('-60.65'); });
  it('sin usarUbicacion → origen fijo aunque haya ubicación reciente', async () => { await conLoc(5, false); expect(origenUsado()).toBe('-60.65'); });
  it('/sync sin loc conserva la última ubicación', async () => {
    await sync(EP(1), [], { loc: { lng: -60.1, lat: -32.2 } });
    await sync(EP(1), []);
    expect((await leer(EP(1))).loc.lng).toBe(-60.1);
  });
});

describe('modo dry', () => {
  it('devuelve los mensajes sin enviar, sin marcar avisos y sin escribir en KV', async () => {
    await sync(EP(1), [rutina()]);
    const antes = JSON.stringify([...env.DB.m]);
    const ev = await tick(env, at(-120), true);
    expect(ev).toHaveLength(1);
    expect(ev[0].enviado).toBe(false);
    expect(mundo.push.calls).toHaveLength(0);
    expect(JSON.stringify([...env.DB.m])).toBe(antes);
    expect((await tick(env, at(-120), false)).map((e) => e.aviso)).toEqual(['n1']); // y luego el real sí envía
  });
  it('dry con push caído no borra nada', async () => {
    await sync(EP(1), [rutina()]); mundo.push.status = 410;
    await tick(env, at(-120), true);
    expect(await leer(EP(1))).not.toBeNull();
  });
});

describe('limpieza de estados viejos', () => {
  it('borra estados de más de 24 h y conserva los del día', async () => {
    await sync(EP(1), [rutina(), rutina({ id: 'viejo', dias: [1] }), rutina({ id: 'hoy', dias: [1] })]);
    const s = await leer(EP(1));
    const e = (llegadaMs: number) => ({ fecha: 'x', abordarMs: 0, salidaMs: 0, llegadaMs, linea: '129', lineaNombre: 'L', paradaId: null, paradaNombre: '', caminaMin: 1, enviados: {}, intentos: 0 });
    s.estado = { viejo: e(at(-120) - 25 * 3600_000), hoy: e(at(-120) - 3600_000) };
    env.DB.m.set(`s:${s.id}`, JSON.stringify(s));
    await tick(env, at(-120), false);
    const n = await leer(EP(1));
    expect(Object.keys(n.estado).sort()).toEqual(['hoy', 'r1']);
  });
});

describe('escala y aislamiento', () => {
  it('con 150 suscripciones, sólo se lee y se consulta lo que corresponde a este minuto', async () => {
    for (let i = 0; i < 150; i++) await sync(EP(i), [rutina({ llegada: i === 7 ? '08:00' : '18:00' })]);
    env.DB.gets.length = 0;
    const ev = await tick(env, at(-120), false);
    expect(ev).toHaveLength(1);
    expect(env.DB.gets.filter((k) => k.startsWith('s:'))).toHaveLength(2); // la suscripción con aviso: lectura + relectura antes de guardar
    expect(mundo.plan.calls).toHaveLength(1);
    env.DB.gets.length = 0;
    await tick(env, A + 3 * 3600_000, false); // un minuto sin nada que hacer: sólo se leen los índices
    expect(env.DB.gets.filter((k) => k.startsWith('s:'))).toHaveLength(0);
  });
  it('suscripciones anteriores al índice win se leen igual (compatibilidad)', async () => {
    await sync(EP(1), [rutina()]);
    env.DB.m.delete('win');
    expect(await tick(env, at(-120), false)).toHaveLength(1);
  });
  it('cada aviso va sólo al endpoint de su dueño, con su nombre y su estado', async () => {
    await sync(EP(1), [rutina()], { usuario: 'Ana' }); await sync(EP(2), [rutina({ llegada: '08:30', nombre: 'Gym' })], { usuario: 'Beto' });
    await tick(env, at(-120), false);
    expect(mundo.push.porUrl[EP(1)]).toBe(1);
    expect(mundo.push.porUrl[EP(2)]).toBeUndefined();
    expect(pushPayloads[0].data.body).toContain('Ana');
    expect(pushPayloads[0].data.body).not.toContain('Beto');
    await tick(env, at(-90), false);
    expect(mundo.push.porUrl[EP(2)]).toBe(1);
    expect(pushPayloads[1].data.body).toContain('Beto');
    expect(pushPayloads[1].data.body).toContain('Gym');
  });
});

describe('condiciones de carrera con /sync y /unsubscribe durante el tick', () => {
  it('un /sync que llega mientras se calcula no se pierde (y el estado se conserva)', async () => {
    await sync(EP(1), [rutina()]);
    mundo.plan.hook = async () => { mundo.plan.hook = undefined; await sync(EP(1), [rutina({ nombre: 'Nuevo nombre' })]); };
    await tick(env, at(-120), false);
    const s = await leer(EP(1));
    expect(s.rutinas[0].nombre).toBe('Nuevo nombre');
    expect(s.estado.r1.enviados.n1).toBeDefined();
  });
  it('un /sync que cambia la hora descarta el estado calculado con la configuración vieja', async () => {
    await sync(EP(1), [rutina()]);
    mundo.plan.hook = async () => { mundo.plan.hook = undefined; await sync(EP(1), [rutina({ llegada: '09:00' })]); };
    await tick(env, at(-120), false);
    expect((await leer(EP(1))).estado.r1).toBeUndefined();
  });
  it('un /unsubscribe durante el tick no resucita la suscripción', async () => {
    await sync(EP(1), [rutina()]);
    mundo.plan.hook = async () => { mundo.plan.hook = undefined; await call('/unsubscribe', { endpoint: EP(1) }); };
    await tick(env, at(-120), false);
    expect(await leer(EP(1))).toBeNull();
  });
});

describe('sanidad de fixtures', () => {
  it('la ruta de prueba tiene caminata + colectivo', () => { expect(rawRuta().tramos.features).toHaveLength(2); expect(new FakeKV().m.size).toBe(0); });
});
