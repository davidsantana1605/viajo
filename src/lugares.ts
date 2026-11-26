// Lugares guardados: Casa, Trabajo y favoritos (localStorage 'viajo-lugares').
// Chips de acceso rápido para el planificador y el formulario de Rutinas, sugerencias en el autocompletado
// y un diálogo accesible para guardar / editar / borrar.
import './styles/lugares.css';
import { buscarLugares, type Lugar } from './geo';

export type Tipo = 'casa' | 'trabajo' | 'fav';
export interface Guardado { id: string; tipo: Tipo; nombre: string; icono: string; detalle: string; lng: number; lat: number }

const LS = 'viajo-lugares';
const EVT = 'viajo-lugares';
const ICONOS = ['⭐', '🏠', '💼', '🎓', '🛒', '🏥', '💪', '☕', '🍽️', '🌳', '🏦', '❤️'];
const DEF: Record<Exclude<Tipo, 'fav'>, { nombre: string; icono: string }> = { casa: { nombre: 'Casa', icono: '🏠' }, trabajo: { nombre: 'Trabajo', icono: '💼' } };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/* ---------------- almacenamiento ---------------- */
function leer(): Guardado[] {
  try {
    const a = JSON.parse(localStorage.getItem(LS) ?? '[]') as unknown;
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is Guardado => !!x && typeof x.nombre === 'string' && Number.isFinite(x.lng) && Number.isFinite(x.lat))
      .map((x) => ({ id: String(x.id ?? uid()), tipo: x.tipo === 'casa' || x.tipo === 'trabajo' ? x.tipo : 'fav', nombre: x.nombre, icono: x.icono || '⭐', detalle: x.detalle ?? '', lng: x.lng, lat: x.lat }));
  } catch { return []; }
}
let lista: Guardado[] = leer();
function escribir(nueva: Guardado[]) {
  lista = nueva;
  try { localStorage.setItem(LS, JSON.stringify(lista)); } catch { /* almacenamiento no disponible: queda sólo en memoria */ }
  window.dispatchEvent(new Event(EVT));
}
window.addEventListener('storage', (e) => { if (e.key === LS) { lista = leer(); window.dispatchEvent(new Event(EVT)); } });

export const listarGuardados = (): Guardado[] => [...lista];
export const aLugar = (g: Guardado): Lugar => ({ nombre: g.nombre, detalle: `${g.icono} Guardado${g.detalle ? ' · ' + g.detalle : ''}`, lng: g.lng, lat: g.lat });

/** Lugares guardados que coinciden con lo escrito (vacío = todos), para mostrarlos primero en el autocompletado. */
export function coincidencias(term: string): Lugar[] {
  const t = norm(term);
  return lista.filter((g) => !t || norm(g.nombre).includes(t) || (t.length >= 3 && norm(g.detalle).includes(t))).map(aLugar);
}
/** Pone los guardados que coinciden antes de los resultados del geocodificador (sin repetir). */
export function conGuardados(term: string, items: Lugar[]): Lugar[] {
  const mios = coincidencias(term);
  return [...mios, ...items.filter((l) => !mios.some((m) => Math.abs(m.lng - l.lng) < 0.0003 && Math.abs(m.lat - l.lat) < 0.0003))];
}

const mismoLugar = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => Math.abs(a.lng - b.lng) < 0.0004 && Math.abs(a.lat - b.lat) < 0.0004; // ~35 m

/* ---------------- chips ---------------- */
export interface OpcionesChips {
  alElegir: (l: Lugar) => void;
  /** Lugares elegidos ahora en el formulario: si no están guardados se ofrece "Guardar este lugar". */
  candidatos?: () => { nombre: string; detalle?: string; lng?: number; lat?: number }[];
}
const montados = new Set<{ host: HTMLElement; o: OpcionesChips }>();

