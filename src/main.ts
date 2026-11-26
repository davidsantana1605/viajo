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
import { buscarLugares, type Lugar } from './geo';
import { planificar, type Ruta } from './trip';
import { estimate, dedupe, headingNear, busFeatures, dist, type Est } from './bus3d';
import { renderRutinas, iniciarUbicacionPeriodica } from './rutinas';
import { registrarSW } from './push';
import { initShare, aplicarHash, shareBtns, syncLinea, syncViaje, syncTab, leaveLinea, guardarReciente, recientesHTML, bindRecientes } from './share'; // [share]
import type { Pt } from './links'; // [share]

/* ------------------------------------------------------------------ utilidades */
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isMobile = () => matchMedia('(max-width: 760px)').matches;
type LL = [number, number];

const fmtDur = (s: number) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const fmtMin = (m: number) => (m <= 0 ? 'ahora' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);

const ICON = {
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  chev: '<svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5.5-5 5.5"/></svg>',
  back: '<svg width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 1.5 2 7.5l5.5 6"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m2 2 8 8M10 2l-8 8"/></svg>',
  bus: '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10a1.5 1.5 0 0 1-1.5 1.5H18V20a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1.5H9V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.5h-.5A.5.5 0 0 1 5 18zM7 7v4.5h10V7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1zm1.5 8.5a1.2 1.2 0 1 0 0 .01zm7 0a1.2 1.2 0 1 0 0 .01z"/></svg>',
  walk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="13" cy="4.2" r="2.2"/><path d="M10.2 8.4 7 10.2l.9 1.6 2-1.1-1 4.4L6.4 21l1.9.7 2.6-5.2 2.4 2.1V23h2v-5.7l-2.3-2.3.7-3 1.3 1.6H17v-2h-1.7l-1.9-2.5c-.5-.6-1.3-.9-2-.6z"/></svg>',
  swap: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v16M8 20l-4-4M8 20l4-4M16 20V4M16 4l-4 4M16 4l4 4"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a.7.7 0 0 0-.9-.9A9.6 9.6 0 1 0 21.4 15.5a.7.7 0 0 0-.9-.9z"/></svg>',
  locate: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.4 2.6a.8.8 0 0 0-.85-.18L3 9.6a.8.8 0 0 0 .08 1.5l7.2 2.6 2.6 7.2a.8.8 0 0 0 1.5.08l7.2-17.5a.8.8 0 0 0-.18-.88z"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>',
};

/* ------------------------------------------------------------------ estado */
let theme: Theme =
  (localStorage.getItem('viajo-theme') as Theme | null) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
let threeD = localStorage.getItem('viajo-3d') !== '0';
let index: LineaIdx[] = [];
let linea: Linea | null = null;
let direccion: 'ida' | 'vuelta' | 'ambas' = 'ambas';
let parada: Parada | null = null;
let paradaData: ArriboLinea[] | null = null;
let paradaError = false;
let liveState = { n: 0, eta: 0, checked: false, when: 0 };
let filtro = '';
let tab: 'viaje' | 'lineas' | 'rutinas' = 'viaje';

interface Campo { texto: string; lng?: number; lat?: number }
let origen: Campo = { texto: '' };
let destino: Campo = { texto: '' };
let rutas: Ruta[] | null = null;
let planEstado: 'idle' | 'cargando' | 'error' | 'vacio' = 'idle';
let orden: 'rapida' | 'caminata' | 'transbordos' = 'rapida';
let rutaSel: Ruta | null = null;
let sug: { campo: 'o' | 'd'; items: Lugar[]; cargando: boolean } | null = null;
const tripEta = new Map<number, string>();

interface Anchor { routes: LL[][]; stop: LL; etaAt: number }
interface BusView extends Est { key: string; codigo: string; color: string; estimado: boolean; anchor?: Anchor }
let busList: BusView[] = [];
const busMarkers = new Map<string, maplibregl.Marker>();
let liveTimer = 0;
let stopTimer = 0;
let planAbort: AbortController | null = null;

document.documentElement.dataset.theme = theme;

