import * as maplibregl from 'maplibre-gl';
import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { buildStyle, type Theme } from './mapStyle';
import { lineColor, VARIANTE } from './colors';
import {
  loadIndex, loadLinea, arribos, esEnVivo,
  type Linea, type LineaIdx, type Parada, type ArriboLinea, type Arribo,
} from './api';

/* ------------------------------------------------------------------ utilidades */
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isMobile = () => matchMedia('(max-width: 760px)').matches;

const ICON = {
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  chev: '<svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5.5-5 5.5"/></svg>',
  back: '<svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5 2 7.5l5.5 6"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m2 2 8 8M10 2l-8 8"/></svg>',
  bus: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10a1.5 1.5 0 0 1-1.5 1.5H18V20a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1.5H9V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.5h-.5A.5.5 0 0 1 5 18zM7 7v4.5h10V7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1zm1.5 8.5a1.2 1.2 0 1 0 0 .01zm7 0a1.2 1.2 0 1 0 0 .01z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a.7.7 0 0 0-.9-.9A9.6 9.6 0 1 0 21.4 15.5a.7.7 0 0 0-.9-.9z"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.4 2.6a.8.8 0 0 0-.85-.18L3 9.6a.8.8 0 0 0 .08 1.5l7.2 2.6 2.6 7.2a.8.8 0 0 0 1.5.08l7.2-17.5a.8.8 0 0 0-.18-.88z"/></svg>',
};

/* ------------------------------------------------------------------ estado */
let theme: Theme =
  (localStorage.getItem('viajo-theme') as Theme | null) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let index: LineaIdx[] = [];
let linea: Linea | null = null;
let direccion: 'ida' | 'vuelta' | 'ambas' = 'ambas';
let parada: Parada | null = null;
let paradaData: ArriboLinea[] | null = null;
let paradaError = false;
let liveState: { n: number; eta: number; checked: boolean; when: number } = { n: 0, eta: 0, checked: false, when: 0 };
let filtro = '';
const buses = new Map<string, maplibregl.Marker>();
let liveTimer = 0;
let stopTimer = 0;

document.documentElement.dataset.theme = theme;

/* ------------------------------------------------------------------ mapa */
maplibregl.setWorkerUrl(workerUrl);
const map: MLMap = new maplibregl.Map({
  container: 'map',
  style: buildStyle(theme),
  center: [-60.6505, -32.9468],
  zoom: 12.4,
  minZoom: 8,
  maxZoom: 19,
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), isMobile() ? 'top-left' : 'bottom-right');

const accent = () => (linea ? lineColor(linea.codigo, theme) : '#007aff');

function arrowImage(): ImageData {
  const s = 32, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff'; g.lineWidth = 4.5; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(11, 8); g.lineTo(21, 16); g.lineTo(11, 24); g.stroke();
  return g.getImageData(0, 0, s, s);
}

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

