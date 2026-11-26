// "Cerca de vos" + paradas favoritas.
// - Carga diferida de public/data/paradas.json (formato columnar, ver scripts/build-paradas.mjs).
// - Tarjeta con las paradas más cercanas (geolocalización sólo por acción del usuario o si el permiso ya estaba concedido).
// - Favoritas (localStorage 'viajo-favoritos') con arribos rápidos que se refrescan cada 30 s sólo mientras son visibles.
// - Vista de detalle de una parada (todas las líneas que pasan) con "Ir a esta parada" / "Salir desde acá".
import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap } from 'maplibre-gl';
import { arribos, type Arribo, type ArriboLinea, type Parada } from './api';
import './styles/cerca.css';

/* ------------------------------------------------------------------ tipos */
export interface PuntoPlan { texto: string; lng: number; lat: number }
export interface CercaCtx {
  content: HTMLElement;
  map: MLMap;
  esc: (s: string) => string;
  badge: (l: { codigo: string }, big?: boolean, small?: boolean) => string;
  /** Pide la ubicación al navegador (dibuja el punto azul) y resuelve [lng, lat]. */
  locate: () => Promise<[number, number]>;
  openLinea: (file: string, stopId?: string) => void;
  /** Arma el viaje en el planificador. null = "mi ubicación" (se pide al usuario). */
  planear: (origen: PuntoPlan | null, destino: PuntoPlan | null) => void;
  /** En móvil, si la hoja está a pantalla completa, la baja para que se vea el mapa. */
  verMapa: () => void;
  /** Vuelve a pintar el estado vacío de "Planificar viaje". */
  redibujar: () => void;
}
interface Fav { id: string; nombre: string; desc: string; lng: number; lat: number }
interface LineaRef { file: string; codigo: string; nombre: string }
interface PP extends Fav { lineas: LineaRef[] }
interface Pos { ll: [number, number]; t: number; fuente: 'gps' | 'guardada' }
interface ArrEntry { t: number; data?: ArriboLinea[]; err?: boolean; cargando?: boolean }

const BASE = import.meta.env.BASE_URL;
const LS_FAV = 'viajo-favoritos';
const LS_POS = 'viajo-ultima-pos';
const N_CERCA = 5;
const MAX_FAV_ARR = 8;
const FRESCO = 25_000;

/* ------------------------------------------------------------------ utilidades */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const rad = (d: number) => (d * Math.PI) / 180;
function metros(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const fmtDist = (m: number) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
/** Caminando a ~4,8 km/h con un 30 % extra por no ir en línea recta. */
const minCaminando = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));
const hace = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'hace instantes' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : 'hace más de un día';
};

const STAR = '<svg viewBox="0 0 24 24" width="20" height="20" stroke-linejoin="round" stroke-linecap="round" stroke-width="1.8" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
const WALK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="13.5" cy="4.5" r="2"/><path d="M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7 7 0 0 0 18 13v-2c-1.6 0-2.9-.8-3.7-2l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/></svg>';
const REFRESH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
const BACK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

/* ------------------------------------------------------------------ paradas (carga diferida) */
let todas: PP[] = [];
const porId = new Map<string, PP>();
let cargaParadas: Promise<boolean> | null = null;

function asegurarParadas(): Promise<boolean> {
  if (todas.length) return Promise.resolve(true);
  cargaParadas ??= fetch(`${BASE}data/paradas.json`)
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((d: { lineas: LineaRef[]; p: [string, string, string, number, number, number[]][] }) => {
      todas = d.p.map(([id, nombre, desc, lng, lat, ls]) => ({ id, nombre, desc, lng, lat, lineas: ls.map((i) => d.lineas[i]) }));
      todas.forEach((p) => porId.set(p.id, p));
      return true;
    })
    .catch(() => { cargaParadas = null; return false; });
  return cargaParadas;
}

