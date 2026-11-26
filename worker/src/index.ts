// Worker de notificaciones de Viajo: guarda rutinas y manda Web Push a la hora justa.
import { buildPushPayload, type PushSubscription } from '@block65/webcrypto-web-push';
import { planificar } from '../../src/trip';
import {
  rosario, fechaKey, aMs, minutoDe, recomendar, mensaje, momentos, hm,
  type Rutina, type Reco, type Aviso, type Fecha,
} from '../../src/recomendar';

export interface Env {
  DB: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  ALLOWED_ORIGINS: string;
  DEBUG?: string;
}

interface Dia {
  fecha: string;
  abordarMs: number; salidaMs: number; llegadaMs: number;
  linea: string; lineaNombre: string; paradaId: string | null; paradaNombre: string; caminaMin: number;
  enviados: Partial<Record<Aviso, number>>;
  intentos: number;
}
interface Sub {
  id: string;
  sub: PushSubscription;
  usuario: string;
  rutinas: Rutina[];
  loc?: { lng: number; lat: number; ts: number };
  estado: Record<string, Dia>;
}
interface Evento { sub: string; rutina: string; aviso: Aviso; titulo: string; cuerpo: string; enviado: boolean; detalle?: string }

const MAX_RUTINAS = 10;
const MAX_SUBS = 200;
const MAX_BODY = 64 * 1024;
const PUSH_HOSTS = ['googleapis.com', 'mozilla.com', 'push.apple.com', 'windows.com'];

/* ---------------- utilidades ---------------- */
const json = (data: unknown, status = 200, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors } });

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const ok = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin);
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : { vary: 'origin' };
}

async function idDe(endpoint: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sólo se aceptan endpoints de servicios push conocidos (evita que el worker haga POST a cualquier URL). */
function endpointValido(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
  } catch { return false; }
}

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function lugar(v: unknown) {
  const o = (v ?? {}) as Record<string, unknown>;
  const lng = num(o.lng, -180, 180), lat = num(o.lat, -90, 90);
  return lng === null || lat === null ? null : { nombre: str(o.nombre, 120) || 'Lugar', lng, lat };
}

function limpiarRutinas(v: unknown): Rutina[] {
  if (!Array.isArray(v)) return [];
  const out: Rutina[] = [];
  const vistos = new Set<string>();
  for (const x of v.slice(0, MAX_RUTINAS)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const destino = lugar(o.destino), origen = lugar(o.origen);
    const llegada = str(o.llegada, 5);
    if (!destino || !origen || !/^([01]\d|2[0-3]):[0-5]\d$/.test(llegada)) continue;
    const dias = Array.isArray(o.dias) ? [...new Set((o.dias as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))] : [];
    let id = str(o.id, 40);
    if (!id || vistos.has(id)) id = crypto.randomUUID(); // ids repetidos pisarían el estado de la otra rutina
    vistos.add(id);
    out.push({
      id, nombre: str(o.nombre, 60) || 'Rutina', destino, origen,
      usarUbicacion: o.usarUbicacion === true, dias, llegada, margen: num(o.margen, 0, 60) ?? 10, activa: o.activa !== false,
    });
  }
  return out;
}

const leerSub = async (env: Env, id: string): Promise<Sub | null> => {
  const raw = await env.DB.get(`s:${id}`);
  return raw ? (JSON.parse(raw) as Sub) : null;
};
const guardarSub = (env: Env, s: Sub) => env.DB.put(`s:${s.id}`, JSON.stringify(s));
const leerIdx = async (env: Env): Promise<string[]> => JSON.parse((await env.DB.get('idx')) ?? '[]');

/** Parte de la rutina que invalida lo ya calculado del día (si cambia, la recomendación vieja ya no sirve). */
const cfgKey = (r: Rutina) => JSON.stringify([r.llegada, r.margen, r.origen, r.destino, r.usarUbicacion]);

/**
 * Índice liviano 'win': por suscripción, los (días, llegada) de sus rutinas activas. Permite que el cron de cada
 * minuto lea SÓLO las suscripciones con una ventana abierta (el plan gratis limita las lecturas de KV por
 * invocación y por día). Si falta una entrada (suscripción anterior a este índice) se lee la suscripción igual.
 */