function pintar(host: HTMLElement, o: OpcionesChips) {
  const chip = (cls: string, attrs: string, html: string, label?: string) => `<button type="button" class="lg-chip ${cls}" ${attrs}${label ? ` aria-label="${esc(label)}"` : ''}>${html}</button>`;
  const casa = lista.find((g) => g.tipo === 'casa'), trab = lista.find((g) => g.tipo === 'trabajo');
  let html = '';
  html += casa ? chip('', `data-id="${esc(casa.id)}"`, `<span aria-hidden="true">${esc(casa.icono)}</span> ${esc(casa.nombre)}`) : chip('vacio', 'data-def="casa"', '<span aria-hidden="true">🏠</span> Casa <i>＋</i>', 'Definir Casa');
  html += trab ? chip('', `data-id="${esc(trab.id)}"`, `<span aria-hidden="true">${esc(trab.icono)}</span> ${esc(trab.nombre)}`) : chip('vacio', 'data-def="trabajo"', '<span aria-hidden="true">💼</span> Trabajo <i>＋</i>', 'Definir Trabajo');
  for (const g of lista.filter((x) => x.tipo === 'fav')) html += chip('', `data-id="${esc(g.id)}"`, `<span aria-hidden="true">${esc(g.icono)}</span> ${esc(g.nombre)}`);
  const cands = (o.candidatos?.() ?? []).filter((c) => c.lng !== undefined && c.lat !== undefined && c.nombre && !lista.some((g) => mismoLugar(g, { lng: c.lng!, lat: c.lat! })));
  cands.forEach((c, i) => { html += chip('guardar', `data-cand="${i}"`, `★ Guardar “${esc(c.nombre)}”`, `Guardar este lugar: ${c.nombre}`); });
  html += chip('gestion', 'data-gestion="1"', '✎', 'Administrar lugares guardados');
  host.className = 'lg-chips'; host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Lugares guardados');
  host.innerHTML = html;
  host.onpointerdown = (e) => e.preventDefault(); // no le saca el foco al campo de texto
  host.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.lg-chip');
    if (!b) return;
    if (b.dataset.gestion) { abrirLugares(); return; }
    if (b.dataset.def) { abrirLugares({ tipo: b.dataset.def as Tipo }); return; }
    if (b.dataset.cand !== undefined) {
      const c = cands[+b.dataset.cand];
      abrirLugares({ lugar: { nombre: c.nombre, detalle: c.detalle ?? '', lng: c.lng!, lat: c.lat! } });
      return;
    }
    const g = lista.find((x) => x.id === b.dataset.id);
    if (g) o.alElegir({ nombre: g.nombre, detalle: g.detalle, lng: g.lng, lat: g.lat });
  };
}

/** Dibuja los chips dentro de `host` y los mantiene al día cuando cambian los lugares. */
export function montarChips(host: HTMLElement, o: OpcionesChips) {
  for (const m of montados) if (!m.host.isConnected || m.host === host) montados.delete(m);
  montados.add({ host, o });
  pintar(host, o);
}
export function refrescarChips() {
  for (const m of montados) { if (m.host.isConnected) pintar(m.host, m.o); else montados.delete(m); }
}
window.addEventListener(EVT, refrescarChips);

/* ---------------- diálogo ---------------- */
interface Edicion { vieneDeLista?: boolean; id?: string; tipo: Tipo; nombre: string; icono: string; lugar: Lugar | null; tocoNombre: boolean }
let dlg: HTMLDialogElement | null = null;
let origenFoco: HTMLElement | null = null;
let vista: { modo: 'lista' } | { modo: 'form'; e: Edicion } = { modo: 'lista' };
let acBusq: AbortController | null = null;

function asegurarDialogo(): HTMLDialogElement {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'lg-dlg'; dlg.setAttribute('aria-labelledby', 'lg-titulo');
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg!.close(); }); // clic en el fondo
  dlg.addEventListener('close', () => { acBusq?.abort(); const f = origenFoco; origenFoco = null; if (f?.isConnected) f.focus(); });
  document.body.append(dlg);
  return dlg;
}

/** Sin argumentos: administrar. Con `tipo`: definir Casa/Trabajo. Con `lugar`: guardar ese lugar. */
export function abrirLugares(o: { tipo?: Tipo; lugar?: Lugar } = {}) {
  const d = asegurarDialogo();
  origenFoco = document.activeElement as HTMLElement | null;
  if (o.tipo || o.lugar) {
    const tipo = o.tipo ?? 'fav';
    const def = tipo === 'fav' ? { nombre: o.lugar?.nombre ?? '', icono: '⭐' } : DEF[tipo];
    vista = { modo: 'form', e: { tipo, nombre: def.nombre, icono: def.icono, lugar: o.lugar ?? null, tocoNombre: tipo === 'fav' && !!o.lugar } };
  } else vista = { modo: 'lista' };
  dibujar();
  if (!d.open) d.showModal();
  d.querySelector<HTMLElement>('[data-foco]')?.focus();
}

