/**
 * Compartir y enlaces profundos (sin servidor): router de hash, botones Compartir / QR, toast y "Mis viajes recientes".
 * main.ts sólo le pasa ganchos (initShare) y llama a syncLinea/syncViaje/syncTab/leaveLinea cuando cambia la vista.
 */
import './styles/share.css';
import { parseHash, toHash, mismoPunto, inBox, limpiarNombre, textoViaje, textoEta, textoLinea, textoParada, type Link, type Pt } from './links';
import { qrMatrix, qrToCanvas } from './qr';
import { arribos } from './api';
import type { Ruta } from './trip';

interface Pto { texto: string; lng?: number; lat?: number }
export interface ShareHooks {
  linea(): { file: string; codigo: string; nombre: string } | null;
  parada(): { id: string; nombre: string } | null;
  origen(): Pto;
  destino(): Pto;
  ruta(): Ruta | null;
  viaje(): { llegadaMs: number; fin: boolean } | null;
  hhmm(ms: number): string;
  openLinea(file: string, stopId?: string): void;
  closeLinea(): void;
  abrirViaje(o: Pt, d: Pt): void;
  setTab(t: 'rutinas'): void;
  hayLinea(file: string): boolean;
  fileDe(id: string, empresa: string): string | undefined;
}

let H: ShareHooks;
let routing = false;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const base = () => location.href.split('#')[0];
const canon = (h: string) => { const l = parseHash(h); return (l && toHash(l)) || (h === '#' ? '' : h); };

/* ------------------------------------------------------------------ historial */
function setHash(h: string, mode: 'push' | 'replace') {
  if (canon(location.hash) === h) return;
  const url = location.pathname + location.search + h;
  try {
    if (mode === 'push') history.pushState({ viajo: 1 }, '', url);
    else history.replaceState(history.state, '', url);
  } catch { /* file:// o sandbox */ }
}

/** Abrir una línea (o parada de una línea) empuja una entrada, para que "Atrás" cierre la línea. */
export function syncLinea(file: string, parada?: string) {
  const cur = parseHash(location.hash);
  setHash(toHash({ k: 'linea', file, parada }), cur?.k === 'linea' || cur?.k === 'parada' ? 'replace' : 'push');
}

const hashViaje = (): string => {
  const o = H.origen(), d = H.destino();
  return o.lng !== undefined && o.lat !== undefined && d.lng !== undefined && d.lat !== undefined
    ? toHash({ k: 'viaje', o: { lng: o.lng, lat: o.lat, nombre: o.texto }, d: { lng: d.lng, lat: d.lat, nombre: d.texto } }) : '';
};

/** Cerrar la línea desde la app: si la entrada la empujamos nosotros, volvemos atrás; si no, reemplazamos. */
export function leaveLinea() {
  if (routing) return;
  if (history.state?.viajo) history.back();
  else setHash(hashViaje(), 'replace');
}

/** El planificador tiene (o dejó de tener) origen y destino válidos. */
export function syncViaje() {
  const h = hashViaje();
  if (h) { setHash(h, 'replace'); return; }
  if (parseHash(location.hash)?.k === 'viaje') setHash('', 'replace');
}

export function syncTab(tab: string) {
  if (tab === 'rutinas') setHash('#rutinas', 'replace');
  else if (parseHash(location.hash)?.k === 'rutinas') setHash(hashViaje(), 'replace');
}

async function route(l: Link | null) {
  routing = true;
  try {
    if (!l) { if (H.linea()) H.closeLinea(); return; }
    if (l.k === 'rutinas') { if (H.linea()) H.closeLinea(); H.setTab('rutinas'); return; }
    if (l.k === 'viaje') {
      if (H.viaje()) { toast('Terminá tu viaje en curso para abrir otro enlace.'); return; }
      if (H.linea()) H.closeLinea();
      const a = H.origen(), b = H.destino();
      const igual = a.lng !== undefined && a.lat !== undefined && b.lng !== undefined && b.lat !== undefined && mismoPunto({ lng: a.lng, lat: a.lat }, l.o) && mismoPunto({ lng: b.lng, lat: b.lat }, l.d);
      if (!igual) H.abrirViaje(l.o, l.d);
      return;
    }
    if (l.k === 'linea') {
      if (!H.hayLinea(l.file)) { toast('No encontré esa línea.'); return; }
      const cur = H.linea();
      if (cur?.file === l.file && (H.parada()?.id ?? undefined) === l.parada) return;
      H.openLinea(l.file, l.parada);
      return;
    }
    // #parada=<id>: sin línea en el enlace, se busca qué líneas paran ahí
    try {
      const lista = await arribos(l.id);
      const file = lista.map((x) => H.fileDe(x.linea.id, x.linea.idEmpresa)).find(Boolean);
      if (file) H.openLinea(file, l.id); else toast('No encontré esa parada.');
    } catch { toast('No pude consultar esa parada. Probá de nuevo en un rato.'); }
  } finally { routing = false; }
}