function routeFC(seg: number[][][]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: seg.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: seg } }] : [] };
}
function stopsFC(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (linea?.stops ?? []).map((p) => ({ type: 'Feature', properties: { id: p.id, nombre: p.nombre }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
  };
}

/** Se vuelve a ejecutar en cada cambio de estilo (claro/oscuro) porque setStyle borra nuestras capas. */
function installOverlays() {
  if (!map.hasImage('arrow')) map.addImage('arrow', arrowImage(), { pixelRatio: 2 });
  const dark = theme === 'dark';
  const c = accent();
  const before = map.getLayer('road-label') ? 'road-label' : undefined;

  map.addSource('ida', { type: 'geojson', data: routeFC(linea?.ida ?? []) });
  map.addSource('vuelta', { type: 'geojson', data: routeFC(linea?.vuelta ?? []) });
  map.addSource('stops', { type: 'geojson', data: stopsFC() });

  const casing = dark ? '#0d0e10' : '#ffffff';
  const width: maplibregl.ExpressionSpecification = ['interpolate', ['exponential', 1.4], ['zoom'], 10, 2.2, 14, 4.5, 18, 9] as never;
  const cwidth: maplibregl.ExpressionSpecification = ['interpolate', ['exponential', 1.4], ['zoom'], 10, 4, 14, 7.5, 18, 14] as never;

  for (const dir of ['vuelta', 'ida'] as const) {
    map.addLayer({
      id: `${dir}-case`, type: 'line', source: dir,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': casing, 'line-width': cwidth, 'line-opacity': dir === 'ida' ? 0.95 : 0.8 },
    }, before);
    map.addLayer({
      id: `${dir}-line`, type: 'line', source: dir,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c, 'line-width': width, 'line-opacity': dir === 'ida' ? 1 : 0.62 },
    }, before);
    map.addLayer({
      id: `${dir}-arrows`, type: 'symbol', source: dir, minzoom: 12.5,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.32, 17, 0.6], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    }, before);
  }

  map.addLayer({
    id: 'stops', type: 'circle', source: 'stops', minzoom: 11.5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 1.8, 14, 3.6, 17, 6.5],
      'circle-color': dark ? '#1c1c1f' : '#ffffff',
      'circle-stroke-color': c,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 2.6],
    },
  });
  map.addLayer({
    id: 'stops-sel', type: 'circle', source: 'stops',
    filter: ['==', ['get', 'id'], parada?.id ?? ''],
    paint: { 'circle-radius': 9, 'circle-color': c, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
  });
  map.addLayer({
    id: 'stops-label', type: 'symbol', source: 'stops', minzoom: 15.6,
    layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9 },
    paint: { 'text-color': dark ? '#e8e9ee' : '#2c2c30', 'text-halo-color': dark ? '#1b1c20' : '#ffffff', 'text-halo-width': 1.6 },
  });
  applyDirection();
}

map.on('style.load', installOverlays);

map.on('click', 'stops', (e) => {
  const f = e.features?.[0];
  const p = linea?.stops.find((s) => s.id === f?.properties?.id);
  if (p) selectStop(p, false);
});
map.on('mouseenter', 'stops', () => (map.getCanvas().style.cursor = 'pointer'));
map.on('mouseleave', 'stops', () => (map.getCanvas().style.cursor = ''));

function applyDirection() {
  for (const d of ['ida', 'vuelta'] as const) {
    const on = direccion === 'ambas' || direccion === d;
    for (const k of ['case', 'line', 'arrows']) {
      if (map.getLayer(`${d}-${k}`)) map.setLayoutProperty(`${d}-${k}`, 'visibility', on ? 'visible' : 'none');
    }
  }
}

function refreshSources() {
  (map.getSource('ida') as GeoJSONSource | undefined)?.setData(routeFC(linea?.ida ?? []));
  (map.getSource('vuelta') as GeoJSONSource | undefined)?.setData(routeFC(linea?.vuelta ?? []));
  (map.getSource('stops') as GeoJSONSource | undefined)?.setData(stopsFC());
  if (map.getLayer('stops-sel')) map.setFilter('stops-sel', ['==', ['get', 'id'], parada?.id ?? '']);
  const c = accent();
  for (const d of ['ida', 'vuelta']) if (map.getLayer(`${d}-line`)) map.setPaintProperty(`${d}-line`, 'line-color', c);
  if (map.getLayer('stops')) map.setPaintProperty('stops', 'circle-stroke-color', c);
  if (map.getLayer('stops-sel')) map.setPaintProperty('stops-sel', 'circle-color', c);
}

/** Padding permanente: el mapa "ve" sólo la parte no tapada por el panel. */
function panelPadding() {
  if (isMobile()) return { top: 0, left: 0, right: 0, bottom: Math.min(visible(snap), innerHeight * 0.5) };
  return { top: 0, bottom: 0, right: 0, left: 392 + 14 * 2 };
}
const syncPadding = (animate = true) => (animate ? map.easeTo({ padding: panelPadding(), duration: 350 }) : map.setPadding(panelPadding()));