/* ------------------------------------------------------------------ mapa */
maplibregl.setWorkerUrl(workerUrl);
const map: MLMap = new maplibregl.Map({
  container: 'map',
  style: buildStyle(theme, threeD),
  center: [-60.6505, -32.9468],
  zoom: 12.6,
  pitch: threeD ? 38 : 0,
  minZoom: 8,
  maxZoom: 19,
  maxPitch: 62,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2), // evita renderizar a 3x en celulares
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

const emptyFC = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });
function routeFC(seg: number[][][]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: seg.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: seg } }] : [] };
}
function stopsFC(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (linea?.stops ?? []).map((p) => ({ type: 'Feature', properties: { id: p.id, nombre: p.nombre }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
  };
}

let tripFC: GeoJSON.FeatureCollection = emptyFC();
let tripPts: GeoJSON.FeatureCollection = emptyFC();
let busFC: GeoJSON.FeatureCollection = emptyFC();

/** Se vuelve a ejecutar en cada cambio de estilo (claro/oscuro, 3D) porque setStyle borra nuestras capas. */
function installOverlays() {
  if (!map.hasImage('arrow')) map.addImage('arrow', arrowImage(), { pixelRatio: 2 });
  const dark = theme === 'dark';
  const c = accent();
  const before = map.getLayer('road-label') ? 'road-label' : undefined;

  map.addSource('ida', { type: 'geojson', data: routeFC(linea?.ida ?? []) });
  map.addSource('vuelta', { type: 'geojson', data: routeFC(linea?.vuelta ?? []) });
  map.addSource('stops', { type: 'geojson', data: stopsFC() });
  map.addSource('trip', { type: 'geojson', data: tripFC });
  map.addSource('trip-pts', { type: 'geojson', data: tripPts });
  map.addSource('buses3d', { type: 'geojson', data: busFC });

  const casing = dark ? '#0d0e10' : '#ffffff';
  const width = ['interpolate', ['exponential', 1.4], ['zoom'], 10, 2.2, 14, 4.5, 18, 9] as never;
  const cwidth = ['interpolate', ['exponential', 1.4], ['zoom'], 10, 4, 14, 7.5, 18, 14] as never;

  for (const dir of ['vuelta', 'ida'] as const) {
    map.addLayer({ id: `${dir}-case`, type: 'line', source: dir, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': casing, 'line-width': cwidth, 'line-opacity': dir === 'ida' ? 0.95 : 0.8 } }, before);
    map.addLayer({ id: `${dir}-line`, type: 'line', source: dir, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c, 'line-width': width, 'line-opacity': dir === 'ida' ? 1 : 0.62 } }, before);
    map.addLayer({ id: `${dir}-arrows`, type: 'symbol', source: dir, minzoom: 12.5, layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.32, 17, 0.6], 'icon-allow-overlap': true, 'icon-ignore-placement': true } }, before);
  }

  // Viaje planificado: caminata punteada, colectivo con el color de su línea
  map.addLayer({ id: 'trip-case', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': casing, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 5, 14, 9, 18, 16], 'line-opacity': ['match', ['get', 'kind'], 'bus', 0.95, 0] } }, before);
  map.addLayer({ id: 'trip-bus', type: 'line', source: 'trip', filter: ['==', ['get', 'kind'], 'bus'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 3, 14, 5.5, 18, 10] } }, before);
  map.addLayer({ id: 'trip-walk', type: 'line', source: 'trip', filter: ['==', ['get', 'kind'], 'walk'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark ? '#7db9ff' : '#0a6cff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 17, 5], 'line-dasharray': [0.1, 2] } }, before);

  map.addLayer({
    id: 'stops', type: 'circle', source: 'stops', minzoom: 11.5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 1.8, 14, 3.6, 17, 6.5],
      'circle-color': dark ? '#1c1c1f' : '#ffffff', 'circle-stroke-color': c,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 2.6],
    },
  });
  map.addLayer({ id: 'stops-sel', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], parada?.id ?? ''], paint: { 'circle-radius': 9, 'circle-color': c, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  map.addLayer({
    id: 'stops-label', type: 'symbol', source: 'stops', minzoom: 15.6,
    layout: { 'text-field': ['get', 'nombre'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 9 },
    paint: { 'text-color': dark ? '#e8e9ee' : '#2c2c30', 'text-halo-color': dark ? '#1b1c20' : '#ffffff', 'text-halo-width': 1.6 },
  });
  map.addLayer({ id: 'trip-pts', type: 'circle', source: 'trip-pts', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 8], 'circle-color': dark ? '#1c1c1f' : '#ffffff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3 } });

  // Colectivos 3D (cajas extruidas: baratas de dibujar)
  map.addLayer({
    id: 'buses3d', type: 'fill-extrusion', source: 'buses3d',
    paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true },
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
map.on('zoomend', () => { if (busList.length) paintBuses(); });

function applyDirection() {
  for (const d of ['ida', 'vuelta'] as const) {
    const on = direccion === 'ambas' || direccion === d;
    for (const k of ['case', 'line', 'arrows']) if (map.getLayer(`${d}-${k}`)) map.setLayoutProperty(`${d}-${k}`, 'visibility', on ? 'visible' : 'none');
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

function fitPoints(pts: number[][], maxZoom = 15.5) {
  const b = new maplibregl.LngLatBounds();
  for (const [x, y] of pts) b.extend([x, y]);
  if (!b.isEmpty()) map.fitBounds(b, { padding: isMobile() ? 40 : 70, duration: 900, maxZoom });
}
const fitLinea = () => linea && fitPoints([...linea.ida, ...linea.vuelta].flat(), 15);

/* ------------------------------------------------------------------ botones: tema, 3D, ubicación */
const btnTheme = $<HTMLButtonElement>('#btn-theme');
const btn3d = $<HTMLButtonElement>('#btn-3d');
const btnLoc = $<HTMLButtonElement>('#btn-locate');
btnLoc.innerHTML = ICON.locate;

function paintButtons() {
  document.documentElement.dataset.theme = theme;
  btnTheme.innerHTML = theme === 'dark' ? ICON.sun : ICON.moon;
  btn3d.textContent = threeD ? '3D' : '2D';
  btn3d.setAttribute('aria-pressed', String(threeD));
  document.querySelector('meta[name=theme-color]')!.setAttribute('content', theme === 'dark' ? '#1b1c20' : '#f3f0e9');
}
function restyle() { map.setStyle(buildStyle(theme, threeD), { diff: false }); } // dispara style.load → installOverlays

btnTheme.onclick = () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('viajo-theme', theme);
  paintButtons(); restyle(); render(); if (rutaSel && !linea) drawTrip(rutaSel, false); recolorBuses();
};
btn3d.onclick = () => {
  threeD = !threeD;
  localStorage.setItem('viajo-3d', threeD ? '1' : '0');
  paintButtons(); restyle();
  map.easeTo({ pitch: threeD ? 38 : 0, duration: 600 });
};
paintButtons();

let meMarker: maplibregl.Marker | null = null;
function setMe(ll: LL) {
  if (!meMarker) {
    const el = document.createElement('div'); el.className = 'me-dot';
    meMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map);
  } else meMarker.setLngLat(ll);
}
function locate(): Promise<LL> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('sin geolocalización'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll: LL = [pos.coords.longitude, pos.coords.latitude];
        setMe(ll);
        res(ll);
      },
      rej, { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}
btnLoc.onclick = () => locate().then((ll) => map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 15.2), duration: 1000 })).catch(() => alert('No pude obtener tu ubicación. Revisá los permisos del navegador.'));

/* ------------------------------------------------------------------ hoja móvil */
const panel = $<HTMLElement>('#panel');
type Snap = 'peek' | 'half' | 'full';
let snap: Snap = 'half';
const visible = (s: Snap) => (s === 'peek' ? 150 : s === 'half' ? innerHeight * 0.5 : innerHeight * 0.88);
function setSnap(s: Snap) {
  snap = s;
  panel.classList.toggle('full', s === 'full');
  if (!isMobile()) { panel.style.removeProperty('--y'); syncPadding(false); return; }
  panel.style.setProperty('--y', `${Math.max(0, panel.offsetHeight - visible(s))}px`);
  syncPadding(true);
}
{
  let startY = 0, startVis = 0, dragging = false;
  const down = (e: PointerEvent) => {
    if (!isMobile() || (e.target as HTMLElement).closest('input,button,.row,.stop,.trip')) return;
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

/* ------------------------------------------------------------------ render general */
const head = $<HTMLElement>('#head');
const content = $<HTMLElement>('#content');
const empresaOrden = (e: string) => (/movi/i.test(e) ? 0 : /rosario/i.test(e) ? 1 : 2);
const num = (c: string) => (Number.isNaN(parseInt(c, 10)) ? 9999 : parseInt(c, 10));
const empresaNombre = (e: string) => e.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());
const idxOf = (id: string, emp: string) => index.find((i) => i.id === id && i.idEmpresa === emp);

const badge = (l: { codigo: string }, big = false, small = false) =>
  `<span class="badge${big ? ' lg' : ''}${small ? ' sm' : ''}" style="--c:${lineColor(l.codigo, theme)}">${esc(l.codigo)}</span>`;
const varianteDot = (v: string) => (VARIANTE[v] ? `<i class="dot" style="--v:${VARIANTE[v].css}"></i>${VARIANTE[v].label}` : '');

function render() {
  if (linea) renderLinea(); else renderHome();
}

/* ---------------- Inicio: pestañas Viaje / Líneas ---------------- */
function renderHome() {
  if (viaje) { renderViaje(); return; }
  head.innerHTML = `
    <div class="brand">
      <div class="brand-logo">${ICON.bus}</div>
      <div><h1>Viajo</h1><small>Colectivos de Rosario · ${index.length} líneas</small></div>
    </div>
    <div class="seg tabs" role="tablist">
      <button role="tab" data-t="viaje" aria-pressed="${tab === 'viaje'}">Planificar viaje</button>
      <button role="tab" data-t="lineas" aria-pressed="${tab === 'lineas'}">Líneas</button>
      <button role="tab" data-t="rutinas" aria-pressed="${tab === 'rutinas'}">Rutinas</button>
    </div>
    ${tab === 'viaje' ? plannerHTML() : tab === 'rutinas' ? '' : `<label class="search">${ICON.search}<input id="q" type="search" placeholder="Buscar línea (ej. 101, K, Costa)" autocomplete="off" value="${esc(filtro)}" /></label>`}`;
  head.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t as typeof tab; sug = null; syncTab(tab) /* [share] */; renderHome(); }));
  if (tab === 'viaje') { bindPlanner(); drawTripContent(); }
  else if (tab === 'rutinas') {
    renderRutinas({ content, isMobile, setFull: () => setSnap('full'), esc });
  } else {
    const q = $<HTMLInputElement>('#q');
    q.oninput = () => { filtro = q.value; drawRows(); };
    q.onfocus = () => isMobile() && setSnap('full');
    drawRows();
  }
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

/* ---------------- Planificador ---------------- */
function plannerHTML() {
  return `<div class="plan">
    <div class="rail"><i class="o"></i><i class="l"></i><i class="d">${ICON.pin}</i></div>
    <div class="fields">
      <input id="in-o" type="text" placeholder="Tu dirección o lugar de salida" autocomplete="off" enterkeyhint="search" value="${esc(origen.texto)}" />
      <input id="in-d" type="text" placeholder="¿A dónde vas?" autocomplete="off" enterkeyhint="go" value="${esc(destino.texto)}" />
    </div>
    <button class="iconbtn" id="swap" aria-label="Invertir origen y destino" title="Invertir">${ICON.swap}</button>
  </div>`;
}

let debounce = 0;
let sugAbort: AbortController | null = null;
function bindPlanner() {
  const io = $<HTMLInputElement>('#in-o'), id = $<HTMLInputElement>('#in-d');
  const wire = (el: HTMLInputElement, campo: 'o' | 'd') => {
    const get = () => (campo === 'o' ? origen : destino);
    el.onfocus = () => { if (isMobile()) setSnap('full'); onType(campo, el.value); };
    el.oninput = () => { const c = get(); c.texto = el.value; c.lng = c.lat = undefined; clearTimeout(debounce); debounce = window.setTimeout(() => onType(campo, el.value), 260); };
    el.onblur = () => setTimeout(() => { if (document.activeElement !== io && document.activeElement !== id) { sug = null; drawTripContent(); } }, 180);
    el.onkeydown = (e) => {
      if (e.key === 'Escape') { sug = null; el.blur(); drawTripContent(); }
      if (e.key === 'Enter') { const first = sug?.items[0]; if (first) { e.preventDefault(); pick(campo, first); } else if (campo === 'o' && !el.value) useMyLocation(); }
    };
  };
  wire(io, 'o'); wire(id, 'd');
  $('#swap').onclick = () => { [origen, destino] = [destino, origen]; io.value = origen.texto; id.value = destino.texto; tryPlan(); };
}

async function onType(campo: 'o' | 'd', term: string) {
  term = term.trim();
  sugAbort?.abort();
  if (term.length < 3) { sug = { campo, items: [], cargando: false }; drawTripContent(); return; }
  sug = { campo, items: [], cargando: true }; drawTripContent();
  sugAbort = new AbortController();
  try {
    sug = { campo, items: await buscarLugares(term, sugAbort.signal), cargando: false };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    sug = { campo, items: [], cargando: false };
  }
  drawTripContent();
}

function pick(campo: 'o' | 'd', l: Lugar) {
  const c = campo === 'o' ? origen : destino;
  c.texto = l.nombre; c.lng = l.lng; c.lat = l.lat;
  const el = $<HTMLInputElement>(campo === 'o' ? '#in-o' : '#in-d');
  el.value = l.nombre; el.blur();
  sug = null;
  if (campo === 'o' && destino.lng === undefined) $<HTMLInputElement>('#in-d').focus();
  tryPlan();
}

async function useMyLocation() {
  try {
    const [lng, lat] = await locate();
    origen = { texto: 'Mi ubicación', lng, lat };
    $<HTMLInputElement>('#in-o').value = origen.texto;
    sug = null;
    if (destino.lng === undefined) $<HTMLInputElement>('#in-d').focus(); else tryPlan();
  } catch { alert('No pude obtener tu ubicación. Revisá los permisos del navegador o escribí una dirección.'); }
}

async function tryPlan() {
  rutaSel = null; clearTripMap(); clearBuses();
  placeEndpoints();
  syncViaje(); // [share]
  if (origen.lng === undefined || destino.lng === undefined) { rutas = null; planEstado = 'idle'; drawTripContent(); return; }
  planAbort?.abort(); planAbort = new AbortController();
  planEstado = 'cargando'; rutas = null; drawTripContent();
  if (isMobile()) setSnap('half');
  try {
    const r = await planificar({ lng: origen.lng, lat: origen.lat! }, { lng: destino.lng, lat: destino.lat! }, planAbort.signal);
    rutas = r; planEstado = r.length ? 'idle' : 'vacio';
    if (r.length) guardarReciente(origen, destino); // [share]
    if (r.length) fitPoints([[origen.lng, origen.lat!], [destino.lng, destino.lat!]], 15.2);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    planEstado = 'error';
  }
  drawTripContent();
}

function ordenadas(): Ruta[] {
  const r = [...(rutas ?? [])];
  if (orden === 'rapida') r.sort((a, b) => a.dur - b.dur);
  else if (orden === 'caminata') r.sort((a, b) => a.caminata - b.caminata || a.dur - b.dur);
  else r.sort((a, b) => a.transbordos - b.transbordos || a.dur - b.dur);
  return r;
}

function drawTripContent() {
  if (linea || viaje || tab !== 'viaje') return;
  content.scrollTop = 0;
  // 1) sugerencias mientras se escribe
  if (sug) {
    let html = '';
    if (sug.campo === 'o') html += `<button class="row sug" data-loc="1"><span class="sico loc">${ICON.locate.replace('<svg ', '<svg width="15" height="15" ')}</span><span class="main"><div class="t">Mi ubicación</div><div class="s">Usar el GPS del dispositivo</div></span></button>`;
    html += sug.items.map((l, i) => `<button class="row sug" data-i="${i}"><span class="sico">${ICON.pin}</span><span class="main"><div class="t">${esc(l.nombre)}</div><div class="s">${esc(l.detalle)}</div></span></button>`).join('');
    if (sug.cargando) html += `<div class="empty small">Buscando…</div>`;
    else if (!sug.items.length) html += `<div class="empty small">${(sug.campo === 'o' ? origen : destino).texto.trim().length < 3 ? 'Escribí una dirección (“Córdoba 1500”), una esquina (“Corrientes y Córdoba”) o un lugar.' : 'Sin resultados. Probá con calle y altura o una esquina.'}</div>`;
    content.innerHTML = html;
    const s = sug;
    content.querySelector<HTMLElement>('[data-loc]')?.addEventListener('pointerdown', (e) => { e.preventDefault(); useMyLocation(); });
    content.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(s.campo, s.items[+b.dataset.i!]); }));
    return;
  }
  // 2) detalle de una alternativa
  if (rutaSel) { drawDetalle(rutaSel); return; }
  // 3) estados / resultados
  if (planEstado === 'cargando') { content.innerHTML = `<div class="empty"><div class="spin"></div>Buscando la mejor combinación de colectivos…</div>`; return; }
  if (planEstado === 'error') { content.innerHTML = `<div class="empty">No pude consultar el planificador. Revisá tu conexión e intentá de nuevo.<br><button class="btn" id="retry">Reintentar</button></div>`; $('#retry').onclick = tryPlan; return; }
  if (planEstado === 'vacio') { content.innerHTML = `<div class="empty">No encontré recorridos en colectivo entre esos dos puntos. Probá con otras direcciones.</div>`; return; }
  if (rutas) {
    const list = ordenadas();
    const fast = Math.min(...rutas.map((r) => r.dur));
    const chips = ([['rapida', 'Más rápida'], ['caminata', 'Menos caminata'], ['transbordos', 'Menos transbordos']] as const)
      .map(([k, t]) => `<button class="chip" data-o="${k}" aria-pressed="${orden === k}">${t}</button>`).join('');
    content.innerHTML = `<div class="chips-row">${chips}</div>` + list.map((r, i) => tripCard(r, r.dur === fast, i)).join('') +
      `<div class="note pad">Recorridos y tiempos calculados con el planificador oficial de Cómo Llego, desde ahora. Pueden variar según el tránsito.</div>`;
    content.querySelectorAll<HTMLElement>('[data-o]').forEach((b) => (b.onclick = () => { orden = b.dataset.o as typeof orden; drawTripContent(); }));
    content.querySelectorAll<HTMLElement>('.trip').forEach((b) => (b.onclick = () => selectRuta(list[+b.dataset.r!])));
    return;
  }
  // 4) vacío inicial
  content.innerHTML = `<div class="empty hello">
    <div class="hello-ico">${ICON.bus.replace('width="17" height="17"', 'width="28" height="28"')}</div>
    <b>¿A dónde vamos?</b>
    <p>Poné tu dirección y a dónde querés ir. Te muestro la parada más cercana, qué colectivo tomar y cuánto tardás.</p>
    <button class="btn" id="use-loc">${ICON.locate.replace('<svg ', '<svg width="14" height="14" ')} Usar mi ubicación como salida</button>
  </div>`;
  $('#use-loc').onclick = useMyLocation;
  content.insertAdjacentHTML('beforeend', recientesHTML()); bindRecientes(content); // [share]
}