export const aplicarHash = () => route(parseHash(location.hash));

export function initShare(hooks: ShareHooks) {
  H = hooks;
  addEventListener('hashchange', () => { void aplicarHash(); });
  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-share],[data-qr]');
    if (!b) return;
    e.preventDefault();
    const d = datos((b.dataset.share ?? b.dataset.qr) as Kind);
    if (!d) { toast('Todavía no hay nada para compartir.'); return; }
    if (b.dataset.qr) mostrarQR(d.url, d.titulo); else void compartir(d);
  });
}

/* ------------------------------------------------------------------ compartir */
type Kind = 'viaje' | 'eta' | 'linea' | 'parada';
interface Datos { url: string; text: string; titulo: string }

function datos(k: Kind): Datos | null {
  const o = H.origen(), d = H.destino();
  const urlViaje = (): string | null => {
    const h = hashViaje();
    return h ? base() + h : null;
  };
  if (k === 'viaje' || k === 'eta') {
    const r = H.ruta(), url = urlViaje();
    if (!r || !url) return null;
    const v = H.viaje();
    if (k === 'eta') {
      if (!v || v.fin) return null;
      return { url, text: textoEta(d.texto, H.hhmm(v.llegadaMs)), titulo: 'Mi llegada' };
    }
    const lineas = r.tramos.filter((t) => t.modo === 'bus' && t.linea).map((t) => t.linea!.codigo);
    return { url, text: textoViaje({ nombre: o.texto }, { nombre: d.texto }, { lineas, salgo: r.inicio, llego: r.fin }), titulo: 'Viaje' };
  }
  const l = H.linea();
  if (!l) return null;
  if (k === 'linea') return { url: base() + toHash({ k: 'linea', file: l.file }), text: textoLinea(l.nombre), titulo: `Línea ${l.codigo}` };
  const p = H.parada();
  if (!p) return null;
  return { url: base() + toHash({ k: 'linea', file: l.file, parada: p.id }), text: textoParada(p.nombre, l.codigo), titulo: 'Parada' };
}

async function compartir(d: Datos) {
  if (navigator.share) {
    try { await navigator.share({ title: 'Viajo', text: d.text, url: d.url }); return; }
    catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  if (await copiar(`${d.text}\n${d.url}`)) toast('Enlace copiado', { label: 'Ver QR', fn: () => mostrarQR(d.url, d.titulo) });
  else mostrarQR(d.url, d.titulo);
}

async function copiar(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* sigue */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

const SVG_SHARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
const SVG_QR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4"/></svg>';

/** Botones Compartir + QR. compact = sólo íconos (cabeceras); si no, fila de botones. */
export function shareBtns(kind: Kind, compact = false): string {
  const txt = kind === 'eta' ? 'Compartir llegada' : 'Compartir';
  if (compact) return `<span class="shr-ico"><button class="iconbtn" data-share="${kind}" aria-label="${txt}" title="${txt}">${SVG_SHARE}</button><button class="iconbtn" data-qr="${kind}" aria-label="Código QR" title="Código QR">${SVG_QR}</button></span>`;
  return `<div class="shr-row"><button class="btn ghost" data-share="${kind}">${SVG_SHARE} ${txt}</button><button class="btn ghost" data-qr="${kind}" aria-label="Código QR" title="Código QR">${SVG_QR} QR</button></div>`;
}

/* ------------------------------------------------------------------ toast */
let toastEl: HTMLElement | null = null, toastTimer = 0;
export function toast(msg: string, accion?: { label: string; fn: () => void }) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'shr-toast glass';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.append(toastEl);
  }
  toastEl.textContent = '';
  const s = document.createElement('span');
  s.textContent = msg;
  toastEl.append(s);
  if (accion) {
    const b = document.createElement('button');
    b.textContent = accion.label;
    b.onclick = () => { toastEl!.classList.remove('on'); accion.fn(); };
    toastEl.append(b);
  }
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('on'), accion ? 6000 : 3500);
}