function fitLinea() {
  if (!linea) return;
  const b = new maplibregl.LngLatBounds();
  for (const seg of [...linea.ida, ...linea.vuelta]) for (const [x, y] of seg) b.extend([x, y]);
  if (!b.isEmpty()) map.fitBounds(b, { padding: isMobile() ? 36 : 56, duration: 900, maxZoom: 15 });
}

/* ------------------------------------------------------------------ tema */
const btnTheme = $<HTMLButtonElement>('#btn-theme');
const btnLoc = $<HTMLButtonElement>('#btn-locate');
btnLoc.innerHTML = ICON.locate;

function paintTheme() {
  document.documentElement.dataset.theme = theme;
  btnTheme.innerHTML = theme === 'dark' ? ICON.sun : ICON.moon;
  document.querySelector('meta[name=theme-color]')!.setAttribute('content', theme === 'dark' ? '#1b1c20' : '#f3f0e9');
}
btnTheme.onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('viajo-theme', theme);
  paintTheme();
  map.setStyle(buildStyle(theme), { diff: false }); // dispara style.load → installOverlays
  recolorBuses();
  render();
};
paintTheme();

/* ------------------------------------------------------------------ ubicación */
let meMarker: maplibregl.Marker | null = null;
btnLoc.onclick = () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      if (!meMarker) {
        const el = document.createElement('div'); el.className = 'me-dot';
        meMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
      } else meMarker.setLngLat(ll);
      map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 15.2), duration: 1000 });
    },
    () => alert('No pude obtener tu ubicación. Revisá los permisos del navegador.'),
    { enableHighAccuracy: true, timeout: 10000 },
  );
};

/* ------------------------------------------------------------------ hoja móvil */
const panel = $<HTMLElement>('#panel');
type Snap = 'peek' | 'half' | 'full';
let snap: Snap = 'half';
const visible = (s: Snap) => (s === 'peek' ? 150 : s === 'half' ? innerHeight * 0.5 : innerHeight * 0.88);
function setSnap(s: Snap) {
  snap = s;
  panel.classList.toggle('full', s === 'full');
  if (!isMobile()) { panel.style.removeProperty('--y'); syncPadding(false); return; }
  const h = panel.offsetHeight;
  panel.style.setProperty('--y', `${Math.max(0, h - visible(s))}px`);
  syncPadding(true);
}
{
  let startY = 0, startVis = 0, dragging = false;
  const down = (e: PointerEvent) => {
    if (!isMobile()) return;
    if ((e.target as HTMLElement).closest('input,button,.row,.stop')) return;
    dragging = true; startY = e.clientY; startVis = visible(snap);
    panel.classList.add('drag');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const v = Math.min(visible('full'), Math.max(90, startVis + (startY - e.clientY)));
    panel.style.setProperty('--y', `${panel.offsetHeight - v}px`);
  };
  const up = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false; panel.classList.remove('drag');
    const v = startVis + (startY - e.clientY);
    const opts: Snap[] = ['peek', 'half', 'full'];
    setSnap(opts.reduce((a, b) => (Math.abs(visible(b) - v) < Math.abs(visible(a) - v) ? b : a)));
  };
  for (const el of [$('#grab'), $('#head')]) {
    el.addEventListener('pointerdown', down as EventListener);
    el.addEventListener('pointermove', move as EventListener);
    el.addEventListener('pointerup', up as EventListener);
    el.addEventListener('pointercancel', up as EventListener);
  }
  addEventListener('resize', () => setSnap(snap));
}

/* ------------------------------------------------------------------ render */
const head = $<HTMLElement>('#head');
const content = $<HTMLElement>('#content');
const empresaOrden = (e: string) => (/movi/i.test(e) ? 0 : /rosario/i.test(e) ? 1 : 2);
const num = (c: string) => (Number.isNaN(parseInt(c, 10)) ? 9999 : parseInt(c, 10));
const empresaNombre = (e: string) => e.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());