/** [share] Abre un viaje (desde un enlace o "recientes"): rellena origen/destino y planifica solo. */
function abrirViaje(o: Pt, d: Pt) {
  if (viaje) return;
  tab = 'viaje'; sug = null; rutaSel = null;
  origen = { texto: o.nombre, lng: o.lng, lat: o.lat };
  destino = { texto: d.nombre, lng: d.lng, lat: d.lat };
  if (linea) closeLinea();
  renderHome();
  tryPlan();
}

function tripCard(r: Ruta, best: boolean, i: number): string {
  const parts = r.tramos.map((t, k) => {
    const sep = k ? `<span class="arrow">›</span>` : '';
    if (t.modo === 'walk') return `${sep}<span class="wk">${ICON.walk}${Math.max(1, Math.round(t.dur / 60))}′</span>`;
    return `${sep}${badge({ codigo: t.linea!.codigo }, false, true)}`;
  }).join('');
  const trans = r.transbordos === 0 ? 'Sin transbordos' : r.transbordos === 1 ? '1 transbordo' : `${r.transbordos} transbordos`;
  return `<button class="trip" data-r="${i}">
    <div class="tt"><b>${fmtDur(r.dur)}</b>${best ? '<em>Más rápida</em>' : ''}<span>${r.inicio} → ${r.fin}</span></div>
    <div class="legs">${parts}</div>
    <div class="ts">${trans} · caminás ${fmtDist(r.caminata)} · ${fmtDist(r.dist)} en total</div>
  </button>`;
}