/* ------------------------------------------------------------------ estado */
let ctx: CercaCtx;
let raiz: HTMLElement | null = null;
let detalle: Fav | null = null;
let pos: Pos | null = null;
let geo: 'idle' | 'pidiendo' | 'denegado' | 'error' = 'idle';
let paradasError = false;
let cercanas: { p: PP; d: number }[] = [];
let timer = 0;
let pinMarker: maplibregl.Marker | null = null;
const cache = new Map<string, ArrEntry>();
const registro = new Map<string, Fav>();

try {
  const g = JSON.parse(localStorage.getItem(LS_POS) ?? 'null');
  if (g && Number.isFinite(g.lng) && Number.isFinite(g.lat) && Number.isFinite(g.t)) pos = { ll: [g.lng, g.lat], t: g.t, fuente: 'guardada' };
} catch { /* sin ubicación guardada */ }

function leerFavs(): Fav[] {
  try {
    const a = JSON.parse(localStorage.getItem(LS_FAV) ?? '[]');
    return Array.isArray(a)
      ? a.filter((f) => f && typeof f.id === 'string' && Number.isFinite(f.lng) && Number.isFinite(f.lat))
        .map((f) => ({ id: f.id, nombre: String(f.nombre ?? ''), desc: String(f.desc ?? ''), lng: f.lng, lat: f.lat }))
      : [];
  } catch { return []; }
}
let favs: Fav[] = leerFavs();
const esFav = (id: string) => favs.some((f) => f.id === id);
function guardarFavs() { try { localStorage.setItem(LS_FAV, JSON.stringify(favs)); } catch { /* almacenamiento no disponible */ } }

function toggleFav(id: string) {
  const info = registro.get(id) ?? porId.get(id);
  if (!info) return;
  if (esFav(id)) favs = favs.filter((f) => f.id !== id);
  else favs = [...favs, { id: info.id, nombre: info.nombre, desc: info.desc, lng: info.lng, lat: info.lat }];
  guardarFavs();
  document.querySelectorAll<HTMLElement>(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => b.setAttribute('aria-pressed', String(esFav(id))));
  if (raiz?.isConnected) { pintar(); refrescar(); }
}

/* ------------------------------------------------------------------ estrella (también para la vista de línea) */
function estrella(p: Fav): string {
  registro.set(p.id, { id: p.id, nombre: p.nombre, desc: p.desc, lng: p.lng, lat: p.lat });
  return `<button class="fav-star" data-fav="${esc(p.id)}" aria-pressed="${esFav(p.id)}" aria-label="Parada favorita: ${esc(p.nombre)}" title="Guardar en favoritas">${STAR}</button>`;
}

document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-fav]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  toggleFav(b.dataset.fav!);
}, true);

/** Agrega la estrella a la tarjeta de la parada y a cada fila de la lista de paradas de una línea. */
export function decorarParadas(content: HTMLElement, stops: Parada[], sel: Parada | null) {
  if (sel) content.querySelector('.card .top #close-stop')?.before(htmlEl(estrella(sel)));
  const byId = new Map(stops.map((s) => [s.id, s]));
  content.querySelectorAll<HTMLElement>('button.stop[data-s]').forEach((b) => {
    const p = byId.get(b.dataset.s!);
    if (!p || b.parentElement?.classList.contains('stop-wrap')) return;
    const w = document.createElement('div');
    w.className = 'stop-wrap';
    b.replaceWith(w);
    w.append(b, htmlEl(estrella(p)));
  });
}
const htmlEl = (h: string) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild as HTMLElement; };

/* ------------------------------------------------------------------ ubicación */
async function permiso(): Promise<PermissionState | 'unknown'> {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'unknown'; }
}

function recalcular() {
  if (!pos || !todas.length) { cercanas = []; return; }
  const ll = pos.ll, lat0 = Math.cos(rad(ll[1]));
  // Prefiltro barato (equirectangular) y haversine sólo para las candidatas.
  const sc = todas.map((p) => ({ p, k: (p.lng - ll[0]) ** 2 * lat0 * lat0 + (p.lat - ll[1]) ** 2 }));
  sc.sort((a, b) => a.k - b.k);
  cercanas = sc.slice(0, N_CERCA * 3).map(({ p }) => ({ p, d: metros(ll, [p.lng, p.lat]) })).sort((a, b) => a.d - b.d).slice(0, N_CERCA);
}