/* ------------------------------------------------------------------ QR */
let dlg: HTMLDialogElement | null = null;
function mostrarQR(url: string, titulo: string) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'shr-dlg';
    dlg.setAttribute('aria-labelledby', 'shr-t');
    dlg.innerHTML = `<h2 id="shr-t"></h2><p class="shr-sub">Escanealo con la cámara del celular para abrirlo en Viajo.</p>
      <div class="shr-qr"><canvas role="img" aria-label="Código QR del enlace"></canvas></div>
      <p class="shr-url" id="shr-url"></p>
      <div class="shr-act"><button type="button" class="btn" id="shr-dl">Descargar PNG</button><button type="button" class="btn ghost" id="shr-x">Cerrar</button></div>`;
    document.body.append(dlg);
    dlg.querySelector<HTMLElement>('#shr-x')!.onclick = () => dlg!.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg!.close(); }); // clic en el fondo
  }
  const m = qrMatrix(url);
  const cv = dlg.querySelector('canvas')!;
  dlg.querySelector('#shr-t')!.textContent = `QR · ${titulo}`;
  dlg.querySelector('#shr-url')!.textContent = url;
  const dl = dlg.querySelector<HTMLButtonElement>('#shr-dl')!;
  dl.disabled = !m;
  cv.style.display = m ? '' : 'none';
  if (m) {
    qrToCanvas(m, cv, 8);
    dl.onclick = () => cv.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'viajo-qr.png';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  } else dlg.querySelector('#shr-url')!.textContent = 'El enlace es demasiado largo para un QR: ' + url;
  if (!dlg.open) dlg.showModal();
}

/* ------------------------------------------------------------------ viajes recientes */
const KEY = 'viajo-recientes';
interface Reciente { o: { texto: string; lng: number; lat: number }; d: { texto: string; lng: number; lat: number }; t: number }

function leer(): Reciente[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Reciente[];
    if (!Array.isArray(a)) return [];
    return a.filter((r) => r && r.o && r.d && inBox(r.o.lng, r.o.lat) && inBox(r.d.lng, r.d.lat) && typeof r.o.texto === 'string' && typeof r.d.texto === 'string').slice(0, 8);
  } catch { return []; }
}

export function guardarReciente(o: Pto, d: Pto) {
  if (o.lng === undefined || o.lat === undefined || d.lng === undefined || d.lat === undefined) return;
  const a = { texto: limpiarNombre(o.texto, 'Origen'), lng: o.lng, lat: o.lat }, b = { texto: limpiarNombre(d.texto, 'Destino'), lng: d.lng, lat: d.lat };
  const lista = leer().filter((r) => !(mismoPunto(r.o, a) && mismoPunto(r.d, b)));
  lista.unshift({ o: a, d: b, t: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(lista.slice(0, 8))); } catch { /* sin almacenamiento */ }
}

/** Sección "Mis viajes recientes" para el estado vacío del planificador ('' si no hay). */
export function recientesHTML(): string {
  const l = leer();
  if (!l.length) return '';
  return `<section class="rec" aria-label="Mis viajes recientes"><div class="rec-h"><span>Mis viajes recientes</span><button data-rec-clear>Borrar</button></div>${
    l.map((r, i) => `<button class="rec-it" data-rec="${i}"><span class="rec-ic" aria-hidden="true">↻</span><span class="rec-t"><b>${esc(r.d.texto)}</b><small>desde ${esc(r.o.texto)}</small></span></button>`).join('')}</section>`;
}

export function bindRecientes(root: HTMLElement) {
  const l = leer();
  root.querySelectorAll<HTMLElement>('[data-rec]').forEach((b) => (b.onclick = () => {
    const r = l[+b.dataset.rec!];
    if (r) H.abrirViaje({ ...r.o, nombre: r.o.texto }, { ...r.d, nombre: r.d.texto });
  }));
  root.querySelector<HTMLElement>('[data-rec-clear]')?.addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch { /* nada */ }
    root.querySelector('.rec')?.remove();
  });
}