function drawDetalle(r: Ruta) {
  const steps = r.tramos.map((t, i) => {
    const hasta = t.hasta.nombre === 'Destino' ? 'tu destino' : t.hasta.nombre;
    if (t.modo === 'walk') {
      const desdeOrigen = t.desde.nombre === 'Origen';
      return `<button class="step" data-leg="${i}"><span class="sico walk">${ICON.walk.replace('width="14" height="14"', 'width="16" height="16"')}</span><span class="main"><div class="t">Caminá ${fmtDur(t.dur)} <span class="mut">(${fmtDist(t.dist)})</span></div><div class="s">${desdeOrigen ? 'Hasta la parada ' : 'Hasta '}<b>${esc(hasta)}</b></div></span><span class="hr">${t.inicio}</span></button>`;
    }
    const eta = tripEta.get(i);
    return `<button class="step" data-leg="${i}">${badge({ codigo: t.linea!.codigo }, false, true)}<span class="main"><div class="t">Tomá el ${esc(t.linea!.nombre)}</div><div class="s">Subí en <b>${esc(t.desde.nombre)}</b><br>Bajá en <b>${esc(t.hasta.nombre)}</b> · ${fmtDur(t.dur)}</div>${eta ? `<div class="eta">${eta}</div>` : ''}</span><span class="hr">${t.inicio}</span></button>`;
  }).join('');
  content.innerHTML = `
    <button class="row back" id="back-res"><span class="iconbtn">${ICON.back}</span><span class="main"><div class="t">Alternativas</div></span></button>
    <div class="card sum"><b>${fmtDur(r.dur)}</b><span>${r.inicio} → ${r.fin}</span>
      <div class="s">${r.transbordos === 0 ? 'Sin transbordos' : r.transbordos + (r.transbordos === 1 ? ' transbordo' : ' transbordos')} · caminás ${fmtDist(r.caminata)}</div></div>
    <div class="gorow"><button class="btn go" id="go-viaje">Iniciar viaje</button>${shareBtns('viaje')}</div>
    <div class="steps">${steps}<div class="step end"><span class="sico dest">${ICON.pin}</span><span class="main"><div class="t">Llegás a tu destino</div><div class="s">${esc(destino.texto)}</div></span><span class="hr">${r.fin}</span></div></div>
    <div class="note pad">Los colectivos en 3D son una <b>estimación</b> de dónde viene el próximo, según los arribos en vivo.</div>`;
  $('#back-res').onclick = () => { rutaSel = null; clearTripMap(); clearBuses(); drawTripContent(); fitPoints([[origen.lng!, origen.lat!], [destino.lng!, destino.lat!]], 15.2); };
  $('#go-viaje').onclick = () => startViaje(r);
  content.querySelectorAll<HTMLElement>('[data-leg]').forEach((b) => (b.onclick = () => fitPoints(r.tramos[+b.dataset.leg!].geom, 16.5)));
}

/* ---------------- Mapa del viaje ---------------- */
let oMarker: maplibregl.Marker | null = null, dMarker: maplibregl.Marker | null = null;
function placeEndpoints() {
  oMarker?.remove(); dMarker?.remove(); oMarker = dMarker = null;
  if (origen.lng !== undefined && origen.texto !== 'Mi ubicación') {
    const el = document.createElement('div'); el.className = 'me-dot o';
    oMarker = new maplibregl.Marker({ element: el }).setLngLat([origen.lng, origen.lat!]).addTo(map);
  }
  if (destino.lng !== undefined) {
    const el = document.createElement('div'); el.className = 'dest-pin'; el.innerHTML = ICON.pin.replace('width="16" height="16"', 'width="34" height="34"');
    dMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([destino.lng, destino.lat!]).addTo(map);
  }
}

function clearTripMap() {
  tripFC = emptyFC(); tripPts = emptyFC();
  (map.getSource('trip') as GeoJSONSource | undefined)?.setData(tripFC);
  (map.getSource('trip-pts') as GeoJSONSource | undefined)?.setData(tripPts);
}

function drawTrip(r: Ruta, fit = true) {
  tripFC = {
    type: 'FeatureCollection',
    features: r.tramos.map((t) => ({
      type: 'Feature' as const, properties: { kind: t.modo, color: t.modo === 'bus' ? lineColor(t.linea!.codigo, theme) : '#0a84ff' },
      geometry: { type: 'LineString' as const, coordinates: t.geom },
    })),
  };
  tripPts = {
    type: 'FeatureCollection',
    features: r.tramos.filter((t) => t.modo === 'bus').flatMap((t) => [t.desde, t.hasta].map((p) => ({
      type: 'Feature' as const, properties: { color: lineColor(t.linea!.codigo, theme) }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    }))),
  };
  (map.getSource('trip') as GeoJSONSource | undefined)?.setData(tripFC);
  (map.getSource('trip-pts') as GeoJSONSource | undefined)?.setData(tripPts);
  if (fit) fitPoints(r.tramos.flatMap((t) => t.geom), 16);
}

async function selectRuta(r: Ruta) {
  rutaSel = r; tripEta.clear(); clearBuses();
  drawTrip(r); drawTripContent();
  if (isMobile()) setSnap('half');
  // Próximos colectivos en cada subida: arribos en vivo + posición estimada en 3D
  const tasks = r.tramos.map(async (t, i) => {
    if (t.modo !== 'bus' || !t.desde.parada || !t.linea) return;
    const idx = idxOf(t.linea.id, t.linea.idEmpresa);
    try {
      const [data, l] = await Promise.all([arribos(t.desde.parada, t.linea.nombre), idx ? loadLinea(idx.file) : Promise.resolve(null)]);
      if (rutaSel !== r) return;
      const x = data.find((d) => d.linea.id === t.linea!.id && d.linea.idEmpresa === t.linea!.idEmpresa);
      const list = x?.arribos ?? [];
      if (list.length) {
        const a = list[0];
        const live = a.tipo.toLowerCase() !== 'programado';
        const f = frecuencia(list);
        tripEta.set(i, `${live ? '<span class="pill live">en vivo</span>' : '<span class="pill prog">programado</span>'} Próximo: <b>${a.arriboEnMinutos < 60 ? fmtMin(a.arriboEnMinutos) : a.horaArribo}</b>${list[1] ? ` · luego ${list[1].arriboEnMinutos < 60 ? fmtMin(list[1].arriboEnMinutos) : list[1].horaArribo}` : ''}${f ? `<br>Pasa cada ~${f} min` : ''}`);
      } else tripEta.set(i, '<span class="pill prog">sin arribos informados</span>');
      if (l) {
        const routes = [l.ida.flat(), l.vuelta.flat()] as LL[][];
        const found: BusView[] = [];
        for (const a of list.slice(0, 3)) {
          if (a.tipo.toLowerCase() === 'programado' || a.arriboEnMinutos > 25) continue;
          const e = estimate(routes, [t.desde.lng, t.desde.lat], a.arriboEnMinutos);
          if (e) found.push({ ...e, key: `${i}-${found.length}`, codigo: t.linea!.codigo, color: lineColor(t.linea!.codigo, theme), estimado: true, anchor: { routes, stop: [t.desde.lng, t.desde.lat], etaAt: Date.now() + a.arriboEnMinutos * 60000 } });
        }
        addBuses(found);
      }
    } catch (e) { console.warn('arribos del tramo', e); }
  });
  await Promise.allSettled(tasks);
  if (rutaSel === r && !sug) drawDetalle(r);
}