async function pedirUbicacion() {
  if (geo === 'pidiendo') return;
  geo = 'pidiendo'; pintar();
  try {
    const ll = await ctx.locate();
    pos = { ll, t: Date.now(), fuente: 'gps' };
    try { localStorage.setItem(LS_POS, JSON.stringify({ lng: ll[0], lat: ll[1], t: pos.t })); } catch { /* opcional */ }
    geo = 'idle';
  } catch (e) {
    geo = (e as { code?: number }).code === 1 ? 'denegado' : 'error';
  }
  recalcular(); pintar(); refrescar();
}

/* ------------------------------------------------------------------ arribos */
async function cargarArribos(id: string, forzar = false) {
  const c = cache.get(id);
  if (c?.cargando || (!forzar && c?.data && Date.now() - c.t < FRESCO)) return;
  const e: ArrEntry = { t: c?.t ?? 0, data: c?.data, cargando: true };
  cache.set(id, e);
  try { e.data = await arribos(id); e.err = false; e.t = Date.now(); } catch { e.err = true; }
  e.cargando = false;
  pintar();
}

async function lote(ids: string[]) {
  const q = ids.filter((id) => { const c = cache.get(id); return !c?.cargando && !(c?.data && Date.now() - c.t < FRESCO); });
  const worker = async () => { for (let id = q.shift(); id; id = q.shift()) await cargarArribos(id, true); };
  await Promise.all([worker(), worker()]);
}

/** Pide lo que se ve ahora: detalle de una parada, o la más cercana + favoritas. */
function refrescar() {
  if (!raiz?.isConnected || document.hidden) return;
  if (detalle) { cargarArribos(detalle.id); return; }
  const ids = [...(cercanas[0] ? [cercanas[0].p.id] : []), ...favs.slice(0, MAX_FAV_ARR).map((f) => f.id)];
  lote([...new Set(ids)]);
}

function arrancarTimer() {
  clearInterval(timer);
  timer = window.setInterval(() => {
    if (!raiz?.isConnected) { clearInterval(timer); return; }
    refrescar();
  }, 30000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });

/* ------------------------------------------------------------------ formato de arribos */
const esVivo = (a: Arribo) => a.tipo.toLowerCase() !== 'programado';
function pill(a: Arribo): string {
  const t = a.arriboEnMinutos <= 0 ? 'Ahora' : a.arriboEnMinutos < 60 ? `${a.arriboEnMinutos} min` : a.horaArribo;
  return esVivo(a)
    ? `<span class="pill live"><span class="sr">en vivo, </span>${esc(t)}</span>`
    : `<span class="pill prog" title="Horario programado"><span class="sr">programado, </span>${esc(t)}</span>`;
}
function frecuencia(list: Arribo[]): number | null {
  const d: number[] = [];
  for (let i = 1; i < list.length; i++) { const g = list[i].arriboEnMinutos - list[i - 1].arriboEnMinutos; if (g > 0) d.push(g); }
  return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
}
const primero = (x: ArriboLinea) => (x.arribos.length ? x.arribos[0].arriboEnMinutos : 1e9);
const porProximo = (d: ArriboLinea[]) => [...d].sort((a, b) => primero(a) - primero(b));
const codigoDe = (x: ArriboLinea) => x.linea.codigoEMR || x.linea.nombreCorto;
const fileDe = (x: ArriboLinea) => `${x.linea.idEmpresa}-${x.linea.id}`;
const leyenda = `<div class="note"><span class="pill live" style="font-size:11px;padding:1px 6px">en vivo</span> corregido por GPS · <span class="pill prog" style="font-size:11px;padding:1px 6px">hora</span> programado</div>`;