const badge = (l: { codigo: string }, big = false) =>
  `<span class="badge${big ? ' lg' : ''}" style="--c:${lineColor(l.codigo, theme)}">${esc(l.codigo)}</span>`;
const varianteDot = (v: string) => (VARIANTE[v] ? `<i class="dot" style="--v:${VARIANTE[v].css}"></i>${VARIANTE[v].label}` : '');

function render() {
  if (!linea) renderList(); else renderLinea();
}

function renderList() {
  head.innerHTML = `
    <div class="brand">
      <div class="brand-logo">${ICON.bus}</div>
      <div><h1>Viajo</h1><small>Colectivos de Rosario · ${index.length} líneas</small></div>
    </div>
    <label class="search">${ICON.search}<input id="q" type="search" placeholder="Buscar línea (ej. 101, K, Costa)" autocomplete="off" value="${esc(filtro)}" /></label>`;
  const q = $<HTMLInputElement>('#q');
  q.oninput = () => { filtro = q.value; drawRows(); };
  q.onfocus = () => isMobile() && setSnap('full');
  drawRows();
}

function drawRows() {
  const t = norm(filtro.trim());
  const rows = index
    .filter((l) => !t || norm(`${l.nombre} ${l.codigo} ${l.nombreCorto} ${l.empresa}`).includes(t))
    .sort((a, b) => empresaOrden(a.empresa) - empresaOrden(b.empresa) || num(a.codigo) - num(b.codigo) || a.nombre.localeCompare(b.nombre));
  if (!rows.length) { content.innerHTML = `<div class="empty">No encontré ninguna línea con “${esc(filtro)}”.</div>`; return; }
  let html = '', cur = '';
  for (const l of rows) {
    if (l.empresa !== cur) { cur = l.empresa; html += `<div class="sec">${esc(empresaNombre(cur))}</div>`; }
    html += `<button class="row" data-f="${l.file}">${badge(l)}<span class="main"><div class="t">${esc(l.nombre)}</div><div class="s">${varianteDot(l.variante)}${VARIANTE[l.variante] ? ' · ' : ''}${l.paradas} paradas</div></span><span class="chev">${ICON.chev}</span></button>`;
  }
  content.innerHTML = html;
  content.scrollTop = 0;
  content.querySelectorAll<HTMLButtonElement>('.row').forEach((b) => (b.onclick = () => openLinea(b.dataset.f!)));
}