/* ---------------- Viaje en curso ---------------- */
interface Alt { ruta: Ruta; delta: number }
interface Viaje {
  ruta: Ruta; i: number; abordo: boolean; gps: LL | null; delayMs: number;
  etaBoard: number | null; etaBoardLive: boolean; etaAlight: number | null;
  alts: Alt[]; replanned: boolean; follow: boolean; watch: number | null; lastReplan: number;
  timer: number; fin: boolean; gpsError: boolean; busy: boolean; preview: Ruta | null;
}
let viaje: Viaje | null = null;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const lineaCache = new Map<string, Promise<Linea | null>>();
const lineaDe = (id: string, emp: string) => {
  const k = `${id}-${emp}`;
  if (!lineaCache.has(k)) { const ix = idxOf(id, emp); lineaCache.set(k, ix ? loadLinea(ix.file).catch(() => null) : Promise.resolve(null)); }
  return lineaCache.get(k)!;
};
const firma = (r: Ruta) => r.tramos.filter((x) => x.modo === 'bus').map((x) => `${x.linea!.nombre}@${x.desde.parada ?? ''}`).join('>');

function startViaje(r: Ruta) {
  stopViaje(false);
  const v: Viaje = {
    ruta: r, i: 0, abordo: false, gps: null, delayMs: 0, etaBoard: null, etaBoardLive: false, etaAlight: null,
    alts: [], replanned: false, follow: true, watch: null, lastReplan: 0, timer: 0, fin: false, gpsError: false, busy: false, preview: null,
  };
  viaje = v; sug = null; rutaSel = r;
  drawTrip(r, true);
  if (navigator.geolocation) {
    v.watch = navigator.geolocation.watchPosition(
      (p) => onPos([p.coords.longitude, p.coords.latitude]),
      () => { v.gpsError = true; if (v.watch !== null) navigator.geolocation.clearWatch(v.watch); v.watch = null; renderViaje(true); },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 },
    );
  } else v.gpsError = true;
  v.timer = window.setInterval(pollViaje, 20000);
  renderViaje();
  pollViaje();
  if (isMobile()) setSnap('half');
}

function stopViaje(redraw = true) {
  const v = viaje;
  if (!v) return;
  clearInterval(v.timer);
  if (v.watch !== null) navigator.geolocation.clearWatch(v.watch);
  viaje = null; clearBuses();
  if (redraw) { renderHome(); if (rutaSel) drawTrip(rutaSel, false); }
}

function avanzar() {
  const v = viaje;
  if (!v) return;
  v.i++; v.abordo = false; v.etaBoard = null; v.etaAlight = null; v.preview = null;
  if (v.i >= v.ruta.tramos.length) { v.fin = true; clearBuses(); }
  else pollViaje();
  renderViaje(true);
}

function onPos(ll: LL) {
  const v = viaje;
  if (!v) return;
  v.gps = ll; setMe(ll);
  const t = v.ruta.tramos[v.i];
  if (t && !v.fin) {
    const aHasta = dist(ll, [t.hasta.lng, t.hasta.lat]);
    if (t.modo === 'walk' && aHasta < 35) { avanzar(); return; }
    if (t.modo === 'bus' && !v.abordo && dist(ll, [t.desde.lng, t.desde.lat]) > 220) { v.abordo = true; v.etaAlight = null; }
    else if (t.modo === 'bus' && v.abordo && aHasta < 70) { avanzar(); return; }
  }
  if (v.follow && !v.fin) map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), 16), duration: 900 });
  if (v.abordo) mostrarMiBus();
  renderViaje(true);
}

/** Cuando vas a bordo, el colectivo 3D sos vos: se dibuja en tu posición GPS. */
async function mostrarMiBus() {
  const v = viaje;
  const t = v?.ruta.tramos[v.i];
  if (!v || !v.gps || !t?.linea) return;
  const l = await lineaDe(t.linea.id, t.linea.idEmpresa);
  if (viaje !== v) return;
  const routes = l ? ([l.ida.flat(), l.vuelta.flat()] as LL[][]) : [];
  setBuses([{ lng: v.gps[0], lat: v.gps[1], heading: routes.length ? headingNear(routes, v.gps) : 0, key: 'yo', codigo: t.linea.codigo, color: lineColor(t.linea.codigo, theme), estimado: false }]);
}

/** Hora de llegada estimada con los datos en vivo (si los hay) o la prevista. */
function llegadaEstimada(v: Viaje): number {
  const now = Date.now();
  if (v.abordo && v.etaAlight !== null) {
    const resto = v.ruta.tramos.slice(v.i + 1).reduce((a, t) => a + t.dur * 1000, 0);
    return now + v.etaAlight * 60000 + resto;
  }
  return v.ruta.finMs + Math.max(-120000, v.delayMs);
}

async function pollViaje() {
  const v = viaje;
  if (!v || v.fin || v.busy || document.hidden) return;
  v.busy = true;
  try {
    const now = Date.now();
    const bi = v.ruta.tramos.findIndex((t, k) => k >= v.i && t.modo === 'bus');
    if (bi >= 0) {
      const t = v.ruta.tramos[bi];
      const viajando = v.abordo && bi === v.i;
      const stopId = viajando ? t.hasta.parada : t.desde.parada;
      if (stopId && t.linea) {
        const data = await arribos(stopId, t.linea.nombre).catch(() => null);
        if (viaje !== v) return;
        const x = data?.find((d) => d.linea.id === t.linea!.id && d.linea.idEmpresa === t.linea!.idEmpresa);
        const list = x?.arribos ?? [];
        if (viajando) {
          const esperado = (t.finMs - now) / 60000;
          const a = list.reduce<Arribo | null>((b, c) => (!b || Math.abs(c.arriboEnMinutos - esperado) < Math.abs(b.arriboEnMinutos - esperado) ? c : b), null);
          v.etaAlight = a && Math.abs(a.arriboEnMinutos - esperado) < 15 ? a.arriboEnMinutos : null;
        } else if (list.length) {
          // sólo cuentan los colectivos que se llegan a tomar caminando hasta la parada
          const caminar = v.ruta.tramos.slice(v.i, bi).reduce((s, w) => s + w.dur, 0);
          const a = list.find((q) => q.arriboEnMinutos * 60 >= caminar * 0.8) ?? list[list.length - 1];
          v.etaBoard = a.arriboEnMinutos; v.etaBoardLive = a.tipo.toLowerCase() !== 'programado';
          // Un atraso sólo es verosímil si el arribo informado está cerca de lo que planificó el recorrido;
          // si no (p. ej. de madrugada, con el próximo servicio a horas) se ignora en vez de inventar un atraso enorme.
          const dMs = now + a.arriboEnMinutos * 60000 - t.inicioMs;
          v.delayMs = Math.abs(dMs) <= (v.etaBoardLive ? 45 : 20) * 60000 ? dMs : 0;
          const l = await lineaDe(t.linea.id, t.linea.idEmpresa);
          if (viaje === v && l) {
            const routes = [l.ida.flat(), l.vuelta.flat()] as LL[][];
            const stop: LL = [t.desde.lng, t.desde.lat];
            const found: BusView[] = [];
            for (const q of list.slice(0, 3)) {
              if (q.tipo.toLowerCase() === 'programado' || q.arriboEnMinutos > 25) continue;
              const e = estimate(routes, stop, q.arriboEnMinutos);
              if (e) found.push({ ...e, key: `v${found.length}`, codigo: t.linea.codigo, color: lineColor(t.linea.codigo, theme), estimado: true, anchor: { routes, stop, etaAt: Date.now() + q.arriboEnMinutos * 60000 } });
            }
            setBuses(found);
          }
        } else { v.etaBoard = null; }
      }
    }
    if (viaje === v && !v.abordo && now - v.lastReplan > 55000) await replanear(v);
  } finally { v.busy = false; }
  if (viaje) renderViaje(true);
}