function filasArribos(data: ArriboLinea[], max: number, enlaces: boolean, stopId: string): string {
  const orden = porProximo(data);
  return orden.slice(0, max).map((x) => {
    const bd = ctx.badge({ codigo: codigoDe(x) });
    const f = frecuencia(x.arribos);
    const times = x.arribos.slice(0, 3).map(pill).join('') || '<span class="pill prog">—</span>';
    const b = enlaces ? `<button class="badge-btn" data-act="linea" data-f="${esc(fileDe(x))}" data-s="${esc(stopId)}" aria-label="Ver recorrido de ${esc(x.linea.nombre)}" style="display:contents">${bd}</button>` : bd;
    return `<div class="arr">${b}<span class="nm"><span style="font-size:13px;font-weight:550">${esc(x.linea.nombre)}</span>${f ? `<small class="fq">cada ~${f} min</small>` : ''}</span><span class="times">${times}</span></div>`;
  }).join('');
}

function badgesDe(p: PP, max = 7): string {
  const vistos = new Set<string>(), out: string[] = [];
  for (const l of p.lineas) { if (!vistos.has(l.codigo)) { vistos.add(l.codigo); out.push(l.codigo); } }
  const extra = out.length - max;
  return out.slice(0, max).map((c) => ctx.badge({ codigo: c }, false, true)).join('') + (extra > 0 ? `<span class="mas">+${extra}</span>` : '');
}

/* ------------------------------------------------------------------ HTML de la tarjeta "Cerca de vos" */
function htmlCerca(): string {
  let h = `<section class="cerca" aria-label="Cerca de vos"><div class="cerca-h"><h2>Cerca de vos</h2>${pos ? `<button class="iconbtn" data-act="ubicar" aria-label="Actualizar mi ubicación" title="Actualizar ubicación">${REFRESH}</button>` : ''}</div>`;
  if (paradasError) {
    h += `<div class="cerca-msg">No pude cargar las paradas. <button class="cerca-btn" data-act="reintentar">Reintentar</button></div>`;
  } else if (geo === 'pidiendo' && !cercanas.length) {
    h += `<div class="cerca-msg"><div class="spin"></div>Buscando tu ubicación…</div>`;
  } else if (!pos) {
    const motivo = geo === 'denegado' ? 'El navegador bloqueó el acceso a tu ubicación. Habilitalo en los permisos del sitio para ver las paradas cercanas.'
      : geo === 'error' ? 'No pude obtener tu ubicación. Revisá que el GPS esté activo e intentá de nuevo.'
      : 'Mirá qué paradas tenés a pasos y cuándo llega el próximo colectivo.';
    h += `<div class="cerca-msg">${motivo}<button class="cerca-btn primary" data-act="ubicar">Ver paradas cerca de mí</button></div>`;
  } else if (!cercanas.length) {
    h += `<div class="cerca-msg"><div class="spin"></div>Buscando paradas…</div>`;
  } else {
    if (pos.fuente === 'guardada' || geo !== 'idle') {
      const aviso = geo === 'pidiendo' ? 'Actualizando tu ubicación…'
        : geo === 'denegado' ? 'No tengo permiso de ubicación; muestro tu última ubicación conocida.'
        : geo === 'error' ? 'No pude actualizar tu ubicación; muestro la última conocida.'
        : `Según tu última ubicación conocida (${hace(pos.t)}).`;
      h += `<div class="note pad">${aviso}${geo === 'idle' ? ' <button class="linkbtn" data-act="ubicar">Actualizar</button>' : ''}</div>`;
    }
    if (cercanas[0].d > 2000) h += `<div class="note pad">La parada más cercana está a ${fmtDist(cercanas[0].d)}: puede que estés fuera de la zona de cobertura.</div>`;
    h += cercanas.map(({ p, d }, i) => `<div class="cerca-row${i === 0 ? ' first' : ''}">
      <button class="cerca-main" data-act="parada" data-id="${esc(p.id)}">
        <span class="cerca-dist"><b>${fmtDist(d)}</b><small>${WALK} ${minCaminando(d)} min</small></span>
        <span class="cerca-txt"><span class="n">${esc(p.nombre)}</span>${p.desc ? `<span class="d">${esc(p.desc)}</span>` : ''}<span class="bs">${badgesDe(p)}</span></span>
      </button>${estrella(p)}</div>${i === 0 ? bloqueArribos(p.id) : ''}`).join('');
  }
  h += '</section>';
  h += htmlFavs();
  return h;
}