function dibujar() {
  const d = dlg!;
  if (vista.modo === 'lista') {
    const casa = lista.find((g) => g.tipo === 'casa'), trab = lista.find((g) => g.tipo === 'trabajo');
    const fila = (g: Guardado) => `<li class="lg-item"><span class="lg-ico" aria-hidden="true">${esc(g.icono)}</span><span class="lg-main"><b>${esc(g.nombre)}</b><small>${esc(g.detalle || 'Lugar guardado')}</small></span>
      <button type="button" class="lg-btn" data-ed="${esc(g.id)}" aria-label="Editar ${esc(g.nombre)}">Editar</button>
      <button type="button" class="lg-btn bad" data-del="${esc(g.id)}" aria-label="Borrar ${esc(g.nombre)}">Borrar</button></li>`;
    const vacio = (t: 'casa' | 'trabajo') => `<li class="lg-item"><span class="lg-ico" aria-hidden="true">${DEF[t].icono}</span><span class="lg-main"><b>${DEF[t].nombre}</b><small>Sin definir</small></span><button type="button" class="lg-btn" data-def="${t}">Definir</button></li>`;
    d.innerHTML = `<div class="lg-wrap">
      <header><h2 id="lg-titulo">Mis lugares</h2><button type="button" class="lg-x" data-cerrar aria-label="Cerrar">✕</button></header>
      <ul class="lg-list">${casa ? fila(casa) : vacio('casa')}${trab ? fila(trab) : vacio('trabajo')}${lista.filter((g) => g.tipo === 'fav').map(fila).join('')}</ul>
      ${lista.some((g) => g.tipo === 'fav') ? '' : '<p class="lg-note">Agregá favoritos (el gimnasio, la facultad…) para elegirlos con un toque.</p>'}
      <div class="lg-foot"><button type="button" class="lg-btn pri" data-nuevo data-foco>＋ Nuevo favorito</button><button type="button" class="lg-btn" data-cerrar>Listo</button></div></div>`;
    d.querySelectorAll<HTMLElement>('[data-cerrar]').forEach((b) => (b.onclick = () => d.close()));
    d.querySelector<HTMLElement>('[data-nuevo]')!.onclick = () => { vista = { modo: 'form', e: { vieneDeLista: true, tipo: 'fav', nombre: '', icono: '⭐', lugar: null, tocoNombre: false } }; dibujar(); d.querySelector<HTMLElement>('[data-foco]')?.focus(); };
    d.querySelectorAll<HTMLElement>('[data-def]').forEach((b) => (b.onclick = () => { const t = b.dataset.def as 'casa' | 'trabajo'; vista = { modo: 'form', e: { vieneDeLista: true, tipo: t, nombre: DEF[t].nombre, icono: DEF[t].icono, lugar: null, tocoNombre: false } }; dibujar(); d.querySelector<HTMLElement>('[data-foco]')?.focus(); }));
    d.querySelectorAll<HTMLElement>('[data-ed]').forEach((b) => (b.onclick = () => {
      const g = lista.find((x) => x.id === b.dataset.ed)!;
      vista = { modo: 'form', e: { id: g.id, tipo: g.tipo, nombre: g.nombre, icono: g.icono, lugar: { nombre: g.nombre, detalle: g.detalle, lng: g.lng, lat: g.lat }, tocoNombre: true } };
      dibujar(); d.querySelector<HTMLElement>('[data-foco]')?.focus();
    }));
    d.querySelectorAll<HTMLElement>('[data-del]').forEach((b) => (b.onclick = () => {
      const g = lista.find((x) => x.id === b.dataset.del)!;
      if (confirm(`¿Borrar «${g.nombre}» de tus lugares?`)) { escribir(lista.filter((x) => x !== g)); dibujar(); d.querySelector<HTMLElement>('[data-foco]')?.focus(); }
    }));
    return;
  }
  dibujarForm(vista.e);
}