/** Vuelve a consultar el planificador desde donde estás para ver si hay algo mejor o equivalente. */
async function replanear(v: Viaje) {
  v.lastReplan = Date.now();
  const t = v.ruta.tramos[v.i];
  if (!t || destino.lng === undefined) return;
  const o = v.gps ? { lng: v.gps[0], lat: v.gps[1] } : { lng: t.desde.lng, lat: t.desde.lat };
  try {
    const rs = await planificar(o, { lng: destino.lng, lat: destino.lat! }, undefined, 10); // más cuadras: admite caminar algo más
    if (viaje !== v) return;
    const actual = llegadaEstimada(v), mia = firma(v.ruta);
    v.alts = rs.filter((r) => firma(r) !== mia)
      .map((r) => ({ ruta: r, delta: Math.round((r.finMs - actual) / 60000) }))
      .filter((a) => a.delta <= 10)
      .sort((a, b) => a.ruta.finMs - b.ruta.finMs).slice(0, 3);
    v.replanned = true;
  } catch { /* se reintenta en el próximo ciclo */ }
}

function cambiarRuta(r: Ruta) {
  const gps = viaje?.gps ?? null;
  stopViaje(false);
  startViaje(r);
  if (viaje && gps) viaje.gps = gps;
}

function instruccion(v: Viaje): { titulo: string; sub: string; eta: string } {
  if (v.fin) return { titulo: '¡Llegaste a tu destino!', sub: destino.texto, eta: '' };
  const t = v.ruta.tramos[v.i];
  const now = Date.now();
  const nombre = (p: { nombre: string }) => (p.nombre === 'Destino' ? 'tu destino' : p.nombre);
  if (t.modo === 'walk') {
    const resto = v.gps ? dist(v.gps, [t.hasta.lng, t.hasta.lat]) : t.dist;
    const seg = t.dist > 0 ? t.dur * Math.min(1, resto / t.dist) : t.dur;
    return { titulo: `Caminá hasta ${nombre(t.hasta)}`, sub: `${fmtDist(resto)} · unos ${fmtDur(seg)}`, eta: '' };
  }
  if (!v.abordo) {
    return {
      titulo: `Esperá el ${t.linea!.nombre}`, sub: `Subí en ${t.desde.nombre}`,
      eta: v.etaBoard === null ? 'Sin datos de arribo por ahora' : `${v.etaBoardLive ? '<span class="pill live">en vivo</span>' : '<span class="pill prog">programado</span>'} llega en <b>${fmtMin(v.etaBoard)}</b>`,
    };
  }
  const prev = Math.max(0, (t.finMs - now) / 60000);
  return {
    titulo: `Viajás en el ${t.linea!.nombre}`, sub: `Bajá en ${t.hasta.nombre}`,
    eta: v.etaAlight !== null ? `<span class="pill live">en vivo</span> llegás a la parada en <b>~${fmtMin(v.etaAlight)}</b>` : `<span class="pill prog">según horario</span> llegás a la parada en <b>~${fmtMin(Math.round(prev))}</b>`,
  };
}

function renderViaje(soft = false) {
  const v = viaje;
  if (!v) return;
  const st = content.scrollTop;
  const ins = instruccion(v);
  const llegada = llegadaEstimada(v);
  const dif = Math.round((llegada - v.ruta.finMs) / 60000);
  const estado = dif >= 2 ? `<span class="bad">+${dif} min respecto de lo previsto</span>` : dif <= -2 ? `<span class="good">${-dif} min antes de lo previsto</span>` : '<span class="good">en horario</span>';
  const t = v.ruta.tramos[Math.min(v.i, v.ruta.tramos.length - 1)];

  head.innerHTML = `
    <div class="vhead"><div class="vt"><small>Viaje en curso</small><b>Hacia ${esc(destino.texto)}</b></div>
      ${v.fin ? '' : shareBtns('eta', true)}<button class="btn sm danger" id="fin-viaje">Terminar</button></div>
    <div class="vprog">${v.ruta.tramos.map((x, k) => `<i class="${k < v.i || v.fin ? 'done' : k === v.i ? 'cur' : ''} ${x.modo}"></i>`).join('')}</div>`;

  // aviso principal: atraso / mejor opción / al mismo tiempo
  const mejor = v.alts[0];
  const atraso = !v.abordo && v.etaBoard !== null && v.delayMs !== 0 ? Math.round(v.delayMs / 60000) : 0;
  let aviso = '';
  if (!v.fin && !v.abordo) {
    if (mejor && mejor.delta <= -3) aviso = `<div class="banner better"><b>Hay una opción mejor</b>Llegás ${-mejor.delta} min antes con ${esc(mejor.ruta.denom)}${mejor.ruta.caminata > v.ruta.caminata + 50 ? ` (caminás ${fmtDist(mejor.ruta.caminata - v.ruta.caminata)} más)` : ''}.</div>`;
    else if (atraso >= 4) aviso = `<div class="banner warn"><b>Tu colectivo viene ~${atraso} min atrasado</b>${mejor ? 'Mirá las alternativas de abajo.' : 'No encontré una alternativa mejor por ahora.'}</div>`;
    else if (v.alts.some((a) => Math.abs(a.delta) <= 3)) aviso = `<div class="banner same"><b>Al mismo tiempo</b>Hay otras opciones que llegan casi a la misma hora (±3 min) si preferís no esperar.</div>`;
    else if (v.replanned) aviso = `<div class="banner ok"><b>Tu ruta sigue siendo la mejor</b>La revisé hace instantes con datos en vivo.</div>`;
  }

  const accion = v.fin ? '' : t.modo === 'walk' ? `<button class="btn" id="v-next">Ya llegué</button>` : !v.abordo ? `<button class="btn" id="v-next">Ya subí</button>` : `<button class="btn" id="v-next">Ya bajé</button>`;

  const alts = v.alts.length && !v.abordo && !v.fin ? `<div class="sec">Otras opciones ahora</div>` + v.alts.map((a, k) => {
    const tag = Math.abs(a.delta) <= 3 ? '<em class="tg same">Al mismo tiempo</em>' : a.delta < 0 ? `<em class="tg good">${-a.delta} min antes</em>` : `<em class="tg late">${a.delta} min más tarde</em>`;
    const extra = a.ruta.caminata - v.ruta.caminata;
    const lines = a.ruta.tramos.map((x, j) => (x.modo === 'walk' ? `${j ? '<span class="arrow">›</span>' : ''}<span class="wk">${ICON.walk}${Math.max(1, Math.round(x.dur / 60))}′</span>` : `${j ? '<span class="arrow">›</span>' : ''}${badge({ codigo: x.linea!.codigo }, false, true)}`)).join('');
    return `<div class="alt ${v.preview === a.ruta ? 'on' : ''}" data-a="${k}">
      <div class="tt"><b>Llegás ${hhmm(a.ruta.finMs)}</b>${tag}</div>
      <div class="legs">${lines}</div>
      <div class="ts">${fmtDur(a.ruta.dur)} · caminás ${fmtDist(a.ruta.caminata)}${Math.abs(extra) > 50 ? ` (${extra > 0 ? '+' : '−'}${fmtDist(Math.abs(extra))} que tu ruta)` : ''}</div>
      ${v.preview === a.ruta ? `<button class="btn sm" data-take="${k}">Tomar esta opción</button>` : ''}
    </div>`;
  }).join('') : '';

  const iBus = v.ruta.tramos.findIndex((q) => q.modo === 'bus');
  const pasos = v.ruta.tramos.map((x, k) => {
    const s = k < v.i || v.fin ? 'done' : k === v.i ? 'cur' : '';
    const txt = x.modo === 'walk' ? `Caminá ${fmtDur(x.dur)} hasta ${x.hasta.nombre === 'Destino' ? 'tu destino' : esc(x.hasta.nombre)}` : `Tomá el ${esc(x.linea!.nombre)} · bajá en ${esc(x.hasta.nombre)}`;
    return `<div class="vstep ${s}"><span class="dot"></span><span>${txt}</span><em>${hhmm(x.inicioMs + (k >= iBus ? Math.max(-120000, v.delayMs) : 0))}</em></div>`;
  }).join('');

  content.innerHTML = `
    <div class="vhero ${v.fin ? 'fin' : ''}">
      <small>${v.fin ? 'Viaje terminado' : t.modo === 'walk' ? 'Ahora · a pie' : v.abordo ? 'Ahora · a bordo' : 'Ahora · en la parada'}</small>
      <h2>${esc(ins.titulo)}</h2><p>${esc(ins.sub)}</p>
      ${ins.eta ? `<div class="eta2">${ins.eta}</div>` : ''}
      ${accion}
    </div>
    <div class="vstats">
      <div><small>Llegás</small><b>${hhmm(llegada)}</b></div>
      <div><small>Previsto</small><b>${hhmm(v.ruta.finMs)}</b></div>
      <div class="wide">${estado}</div>
    </div>
    ${aviso}${alts}
    <div class="sec">Tu recorrido</div><div class="vsteps">${pasos}</div>
    <div class="note pad">${v.gps ? 'Siguiendo tu ubicación: los pasos avanzan solos.' : v.gpsError ? 'Sin acceso al GPS: avanzá los pasos con los botones.' : 'Esperando señal de GPS…'} Los tiempos en vivo se actualizan cada 20 s; las alternativas, cada minuto.</div>`;

  $('#fin-viaje').onclick = () => stopViaje();
  document.getElementById('v-next')?.addEventListener('click', () => {
    if (t.modo === 'bus' && !v.abordo) { v.abordo = true; v.etaAlight = null; mostrarMiBus(); renderViaje(true); pollViaje(); }
    else avanzar();
  });
  content.querySelectorAll<HTMLElement>('[data-a]').forEach((el) => (el.onclick = (e) => {
    if ((e.target as HTMLElement).closest('[data-take]')) return;
    const a = v.alts[+el.dataset.a!];
    v.preview = v.preview === a.ruta ? null : a.ruta;
    drawTrip(v.preview ?? v.ruta, true);
    renderViaje(true);
  }));
  content.querySelectorAll<HTMLElement>('[data-take]').forEach((b) => (b.onclick = () => cambiarRuta(v.alts[+b.dataset.take!].ruta)));
  if (soft) content.scrollTop = st;
}