function renderLinea() {
  const l = linea!;
  head.innerHTML = `
    <div class="lhead">
      <button class="iconbtn" id="back" aria-label="Volver a las líneas">${ICON.back}</button>
      ${badge(l, true)}
      <div class="info"><b>${esc(l.nombre)}</b><span>${esc(empresaNombre(l.empresa))} · ${l.stops.length} paradas</span></div>
    </div>
    <div class="seg" role="group" aria-label="Sentido">
      ${(['ida', 'vuelta', 'ambas'] as const).map((d) => `<button data-d="${d}" aria-pressed="${direccion === d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}
    </div>
    <div class="live ${liveState.n || liveState.eta ? 'on' : ''}" id="live"></div>`;
  $('#back').onclick = closeLinea;
  head.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.onclick = () => { direccion = b.dataset.d as typeof direccion; applyDirection(); renderLinea(); }));
  drawLive();
  drawBody();
}

function drawLive() {
  const el = document.getElementById('live');
  if (!el) return;
  el.classList.toggle('on', liveState.n > 0 || liveState.eta > 0);
  el.innerHTML = `<span class="pulse"></span><span>${
    !liveState.checked ? 'Consultando estado del servicio…'
    : liveState.n ? `<b>${liveState.n} ${liveState.n === 1 ? 'colectivo' : 'colectivos'} en vivo</b> en el mapa`
    : liveState.eta ? '<b>Servicio con GPS</b> · arribos actualizados en vivo en cada parada'
    : 'Sin datos de GPS ahora · se muestran horarios programados'}</span>`;
}

const fmtArribo = (a: Arribo) => {
  const live = esEnVivo(a) || a.tipo.toLowerCase() !== 'programado';
  const t = a.arriboEnMinutos <= 0 ? 'Ahora' : a.arriboEnMinutos < 60 ? `${a.arriboEnMinutos} min` : a.horaArribo;
  return live ? `<span class="pill live">${t}</span>` : `<span class="pill prog" title="Horario programado">${t}</span>`;
};

function stopCard(): string {
  if (!parada) return '';
  let body: string;
  if (paradaError) body = `<div class="note">No se pudieron cargar los arribos. Reintentando…</div>`;
  else if (!paradaData) body = `<div class="note">Consultando arribos…</div>`;
  else if (!paradaData.length) body = `<div class="note">No hay arribos informados para esta parada.</div>`;
  else {
    const mine = (x: ArriboLinea) => linea && x.linea.id === linea.id && x.linea.idEmpresa === linea.idEmpresa;
    const sorted = [...paradaData].sort((a, b) => Number(!!mine(b)) - Number(!!mine(a)));
    body = sorted.map((x) => {
      const idx = index.find((i) => i.id === x.linea.id && i.idEmpresa === x.linea.idEmpresa);
      const bd = badge({ codigo: x.linea.codigoEMR || x.linea.nombreCorto });
      const times = x.arribos.slice(0, 3).map(fmtArribo).join('') || '<span class="pill prog">—</span>';
      return `<div class="arr ${mine(x) ? 'me' : ''}">${idx && !mine(x) ? `<button class="badge-btn" data-f="${idx.file}" style="display:contents">${bd}</button>` : bd}<span style="font-size:13px;font-weight:${mine(x) ? 650 : 500}">${esc(x.linea.nombre)}</span><span class="times">${times}</span></div>`;
    }).join('') + `<div class="note"><span class="pill live" style="font-size:11px;padding:1px 6px">en vivo</span> con GPS · <span class="pill prog" style="font-size:11px;padding:1px 6px">hora</span> programado</div>`;
  }
  return `<div class="card">
    <div class="top"><div><h3>${esc(parada.nombre)}</h3><div class="sub">${esc(parada.desc || 'Parada')} · próximos arribos</div></div>
    <button class="iconbtn" id="close-stop" aria-label="Cerrar parada">${ICON.close}</button></div>${body}</div>`;
}

function drawBody() {
  if (!linea) return;
  const c = lineColor(linea.codigo, theme);
  const list = linea.stops.map((p) => `<button class="stop ${parada?.id === p.id ? 'sel' : ''}" data-s="${p.id}" style="--c:${c}"><span class="pin"></span><span><div class="n">${esc(p.nombre)}</div>${p.desc ? `<div class="d">${esc(p.desc)}</div>` : ''}</span></button>`).join('');
  content.innerHTML = `${stopCard()}<div class="sec">Paradas</div>${list}`;
  content.querySelectorAll<HTMLButtonElement>('.stop').forEach((b) => (b.onclick = () => { const p = linea!.stops.find((s) => s.id === b.dataset.s); if (p) selectStop(p, true); }));
  content.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => openLinea(b.dataset.f!)));
  document.getElementById('close-stop')?.addEventListener('click', clearStop);
}

/* ------------------------------------------------------------------ acciones */
async function openLinea(file: string, stopId?: string) {
  const l = await loadLinea(file);
  linea = l; parada = null; paradaData = null; direccion = 'ambas';
  stopLive(); clearBuses(); liveState = { n: 0, eta: 0, checked: false, when: 0 };
  refreshSources(); fitLinea();
  renderLinea();
  if (isMobile()) setSnap('half');
  history.replaceState(null, '', `#linea=${file}`);
  startLive();
  if (stopId) { const p = l.stops.find((s) => s.id === stopId); if (p) selectStop(p, true); }
}

function closeLinea() {
  linea = null; parada = null; paradaData = null;
  stopLive(); clearBuses(); clearInterval(stopTimer);
  refreshSources();
  history.replaceState(null, '', location.pathname);
  renderList();
  map.easeTo({ pitch: 0, duration: 400 });
}