type Win = Record<string, { d: number[]; l: string }[]>;
const leerWin = async (env: Env): Promise<Win> => { try { return JSON.parse((await env.DB.get('win')) ?? '{}') as Win; } catch { return {}; } };
const ventanasDe = (rutinas: Rutina[]) => rutinas.filter((r) => r.activa && r.dias.length).map((r) => ({ d: r.dias, l: r.llegada }));
async function actualizarWin(env: Env, id: string, rutinas: Rutina[] | null) {
  const w = await leerWin(env);
  if (rutinas) w[id] = ventanasDe(rutinas); else delete w[id];
  await env.DB.put('win', JSON.stringify(w));
}

async function borrarSub(env: Env, id: string) {
  const idx = (await leerIdx(env)).filter((x) => x !== id);
  await env.DB.put('idx', JSON.stringify(idx));
  await env.DB.delete(`s:${id}`);
  await actualizarWin(env, id, null);
}

/** Ventana de avisos de una rutina: desde 125 min antes de la llegada hasta 5 min después (hoy o mañana, hora de Rosario). */
function fechasEnVentana(dias: number[], llegada: string, now: number): { f: Fecha; A: number }[] {
  const hoy = rosario(now);
  const out: { f: Fecha; A: number }[] = [];
  for (const off of [0, 1]) {
    const t = new Date(Date.UTC(hoy.y, hoy.m - 1, hoy.d + off));
    if (!dias.includes(t.getUTCDay())) continue;
    const f: Fecha = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
    const A = aMs(f, llegada);
    if (now >= A - 125 * 60_000 && now <= A + 5 * 60_000) out.push({ f, A });
  }
  return out;
}

/* ---------------- API ---------------- */
async function manejar(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cors = corsHeaders(req, env);
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, servicio: 'viajo-push' }, 200, cors);
  if (url.pathname === '/vapid') return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, cors);

  if (url.pathname === '/debug/tick' && env.DEBUG === '1') {
    const now = url.searchParams.get('now') ? new Date(url.searchParams.get('now')!).getTime() : Date.now();
    if (!Number.isFinite(now)) return json({ error: 'now inválido' }, 400, cors);
    return json(await tick(env, now, url.searchParams.get('dry') !== '0'), 200, cors);
  }

  if (req.method !== 'POST') return json({ error: 'no encontrado' }, 404, cors);
  const origin = req.headers.get('origin');
  if (origin && !cors['access-control-allow-origin']) return json({ error: 'origen no permitido' }, 403, cors);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return json({ error: 'cuerpo demasiado grande' }, 413, cors);
  // Sin content-length (chunked) el encabezado no sirve: se mide el cuerpo real.
  const crudo = await req.text();
  if (crudo.length > MAX_BODY) return json({ error: 'cuerpo demasiado grande' }, 413, cors);
  let body: Record<string, unknown>;
  try { body = JSON.parse(crudo) as Record<string, unknown>; } catch { return json({ error: 'JSON inválido' }, 400, cors); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'JSON inválido' }, 400, cors);

  if (url.pathname === '/sync') {
    const s = (body.subscription ?? {}) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!s.endpoint || !endpointValido(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'suscripción inválida' }, 400, cors);
    const id = await idDe(s.endpoint);
    const idx = await leerIdx(env);
    if (!idx.includes(id)) {
      if (idx.length >= MAX_SUBS) return json({ error: 'servicio lleno' }, 503, cors);
      idx.push(id);
      await env.DB.put('idx', JSON.stringify(idx));
    }
    const previo = await leerSub(env, id);
    const rutinas = limpiarRutinas(body.rutinas);
    const estado: Sub['estado'] = {};
    // conserva lo ya calculado hoy, salvo que la rutina haya cambiado (hora, margen, lugares): ahí se recalcula
    for (const r of rutinas) {
      const antes = previo?.rutinas.find((x) => x.id === r.id);
      if (previo?.estado[r.id] && antes && cfgKey(antes) === cfgKey(r)) estado[r.id] = previo.estado[r.id];
    }
    const loc = lugar(body.loc);
    const sub: Sub = {
      id, sub: { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
      usuario: str(body.usuario, 40), rutinas, estado,
      loc: loc ? { lng: loc.lng, lat: loc.lat, ts: Date.now() } : previo?.loc,
    };
    await guardarSub(env, sub);
    await actualizarWin(env, id, rutinas);
    return json({ ok: true, rutinas: rutinas.length }, 200, cors);
  }

  const endpoint = str(body.endpoint, 600);
  if (!endpointValido(endpoint)) return json({ error: 'endpoint inválido' }, 400, cors);
  const id = await idDe(endpoint);
  const sub = await leerSub(env, id);
  if (!sub) return json({ error: 'suscripción desconocida: volvé a activar las notificaciones' }, 404, cors);

  if (url.pathname === '/loc') {
    const l = lugar(body);
    if (!l) return json({ error: 'ubicación inválida' }, 400, cors);
    sub.loc = { lng: l.lng, lat: l.lat, ts: Date.now() };
    await guardarSub(env, sub);
    return json({ ok: true }, 200, cors);
  }
  if (url.pathname === '/unsubscribe') {
    await borrarSub(env, id);
    return json({ ok: true }, 200, cors);
  }
  if (url.pathname === '/test') {
    const r = await enviar(env, sub, { titulo: 'Viajo · prueba', cuerpo: `${sub.usuario ? sub.usuario + ', ' : ''}las notificaciones de tus rutinas están funcionando.`, tag: 'test' });
    if (r === 'gone') await borrarSub(env, id);
    return json({ ok: r === 'ok', resultado: r }, r === 'ok' ? 200 : 502, cors);
  }
  return json({ error: 'no encontrado' }, 404, cors);
}