/* ---------------- Colectivos (3D + etiqueta) ---------------- */
function paintBuses() {
  busFC = { type: 'FeatureCollection', features: busFeatures(busList, map.getZoom()) };
  (map.getSource('buses3d') as GeoJSONSource | undefined)?.setData(busFC);
}
function syncBusMarkers() {
  const keys = new Set(busList.map((b) => b.key));
  for (const [k, m] of busMarkers) if (!keys.has(k)) { m.remove(); busMarkers.delete(k); }
  for (const b of busList) {
    let m = busMarkers.get(b.key);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'bus-tag'; el.innerHTML = `<b></b>`;
      m = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -16] }).setLngLat([b.lng, b.lat]).addTo(map);
      busMarkers.set(b.key, m);
    }
    m.setLngLat([b.lng, b.lat]);
    const el = m.getElement();
    el.style.setProperty('--c', b.color);
    el.classList.toggle('est', b.estimado);
    el.title = b.estimado ? 'Posición estimada a partir de los arribos en vivo' : 'Posición GPS';
    el.firstElementChild!.textContent = b.codigo;
  }
}
function setBuses(list: BusView[]) { busList = list; paintBuses(); syncBusMarkers(); }
function addBuses(list: BusView[]) { setBuses([...busList, ...list]); }
function clearBuses() { setBuses([]); }
function recolorBuses() {
  busList = busList.map((b) => ({ ...b, color: lineColor(b.codigo, theme) }));
  paintBuses(); syncBusMarkers();
}

/* ---------------- Vista de línea ---------------- */
function renderLinea() {
  const l = linea!;
  head.innerHTML = `
    <div class="lhead">
      <button class="iconbtn" id="back" aria-label="Volver">${ICON.back}</button>
      ${badge(l, true)}
      <div class="info"><b>${esc(l.nombre)}</b><span>${esc(empresaNombre(l.empresa))} · ${l.stops.length} paradas</span></div>
      ${shareBtns('linea', true)}
    </div>
    <div class="seg" role="group" aria-label="Sentido">
      ${(['ida', 'vuelta', 'ambas'] as const).map((d) => `<button data-d="${d}" aria-pressed="${direccion === d}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}
    </div>
    <div class="live" id="live"></div>`;
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
    : liveState.n ? `<b>${liveState.n} ${liveState.n === 1 ? 'colectivo' : 'colectivos'}</b> en el mapa · posición estimada, se mueve en vivo <span class="ago">· actualizado hace ${Math.max(0, Math.round((Date.now() - liveState.when) / 1000))} s</span>`
    : liveState.eta ? `<b>Servicio con GPS</b> · arribos actualizados en vivo <span class="ago">· hace ${Math.max(0, Math.round((Date.now() - liveState.when) / 1000))} s</span>`
    : 'Sin datos de GPS ahora · se muestran horarios programados'}</span>`;
}

const fmtArribo = (a: Arribo) => {
  const live = esEnVivo(a) || a.tipo.toLowerCase() !== 'programado';
  const t = a.arriboEnMinutos <= 0 ? 'Ahora' : a.arriboEnMinutos < 60 ? `${a.arriboEnMinutos} min` : a.horaArribo;
  return live ? `<span class="pill live">${t}</span>` : `<span class="pill prog" title="Horario programado">${t}</span>`;
};

/** Intervalo medio (min) entre los próximos arribos informados. Null si hay menos de dos. */
function frecuencia(list: Arribo[]): number | null {
  const d: number[] = [];
  for (let i = 1; i < list.length; i++) {
    const g = list[i].arriboEnMinutos - list[i - 1].arriboEnMinutos;
    if (g > 0) d.push(g);
  }
  return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
}

/** Resumen de frecuencia y espera para la línea abierta en la parada seleccionada. */
function frecuenciaResumen(x: ArriboLinea | undefined): string {
  if (!x || !x.arribos.length) return '';
  const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const f = frecuencia(x.arribos);
  const prox = x.arribos[0];
  const live = x.arribos.some((a) => a.tipo.toLowerCase() !== 'programado');
  const franja = f === null ? '' : f <= 8 ? 'frecuencia alta' : f <= 15 ? 'frecuencia media' : f <= 25 ? 'frecuencia baja' : 'servicio espaciado';
  if (f === null) {
    return `<div class="freq"><div><small>Próximo</small><b>${fmtMin(prox.arriboEnMinutos)}</b></div><div class="note flat">Sólo hay un arribo informado, no alcanza para calcular la frecuencia (${hora}).</div></div>`;
  }
  return `<div class="freq">
    <div><small>Próximo</small><b>${fmtMin(prox.arriboEnMinutos)}</b></div>
    <div><small>Frecuencia</small><b>cada ~${f} min</b></div>
    <div><small>Espera promedio</small><b>~${Math.max(1, Math.round(f / 2))} min</b></div>
  </div>
  <div class="note flat">${franja[0].toUpperCase() + franja.slice(1)} a las ${hora} · calculada con los próximos ${x.arribos.length} arribos ${live ? '(ajustados por GPS)' : '(horario programado)'}. Cambia según la hora del día.</div>`;
}