function dibujarForm(e: Edicion) {
  const d = dlg!;
  const titulo = e.id ? 'Editar lugar' : e.tipo === 'casa' ? 'Definir Casa' : e.tipo === 'trabajo' ? 'Definir Trabajo' : 'Guardar lugar';
  d.innerHTML = `<form class="lg-wrap" id="lg-form" autocomplete="off" novalidate>
    <header><h2 id="lg-titulo">${titulo}</h2><button type="button" class="lg-x" data-volver aria-label="Cancelar">✕</button></header>
    ${e.id ? '' : `<label class="lg-fld"><span>Tipo</span><select id="lg-tipo">
      <option value="fav" ${e.tipo === 'fav' ? 'selected' : ''}>Favorito</option><option value="casa" ${e.tipo === 'casa' ? 'selected' : ''}>Casa</option><option value="trabajo" ${e.tipo === 'trabajo' ? 'selected' : ''}>Trabajo</option></select></label>`}
    <label class="lg-fld"><span>Nombre</span><input id="lg-nombre" data-foco maxlength="40" required placeholder="Ej.: Gimnasio" value="${esc(e.nombre)}"></label>
    <div class="lg-fld" role="group" aria-labelledby="lg-ico-l"><span id="lg-ico-l">Ícono</span><div class="lg-icos">${ICONOS.map((i) => `<button type="button" class="lg-ic" data-ic="${i}" aria-pressed="${i === e.icono}" aria-label="Ícono ${i}">${i}</button>`).join('')}</div></div>
    <div class="lg-fld"><label for="lg-buscar"><span>Dirección o lugar</span></label>
      <input id="lg-buscar" role="combobox" aria-expanded="false" aria-controls="lg-res" placeholder="Buscá una dirección" value="${esc(e.lugar?.nombre ?? '')}">
      <div class="lg-res" id="lg-res" role="listbox"></div>
      <small class="lg-sel" id="lg-sel" aria-live="polite">${e.lugar ? `✓ ${esc(e.lugar.detalle || 'Lugar elegido')}` : 'Elegí un resultado de la lista.'}</small></div>
    <p class="lg-err" id="lg-err" role="alert" hidden></p>
    <div class="lg-foot"><button type="submit" class="lg-btn pri">Guardar</button><button type="button" class="lg-btn" data-volver>Cancelar</button></div></form>`;
  const q = <T extends HTMLElement>(s: string) => d.querySelector<T>(s)!;
  d.querySelectorAll<HTMLElement>('[data-volver]').forEach((b) => (b.onclick = () => { if (e.id || e.vieneDeLista) { vista = { modo: 'lista' }; dibujar(); d.querySelector<HTMLElement>('[data-foco]')?.focus(); } else d.close(); }));
  const nombre = q<HTMLInputElement>('#lg-nombre');
  nombre.oninput = () => { e.nombre = nombre.value; e.tocoNombre = true; };
  d.querySelectorAll<HTMLElement>('[data-ic]').forEach((b) => (b.onclick = () => { e.icono = b.dataset.ic!; d.querySelectorAll<HTMLElement>('[data-ic]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
  const tipo = d.querySelector<HTMLSelectElement>('#lg-tipo');
  if (tipo) tipo.onchange = () => {
    e.tipo = tipo.value as Tipo;
    if (e.tipo !== 'fav') { e.nombre = DEF[e.tipo].nombre; e.icono = DEF[e.tipo].icono; nombre.value = e.nombre; d.querySelectorAll<HTMLElement>('[data-ic]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.ic === e.icono))); }
  };
  // búsqueda de la dirección
  const inp = q<HTMLInputElement>('#lg-buscar'), res = q('#lg-res'), sel = q('#lg-sel');
  let t = 0;
  inp.oninput = () => {
    e.lugar = null; sel.textContent = 'Elegí un resultado de la lista.';
    clearTimeout(t);
    const term = inp.value.trim();
    if (term.length < 3) { res.innerHTML = ''; inp.setAttribute('aria-expanded', 'false'); return; }
    t = window.setTimeout(async () => {
      acBusq?.abort(); acBusq = new AbortController();
      let items: Lugar[] = [];
      try { items = await buscarLugares(term, acBusq.signal); } catch { return; }
      res.innerHTML = items.map((l, i) => `<button type="button" role="option" class="lg-op" data-i="${i}"><b>${esc(l.nombre)}</b><small>${esc(l.detalle)}</small></button>`).join('') || '<div class="lg-note">Sin resultados. Probá con calle y altura.</div>';
      inp.setAttribute('aria-expanded', String(items.length > 0));
      res.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => (b.onclick = () => {
        const l = items[+b.dataset.i!];
        e.lugar = l; inp.value = l.nombre; res.innerHTML = ''; inp.setAttribute('aria-expanded', 'false'); sel.textContent = `✓ ${l.detalle || 'Lugar elegido'}`;
        if (!e.tocoNombre && e.tipo === 'fav') { e.nombre = l.nombre; nombre.value = l.nombre; }
      }));
    }, 260);
  };
  q<HTMLFormElement>('#lg-form').onsubmit = (ev) => {
    ev.preventDefault();
    const err = q('#lg-err');
    const nom = nombre.value.trim();
    const falla = !nom ? 'Ponele un nombre.' : !e.lugar ? 'Elegí la dirección de la lista de resultados.' : '';
    if (falla) { err.textContent = falla; err.hidden = false; (!nom ? nombre : inp).focus(); return; }
    const g: Guardado = { id: e.id ?? uid(), tipo: e.tipo, nombre: nom, icono: e.icono, detalle: e.lugar!.detalle.replace(/^.{1,4} Guardado( · )?/u, ''), lng: e.lugar!.lng, lat: e.lugar!.lat };
    // Casa y Trabajo son únicos: reemplazan al anterior. Al editar se mantiene el lugar en su posición.
    const sinDup = lista.filter((x) => x.id === g.id || !(g.tipo !== 'fav' && x.tipo === g.tipo));
    escribir(e.id ? sinDup.map((x) => (x.id === g.id ? g : x)) : [...sinDup, g]);
    if (e.id || e.vieneDeLista) { vista = { modo: 'lista' }; dibujar(); d.querySelector<HTMLElement>('[data-foco]')?.focus(); } else d.close();
  };
}