/* ---------------- Envío ---------------- */
async function enviar(env: Env, sub: Sub, m: { titulo: string; cuerpo: string; tag: string }): Promise<'ok' | 'gone' | 'error'> {
  try {
    const payload = await buildPushPayload(
      { data: { title: m.titulo, body: m.cuerpo, tag: m.tag, url: './#rutinas' }, options: { ttl: 900, urgency: 'high' } },
      sub.sub,
      { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    );
    const res = await fetch(sub.sub.endpoint, payload);
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}

/* ---------------- Reloj de rutinas ---------------- */
const API = 'https://ws.rosario.gob.ar/ubicaciones/public';

async function etaEnVivo(paradaId: string | null, lineaNombre: string): Promise<{ min: number; vivo: boolean } | null> {
  if (!paradaId) return null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${API}/cuandollega?parada=${encodeURIComponent(paradaId)}&linea=${encodeURIComponent(lineaNombre)}`);
      if (!r.ok) { await new Promise((res) => setTimeout(res, 300)); continue; }
      const d = (await r.json()) as { linea: { nombre: string }; arribos: { arriboEnMinutos: number; tipo: string }[] }[];
      const a = d.find((x) => x.linea.nombre === lineaNombre)?.arribos?.[0];
      return a ? { min: a.arriboEnMinutos, vivo: a.tipo.toLowerCase() !== 'programado' } : null;
    } catch { /* reintenta */ }
  }
  return null;
}

/** Calcula la recomendación del día desde el origen (la ubicación reciente de la app, o el origen fijo). */
async function calcular(sub: Sub, r: Rutina, llegadaMs: number, now: number): Promise<Reco | null> {
  const reciente = sub.loc && now - sub.loc.ts < 3 * 3600_000;
  const o = r.usarUbicacion && reciente ? sub.loc! : r.origen;
  const rutas = await planificar({ lng: o.lng, lat: o.lat }, { lng: r.destino.lng, lat: r.destino.lat }, undefined, 10);
  return recomendar(rutas, llegadaMs, r.margen);
}

/**
 * Se ejecuta cada minuto. Un aviso se dispara cuando el minuto actual coincide con su minuto objetivo
 * (y queda marcado como enviado por si el cron se repite). `dry` devuelve los mensajes sin enviarlos.
 */
export async function tick(env: Env, now: number, dry: boolean): Promise<Evento[]> {
  const eventos: Evento[] = [];
  const win = await leerWin(env);
  for (const id of await leerIdx(env)) {
    // sin ventana abierta no se lee la suscripción (ahorra lecturas de KV y CPU con muchas suscripciones)
    const w = win[id];
    if (w && !w.some((x) => fechasEnVentana(x.d, x.l, now).length)) continue;
    const sub = await leerSub(env, id);
    if (!sub) continue;
    let cambiado = false, gone = false;
    for (const r of sub.rutinas) {
      if (gone) break;
      if (!r.activa || !r.dias.length) continue;
      // hoy y mañana: una llegada a las 00:30 se avisa desde las 22:30 del día anterior
      for (const { f, A } of fechasEnVentana(r.dias, r.llegada, now)) {
        const key = `${r.id}`;
        let st = sub.estado[key];
        if (!st || st.fecha !== fechaKey(f)) {
          // todavía no hay recomendación de ese día: se calcula una vez entrada la ventana de 2 h
          if (now < A - 121 * 60_000 || now > A - 20 * 60_000) continue;
          st = { fecha: fechaKey(f), abordarMs: 0, salidaMs: 0, llegadaMs: A, linea: '', lineaNombre: '', paradaId: null, paradaNombre: '', caminaMin: 0, enviados: {}, intentos: 0 };
        }
        if (!st.linea) {
          if (st.intentos >= 5) continue;
          st.intentos++;
          sub.estado[key] = st; cambiado = true;
          const reco = await calcular(sub, r, A, now).catch(() => null);
          if (!reco) continue;
          Object.assign(st, { abordarMs: reco.abordarMs, salidaMs: reco.salidaMs, linea: reco.linea, lineaNombre: reco.lineaNombre, paradaId: reco.paradaId, paradaNombre: reco.paradaNombre, caminaMin: reco.caminaMin });
        }

        const mom = momentos(A, st.abordarMs);
        for (const aviso of ['n1', 'n2', 'n3'] as Aviso[]) {
          if (st.enviados[aviso] !== undefined || minutoDe(now) !== minutoDe(mom[aviso])) continue;
          const reco = { linea: st.linea, lineaNombre: st.lineaNombre, paradaId: st.paradaId, paradaNombre: st.paradaNombre, abordarMs: st.abordarMs, salidaMs: st.salidaMs, llegadaMs: A, caminaMin: st.caminaMin, viajeMin: 0 } as Reco;
          const eta = aviso === 'n1' ? null : await etaEnVivo(st.paradaId, st.lineaNombre);
          const msg = mensaje(aviso, { usuario: sub.usuario, rutina: r, reco, etaMin: eta?.min, etaVivo: eta?.vivo });
          let enviado = false, detalle: string | undefined;
          if (!dry) {
            const res = await enviar(env, sub, { ...msg, tag: `${r.id}-${aviso}` });
            enviado = res === 'ok'; detalle = res;
            st.enviados[aviso] = now; cambiado = true;
            if (res === 'gone') gone = true;
          }
          eventos.push({ sub: id, rutina: r.nombre, aviso, ...msg, enviado, detalle });
          if (gone) break;
        }
        sub.estado[key] = st;
        if (gone) break;
      }
    }
    if (dry) continue; // el modo de prueba no deja rastro en KV (ni intentos ni avisos marcados)
    if (gone) { await borrarSub(env, id); continue; } // una suscripción caída no frena a las demás
    // limpia estados de días pasados
    for (const [k, v] of Object.entries(sub.estado)) if (v.llegadaMs < now - 24 * 3600_000) { delete sub.estado[k]; cambiado = true; }
    if (cambiado) {
      // El usuario pudo sincronizar (o darse de baja) mientras se calculaba: se parte de lo último guardado y sólo se
      // vuelca el estado de las rutinas que no cambiaron, así no se pisan sus cambios ni se resucita una suscripción borrada.
      const fresca = await leerSub(env, id);
      if (!fresca) continue;
      const estado: Sub['estado'] = {};
      for (const r of fresca.rutinas) {
        const mia = sub.rutinas.find((x) => x.id === r.id);
        if (sub.estado[r.id] && mia && cfgKey(mia) === cfgKey(r)) estado[r.id] = sub.estado[r.id];
        else if (fresca.estado[r.id]) estado[r.id] = fresca.estado[r.id];
      }
      for (const [k, v] of Object.entries(estado)) if (v.llegadaMs < now - 24 * 3600_000) delete estado[k];
      fresca.estado = estado;
      await guardarSub(env, fresca);
    }
  }
  return eventos;
}

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => manejar(req, env, ctx),
  scheduled: (_e: ScheduledController, env: Env, ctx: ExecutionContext) => { ctx.waitUntil(tick(env, Date.now(), false)); },
};

// Para evitar un aviso de import no usado si se amplía el módulo.
void hm;