function bloqueArribos(id: string): string {
  const c = cache.get(id);
  let b: string;
  if (!c || (!c.data && !c.err)) b = `<div class="note">Consultando próximos arribos…</div>`;
  else if (!c.data) b = `<div class="note">No pude consultar los arribos ahora. Reintento en unos segundos.</div>`;
  else if (!c.data.length) b = `<div class="note">No hay arribos informados para esta parada.</div>`;
  else b = filasArribos(c.data, 4, false, id) + (c.data.length > 4 ? `<button class="linkbtn" data-act="parada" data-id="${esc(id)}">Ver las ${c.data.length} líneas</button>` : '') + leyenda;
  return `<div class="cerca-arr"><div class="cerca-arr-h">Próximos arribos · parada más cercana${c?.err && c.data ? ' <span class="stale">(desactualizado)</span>' : ''}</div>${b}</div>`;
}

function htmlFavs(): string {
  let h = `<section class="cerca favs" aria-label="Favoritas"><div class="cerca-h"><h2>Favoritas</h2></div>`;
  if (!favs.length) {
    h += `<div class="cerca-msg small">Tocá la estrella en una parada para guardarla acá y ver cuándo llega el próximo colectivo.</div>`;
  } else {
    h += favs.map((f, i) => {
      const c = cache.get(f.id);
      let arr: string;
      if (i >= MAX_FAV_ARR) arr = '';
      else if (!c || (!c.data && !c.err)) arr = '<span class="fav-note">Consultando…</span>';
      else if (!c.data) arr = '<span class="fav-note">Sin datos ahora</span>';
      else if (!c.data.length) arr = '<span class="fav-note">Sin arribos informados</span>';
      else arr = porProximo(c.data).filter((x) => x.arribos.length).slice(0, 3).map((x) => `<span class="fav-arr">${ctx.badge({ codigo: codigoDe(x) }, false, true)}${pill(x.arribos[0])}</span>`).join('') || '<span class="fav-note">Sin arribos informados</span>';
      const dist = pos ? ` · ${fmtDist(metros(pos.ll, [f.lng, f.lat]))}` : '';
      return `<div class="cerca-row"><button class="cerca-main" data-act="parada" data-id="${esc(f.id)}"><span class="cerca-txt"><span class="n">${esc(f.nombre)}</span><span class="d">${esc((f.desc || 'Parada') + dist)}</span><span class="fav-arrs">${arr}</span></span></button>${estrella(f)}</div>`;
    }).join('');
    if (favs.length > MAX_FAV_ARR) h += `<div class="note pad">Muestro arribos de las primeras ${MAX_FAV_ARR}; tocá una parada para ver las demás.</div>`;
  }
  return h + '</section>';
}

/* ------------------------------------------------------------------ HTML del detalle de una parada */
function htmlDetalle(): string {
  const p = detalle!;
  const c = cache.get(p.id);
  const pp = porId.get(p.id);
  const d = pos ? metros(pos.ll, [p.lng, p.lat]) : null;
  const sub = [p.desc || 'Parada', d !== null ? `a ${fmtDist(d)} · ${minCaminando(d)} min caminando` : ''].filter(Boolean).join(' · ');
  let body: string;
  if (!c || (!c.data && !c.err)) body = `<div class="note">Consultando arribos…</div>`;
  else if (!c.data) body = `<div class="note">No se pudieron cargar los arribos. Reintentando…</div>`;
  else if (!c.data.length) body = `<div class="note">No hay arribos informados para esta parada.</div>`;
  else body = filasArribos(c.data, 99, true, p.id) + leyenda + `<div class="note">Tocá una línea para ver su recorrido y paradas.</div>`;
  const lineas = pp && (!c?.data || c.err) ? `<div class="cerca-lineas">${badgesDe(pp, 20)}</div>` : '';
  return `<div class="cerca-nav"><button class="iconbtn" data-act="volver" aria-label="Volver a Cerca de vos">${BACK}</button><span>Parada</span></div>
  <div class="card"><div class="top"><div><h3>${esc(p.nombre)}</h3><div class="sub">${esc(sub)}</div></div>${estrella(p)}</div>
    <div class="cerca-acts"><button class="cerca-btn primary" data-act="ir">Ir a esta parada</button><button class="cerca-btn" data-act="salir">Salir desde acá</button></div>
    ${lineas}${body}</div>`;
}