function selectStop(p: Parada, fly: boolean) {
  parada = p; paradaData = null; paradaError = false;
  if (map.getLayer('stops-sel')) map.setFilter('stops-sel', ['==', ['get', 'id'], p.id]);
  if (fly) map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15.4), duration: 700 });
  if (isMobile() && snap === 'peek') setSnap('half');
  drawBody();
  content.scrollTop = 0;
  const load = async () => {
    if (!parada || parada.id !== p.id) return;
    try { paradaData = await arribos(p.id); paradaError = false; } catch { paradaError = true; }
    if (parada?.id === p.id) { const st = content.scrollTop; drawBody(); content.scrollTop = st; }
  };
  load();
  clearInterval(stopTimer);
  stopTimer = window.setInterval(load, 30000);
}

function clearStop() {
  parada = null; paradaData = null; clearInterval(stopTimer);
  if (map.getLayer('stops-sel')) map.setFilter('stops-sel', ['==', ['get', 'id'], '']);
  drawBody();
}

/* ------------------------------------------------------------------ colectivos en vivo */
function sampleStops(stops: Parada[], n = 8): Parada[] {
  if (stops.length <= n) return stops;
  return Array.from({ length: n }, (_, i) => stops[Math.round((i * (stops.length - 1)) / (n - 1))]);
}

async function pollLive() {
  const l = linea;
  if (!l || document.hidden) return;
  const found = new Map<string, { ll: [number, number]; seen: number }>();
  let eta = 0;
  const res = await Promise.allSettled(sampleStops(l.stops).map((s) => arribos(s.id, l.nombre)));
  if (linea !== l) return; // cambió de línea mientras esperábamos
  for (const r of res) {
    if (r.status !== 'fulfilled') continue;
    for (const x of r.value) {
      if (x.linea.id !== l.id || x.linea.idEmpresa !== l.idEmpresa) continue;
      for (const a of x.arribos) {
        if (a.tipo.toLowerCase() !== 'programado') eta++;
        if (!esEnVivo(a)) continue;
        const key = a.vehiculo || `${a.latitud.toFixed(4)},${a.longitud.toFixed(4)}`;
        found.set(key, { ll: [a.longitud, a.latitud], seen: Date.now() });
      }
    }
  }
  // actualizar marcadores
  for (const [k, m] of buses) if (!found.has(k)) { m.remove(); buses.delete(k); }
  for (const [k, v] of found) {
    const cur = buses.get(k);
    if (cur) cur.setLngLat(v.ll);
    else {
      const el = document.createElement('div');
      el.className = 'bus'; el.style.setProperty('--c', lineColor(l.codigo, theme));
      el.innerHTML = `<i></i><b>${esc(l.codigo)}</b>`;
      el.title = `Interno ${k}`;
      buses.set(k, new maplibregl.Marker({ element: el }).setLngLat(v.ll).addTo(map));
    }
  }
  liveState = { n: found.size, eta, checked: true, when: Date.now() };
  drawLive();
}
function startLive() { stopLive(); pollLive(); liveTimer = window.setInterval(pollLive, 45000); }
function stopLive() { clearInterval(liveTimer); }
function clearBuses() { buses.forEach((m) => m.remove()); buses.clear(); }
function recolorBuses() { buses.forEach((m) => linea && m.getElement().style.setProperty('--c', lineColor(linea.codigo, theme))); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && linea) pollLive(); });

/* ------------------------------------------------------------------ arranque */
(async () => {
  index = await loadIndex();
  renderList();
  if (isMobile()) setSnap('half'); else setSnap('half');
  const m = location.hash.match(/linea=([\w-]+)/);
  if (m && index.some((i) => i.file === m[1])) openLinea(m[1]);
})();

// utilidades para depurar desde la consola del navegador
(window as unknown as Record<string, unknown>).__viajo = { map, openLinea };