function stopCard(): string {
  if (!parada) return '';
  let body: string;
  if (paradaError) body = `<div class="note">No se pudieron cargar los arribos. Reintentando…</div>`;
  else if (!paradaData) body = `<div class="note">Consultando arribos…</div>`;
  else if (!paradaData.length) body = `<div class="note">No hay arribos informados para esta parada.</div>`;
  else {
    const mine = (x: ArriboLinea) => !!linea && x.linea.id === linea.id && x.linea.idEmpresa === linea.idEmpresa;
    const sorted = [...paradaData].sort((a, b) => Number(mine(b)) - Number(mine(a)));
    body = frecuenciaResumen(sorted.find(mine)) + sorted.map((x) => {
      const idx = idxOf(x.linea.id, x.linea.idEmpresa);
      const bd = badge({ codigo: x.linea.codigoEMR || x.linea.nombreCorto });
      const times = x.arribos.slice(0, 3).map(fmtArribo).join('') || '<span class="pill prog">—</span>';
      const f = frecuencia(x.arribos);
      return `<div class="arr ${mine(x) ? 'me' : ''}">${idx && !mine(x) ? `<button class="badge-btn" data-f="${idx.file}" style="display:contents">${bd}</button>` : bd}<span class="nm"><span style="font-size:13px;font-weight:${mine(x) ? 650 : 500}">${esc(x.linea.nombre)}</span>${f ? `<small class="fq">cada ~${f} min</small>` : ''}</span><span class="times">${times}</span></div>`;
    }).join('') + `<div class="note"><span class="pill live" style="font-size:11px;padding:1px 6px">en vivo</span> con GPS · <span class="pill prog" style="font-size:11px;padding:1px 6px">hora</span> programado</div>`;
  }
  return `<div class="card">
    <div class="top"><div><h3>${esc(parada.nombre)}</h3><div class="sub">${esc(parada.desc || 'Parada')} · próximos arribos</div></div>
    ${shareBtns('parada', true)}<button class="iconbtn" id="close-stop" aria-label="Cerrar parada">${ICON.close}</button></div>${body}</div>`;
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

async function openLinea(file: string, stopId?: string) {
  const l = await loadLinea(file);
  linea = l; parada = null; paradaData = null; direccion = 'ambas';
  stopLive(); clearBuses(); clearTripMap(); oMarker?.remove(); dMarker?.remove();
  liveState = { n: 0, eta: 0, checked: false, when: 0 };
  refreshSources(); fitLinea();
  renderLinea();
  if (isMobile()) setSnap('half');
  syncLinea(file); // [share]
  startLive();
  if (stopId) { const p = l.stops.find((s) => s.id === stopId); if (p) selectStop(p, true); }
}

function closeLinea() {
  linea = null; parada = null; paradaData = null;
  stopLive(); clearBuses(); clearInterval(stopTimer);
  refreshSources();
  leaveLinea(); // [share]
  renderHome();
  placeEndpoints();
  if (rutaSel) drawTrip(rutaSel, false);
}

function selectStop(p: Parada, fly: boolean) {
  parada = p; paradaData = null; paradaError = false;
  if (linea) syncLinea(linea.file, p.id); // [share]
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
  if (linea) syncLinea(linea.file); // [share]
  if (map.getLayer('stops-sel')) map.setFilter('stops-sel', ['==', ['get', 'id'], '']);
  drawBody();
}

/* ------------------------------------------------------------------ colectivos de la línea abierta */
function sampleStops(stops: Parada[], n = 10): Parada[] {
  if (stops.length <= n) return stops;
  return Array.from({ length: n }, (_, i) => stops[Math.round((i * (stops.length - 1)) / (n - 1))]);
}

/** Reutiliza la clave del colectivo más cercano de la lista anterior para que el marcador no "salte". */
function reuseKeys<T extends Est>(nuevos: T[], viejos: BusView[], prefix: string): (T & { key: string })[] {
  const usados = new Set<string>();
  return nuevos.map((n, i) => {
    let best: BusView | null = null, bd = 450;
    for (const o of viejos) {
      if (usados.has(o.key) || !o.key.startsWith(prefix)) continue;
      const d = dist([o.lng, o.lat], [n.lng, n.lat]);
      if (d < bd) { bd = d; best = o; }
    }
    const key = best ? best.key : `${prefix}${Date.now().toString(36)}${i}`;
    usados.add(key);
    return { ...n, key };
  });
}

async function pollLive() {
  const l = linea;
  if (!l || document.hidden) return;
  const routes = [l.ida.flat(), l.vuelta.flat()] as LL[][];
  const res = await Promise.allSettled(sampleStops(l.stops).map((s) => arribos(s.id, l.nombre).then((r) => ({ s, r }))));
  if (linea !== l) return; // cambió de línea mientras esperábamos
  let eta = 0;
  const real: Est[] = [], est: (Est & { anchor: Anchor })[] = [];
  const t0 = Date.now();
  for (const o of res) {
    if (o.status !== 'fulfilled') continue;
    for (const x of o.value.r) {
      if (x.linea.id !== l.id || x.linea.idEmpresa !== l.idEmpresa) continue;
      for (const a of x.arribos) {
        if (a.tipo.toLowerCase() === 'programado') continue;
        eta++;
        if (esEnVivo(a)) { const p: LL = [a.longitud, a.latitud]; real.push({ lng: p[0], lat: p[1], heading: headingNear(routes, p) }); continue; }
        if (a.arriboEnMinutos > 25) continue;
        const stop: LL = [o.value.s.lng, o.value.s.lat];
        const e = estimate(routes, stop, a.arriboEnMinutos);
        if (e) est.push({ ...e, anchor: { routes, stop, etaAt: t0 + a.arriboEnMinutos * 60000 } });
      }
    }
  }
  const color = lineColor(l.codigo, theme);
  const estUniq = dedupe(est).filter((e) => !real.some((r) => Math.hypot(r.lng - e.lng, r.lat - e.lat) < 0.001));
  const nuevos = [
    ...reuseKeys(real, busList, 'r').map((e) => ({ ...e, estimado: false })),
    ...reuseKeys(estUniq, busList, 'e').map((e) => ({ ...e, estimado: true })),
  ];
  setBuses(nuevos.map((e) => ({ ...e, codigo: l.codigo, color })));
  liveState = { n: nuevos.length, eta, checked: true, when: Date.now() };
  drawLive();
}
function startLive() { stopLive(); pollLive(); liveTimer = window.setInterval(pollLive, 20000); }
function stopLive() { clearInterval(liveTimer); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && linea) pollLive(); });

/** Cada segundo avanza los colectivos estimados según el tiempo que pasó desde la última consulta. */
setInterval(() => {
  if (document.hidden) return;
  if (linea && liveState.checked) drawLive();
  if (!busList.some((b) => b.anchor)) return;
  const now = Date.now();
  busList = busList.map((b) => {
    if (!b.anchor) return b;
    const e = estimate(b.anchor.routes, b.anchor.stop, Math.max(0, (b.anchor.etaAt - now) / 60000));
    return e ? { ...b, lng: e.lng, lat: e.lat, heading: e.heading } : b;
  });
  paintBuses(); syncBusMarkers();
}, 1000);

/* ------------------------------------------------------------------ arranque */
(async () => {
  index = await loadIndex();
  setSnap('half');
  if (location.hash === '#rutinas') tab = 'rutinas'; // viene de tocar una notificación
  renderHome();
  registrarSW();
  iniciarUbicacionPeriodica();
  // [share] router de enlaces profundos (#linea, #parada, #viaje, #rutinas) + hashchange
  initShare({
    linea: () => linea, parada: () => parada, origen: () => origen, destino: () => destino,
    ruta: () => viaje?.ruta ?? rutaSel,
    viaje: () => (viaje ? { llegadaMs: llegadaEstimada(viaje), fin: viaje.fin } : null),
    hhmm, openLinea, closeLinea, abrirViaje,
    setTab: (t) => { tab = t; sug = null; renderHome(); },
    hayLinea: (file) => index.some((i) => i.file === file),
    fileDe: (id, emp) => idxOf(id, emp)?.file,
  });
  aplicarHash();
})();

(window as unknown as Record<string, unknown>).__viajo = { map, openLinea, selectRuta, pick, get rutas() { return rutas; }, get buses() { return busList; }, startViaje, onPos, get viaje() { return viaje; } };