/* ------------------------------------------------------------------ pintado */
let reintentoPintar = 0;
function pintar() {
  if (!raiz?.isConnected) return;
  // No reemplazar el DOM mientras el usuario está apretando algo (se perdería el click).
  if (raiz.querySelector(':active')) { clearTimeout(reintentoPintar); reintentoPintar = window.setTimeout(pintar, 400); return; }
  const st = ctx.content.scrollTop;
  raiz.innerHTML = detalle ? htmlDetalle() : htmlCerca();
  ctx.content.scrollTop = st;
}

function alClick(e: MouseEvent) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'ubicar') pedirUbicacion();
  else if (act === 'reintentar') { paradasError = false; pintar(); iniciarParadas(); }
  else if (act === 'parada') abrirDetalle(el.dataset.id!);
  else if (act === 'volver') cerrarDetalle();
  else if (act === 'linea') ctx.openLinea(el.dataset.f!, el.dataset.s);
  else if (act === 'ir' && detalle) { const d = punto(detalle); salirDetalle(); ctx.planear(null, d); }
  else if (act === 'salir' && detalle) { const d = punto(detalle); salirDetalle(); ctx.planear(d, null); }
}
const punto = (p: Fav): PuntoPlan => ({ texto: p.nombre, lng: p.lng, lat: p.lat });

/* ------------------------------------------------------------------ detalle y mapa */
function abrirDetalle(id: string) {
  const p = porId.get(id) ?? favs.find((f) => f.id === id) ?? cercanas.find((c) => c.p.id === id)?.p;
  if (!p) return;
  detalle = { id: p.id, nombre: p.nombre, desc: p.desc, lng: p.lng, lat: p.lat };
  pinMarker?.remove();
  const el = document.createElement('div'); el.className = 'cerca-pin';
  pinMarker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(ctx.map);
  ctx.verMapa();
  ctx.map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(ctx.map.getZoom(), 16), duration: 900 });
  ctx.redibujar();
  ctx.content.scrollTop = 0;
  cargarArribos(p.id, true);
}
function cerrarDetalle() { salirDetalle(); ctx.redibujar(); }
function salirDetalle() { detalle = null; pinMarker?.remove(); pinMarker = null; }

/* ------------------------------------------------------------------ API para main.ts */
/** Oculta todo lo de "Cerca de vos" (marcador, timers) cuando la pestaña deja de estar visible. */
export function cercaOcultar() {
  salirDetalle();
  clearInterval(timer);
  raiz = null;
}

/** Si hay una parada abierta, pinta su detalle en lugar del estado vacío y devuelve true. */
export function cercaDetalle(c: CercaCtx): boolean {
  if (!detalle) return false;
  ctx = c;
  c.content.innerHTML = '<div class="cerca-det"></div>';
  raiz = c.content.firstElementChild as HTMLElement;
  raiz.onclick = alClick;
  pintar(); arrancarTimer(); refrescar();
  return true;
}

function iniciarParadas() {
  asegurarParadas().then((ok) => {
    paradasError = !ok;
    recalcular(); pintar(); refrescar();
  });
}

/** Inserta "Cerca de vos" y "Favoritas" al principio del contenido (estado vacío de Planificar viaje). */
export function montarCerca(c: CercaCtx) {
  ctx = c;
  const r = document.createElement('div');
  r.className = 'cerca-root';
  r.onclick = alClick;
  c.content.prepend(r);
  raiz = r;
  recalcular(); pintar();
  iniciarParadas();
  arrancarTimer();
  // Sólo se pide el GPS solo si el permiso ya estaba concedido; si no, el usuario toca el botón.
  if (!pos || pos.fuente !== 'gps' || Date.now() - pos.t > 90_000) {
    permiso().then((s) => { if (s === 'granted' && raiz === r && r.isConnected) pedirUbicacion(); });
  }
  refrescar();
}
