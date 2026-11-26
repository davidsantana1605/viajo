// Comodidad en "Viaje en curso": pantalla encendida, avisos de bajada (banner + vibración + voz),
// "te pasaste de parada" y conteo de paradas que faltan. Se engancha desde main.ts (bloques `// [viaje-extras]`).
import './styles/viajeExtras.css';
import type { Linea } from './api';
import type { Tramo } from './trip';
import {
  actualizarPasaste, avisarXParadas, distM, nuevoEstadoPasaste, paradasRestantes, prepararRecorrido, umbralAAvisar,
  type EstadoPasaste, type LL, type Recorrido,
} from './avisosLogica';

/** Lo mínimo que necesitamos del `Viaje` de main.ts (se le pasa el objeto tal cual). */
export interface VistaViaje {
  ruta: { tramos: Tramo[] }; i: number; abordo: boolean; fin: boolean; gps: LL | null;
  etaBoard: number | null; etaBoardLive: boolean;
}
export interface Enganche {
  /** Devuelve la línea (con paradas y trazas) del tramo; en main.ts es `lineaDe`. */
  getLinea: (id: string, idEmpresa: string) => Promise<Linea | null>;
  /** El usuario tocó "Buscar ruta de regreso" tras pasarse de parada. */
  alPasarse: () => void;
}

const LS_VOZ = 'viajo-aviso-voz', LS_X = 'viajo-aviso-paradas';
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } },
};

interface Pierna {
  pasaste: EstadoPasaste; umbrales: Set<number>; recorrido: { rec: Recorrido; poly: LL[] } | null; cargando: boolean;
  restan: { paradas: number; metros: number } | null; xAvisado: boolean;
}

let hooks: Enganche | null = null;
let voz = ls.get(LS_VOZ) === '1';
let xAntes = Number(ls.get(LS_X) ?? '0') || 0;
let piernas = new Map<number, Pierna>();
let avisados = new Set<string>();
let sentinel: WakeLockSentinel | null = null;
let pantalla: 'on' | 'no' | 'off' = 'off'; // on = activa, no = no soportada/denegada
let banner: HTMLElement | null = null;
let bannerTimer = 0;

const pierna = (i: number): Pierna => {
  let p = piernas.get(i);
  if (!p) { p = { pasaste: nuevoEstadoPasaste(), umbrales: new Set(), recorrido: null, cargando: false, restan: null, xAvisado: false }; piernas.set(i, p); }
  return p;
};

/* ---------------- pantalla encendida ---------------- */
async function pedirPantalla() {
  if (sentinel || document.hidden) return;
  if (!('wakeLock' in navigator)) { pantalla = 'no'; return; }
  try {
    sentinel = await navigator.wakeLock.request('screen');
    pantalla = 'on';
    sentinel.addEventListener('release', () => { sentinel = null; if (hooks && !document.hidden) pantalla = 'off'; });
  } catch { pantalla = 'no'; sentinel = null; }
}
const alVolver = () => { if (!document.hidden && hooks) void pedirPantalla(); }; // el navegador lo libera al ocultar la pestaña

/* ---------------- aviso: banner + vibración + voz ---------------- */
function hablar(texto: string) {
  if (!voz || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-AR';
    const vs = speechSynthesis.getVoices();
    const v = vs.find((x) => x.lang.replace('_', '-') === 'es-AR') ?? vs.find((x) => x.lang.toLowerCase().startsWith('es'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* sin voz */ }
}

function quitarBanner() {
  clearTimeout(bannerTimer);
  banner?.remove(); banner = null;
}

function avisar(titulo: string, sub: string, patron: number[], opts: { accion?: { texto: string; fn: () => void }; fijo?: boolean } = {}) {
  quitarBanner();
  const el = document.createElement('div');
  el.className = 'vx-aviso'; el.setAttribute('role', 'alert'); el.setAttribute('aria-live', 'assertive');
  const t = document.createElement('b'), s = document.createElement('span');
  t.textContent = titulo; s.textContent = sub;
  const txt = document.createElement('div'); txt.className = 'vx-txt'; txt.append(t, s);
  const x = document.createElement('button'); x.className = 'vx-x'; x.type = 'button'; x.setAttribute('aria-label', 'Cerrar aviso'); x.textContent = '✕';
  x.onclick = quitarBanner;
  el.append(txt);
  if (opts.accion) {
    const a = document.createElement('button'); a.className = 'vx-act'; a.type = 'button'; a.textContent = opts.accion.texto;
    const fn = opts.accion.fn;
    a.onclick = () => { quitarBanner(); fn(); };
    el.append(a);
  }
  el.append(x);
  document.body.append(el);
  banner = el;
  if (!opts.fijo) bannerTimer = window.setTimeout(quitarBanner, 14000);
  try { navigator.vibrate?.(patron); } catch { /* sin vibración */ }
  hablar(sub ? `${titulo}. ${sub}` : titulo);
}

const unaVez = (k: string) => { if (avisados.has(k)) return false; avisados.add(k); return true; };
const nombreParada = (n: string) => (n === 'Destino' ? 'tu destino' : n);

/* ---------------- recorrido (paradas que faltan) ---------------- */
async function cargarRecorrido(v: VistaViaje, i: number) {
  const p = pierna(i);
  const t = v.ruta.tramos[i];
  if (p.cargando || p.recorrido || !t?.linea || !hooks) return;
  p.cargando = true;
  try {
    const l = await hooks.getLinea(t.linea.id, t.linea.idEmpresa);
    if (!l) return;
    const routes = [l.ida.flat(), l.vuelta.flat()] as LL[][];
    const rec = prepararRecorrido(routes, l.stops, [t.desde.lng, t.desde.lat], [t.hasta.lng, t.hasta.lat]);
    if (rec) p.recorrido = { rec, poly: routes[rec.poly] };
  } catch { /* sin datos de la línea: se sigue sólo con las distancias */ }
  finally { p.cargando = false; }
}

/* ---------------- API para main.ts ---------------- */
export const extras = {
  /** Llamar desde el clic de "Iniciar viaje" (acción del usuario). */
  start(h: Enganche) {
    hooks = h; piernas = new Map(); avisados = new Set();
    document.addEventListener('visibilitychange', alVolver);
    void pedirPantalla();
  },
  stop() {
    hooks = null; piernas = new Map(); avisados = new Set();
    document.removeEventListener('visibilitychange', alVolver);
    quitarBanner();
    try { speechSynthesis?.cancel(); } catch { /* nada */ }
    try { void sentinel?.release(); } catch { /* nada */ }
    sentinel = null; pantalla = 'off';
  },

  /** Cada fix de GPS. */
  pos(v: VistaViaje) {
    if (!hooks || v.fin || !v.gps) return;
    const t = v.ruta.tramos[v.i];
    if (!t) return;
    const gps = v.gps;
    if (t.modo === 'walk') {
      const sig = v.ruta.tramos[v.i + 1];
      if (sig?.modo === 'bus' && distM(gps, [t.hasta.lng, t.hasta.lat]) < 100 && unaVez(`${v.i}:subida`)) {
        avisar('Ya casi llegás a la parada de subida', `${nombreParada(t.hasta.nombre)} · te espera el ${sig.linea?.nombre ?? 'colectivo'}`, [250, 100, 250]);
      }
      return;
    }
    if (!v.abordo) return;

    const p = pierna(v.i);
    const d = distM(gps, [t.hasta.lng, t.hasta.lat]);
    const parada = nombreParada(t.hasta.nombre);
    if (!p.recorrido) void cargarRecorrido(v, v.i);
    else p.restan = paradasRestantes(p.recorrido.rec, p.recorrido.poly, gps);

    // 1) te pasaste (se evalúa antes: si ya pasó, no tiene sentido avisar "bajás pronto")
    const r = actualizarPasaste(p.pasaste, d);
    p.pasaste = r.estado;
    if (r.nuevo) {
      avisar('Te pasaste de tu parada', `Ibas a bajar en ${parada}. Te muestro cómo volver.`, [600, 200, 600], { fijo: true, accion: { texto: 'Buscar ruta de regreso', fn: () => hooks?.alPasarse() } });
      return;
    }
    if (p.pasaste.pasado) return;

    // 2) umbrales de distancia
    const u = umbralAAvisar(d, p.umbrales);
    if (u === 400) avisar(`Bajás en unos 400 m: ${parada}`, `Andá preparándote${p.restan ? ` · faltan ~${p.restan.paradas} paradas` : ''}`, [200]);
    else if (u === 200) avisar(`Bajás en la próxima parada: ${parada}`, 'Pedí la parada y acercate a la puerta', [200, 100, 200]);
    else if (u === 80) avisar(`¡Bajá ahora! ${parada}`, 'Es la próxima parada', [400, 150, 400, 150, 400]);
    else if (avisarXParadas(xAntes, p.restan?.paradas ?? null, p.xAvisado)) {
      p.xAvisado = true;
      avisar(`Faltan ${p.restan!.paradas} paradas para bajar`, `Tu parada: ${parada}`, [250, 100, 250]);
    }
    if (p.restan && p.restan.paradas <= xAntes) p.xAvisado = true; // no avisar tarde si ya estaba más cerca al activarlo
  },

  /** Después de cada consulta de arribos en vivo. */
  eta(v: VistaViaje) {
    if (!hooks || v.fin) return;
    const bi = v.ruta.tramos.findIndex((q, k) => k >= v.i && q.modo === 'bus');
    if (bi < 0 || (bi === v.i && v.abordo)) return;
    if (v.etaBoard !== null && v.etaBoardLive && v.etaBoard <= 2 && unaVez(`${bi}:llega`)) {
      avisar('Tu colectivo está por llegar', `${v.ruta.tramos[bi].linea?.nombre ?? ''} · ${v.etaBoard <= 0 ? 'ahora' : `en ~${v.etaBoard} min`}`, [300, 150, 300]);
    }
  },

  /** Tarjeta de ajustes + estado, para insertar en el panel del viaje. */
  panelHTML(v: VistaViaje): string {
    if (!hooks || v.fin) return '';
    const p = piernas.get(v.i);
    const meta: string[] = [];
    if (v.abordo && p?.restan) meta.push(`Faltan ~${p.restan.paradas} ${p.restan.paradas === 1 ? 'parada' : 'paradas'} (${p.restan.metros < 1000 ? `${Math.round(p.restan.metros / 10) * 10} m` : `${(p.restan.metros / 1000).toFixed(1).replace('.', ',')} km`})`);
    meta.push(pantalla === 'on' ? 'Pantalla encendida durante el viaje' : pantalla === 'no' ? 'Tu navegador no deja mantener la pantalla encendida' : '');
    const x = (n: number, t: string) => `<option value="${n}" ${xAntes === n ? 'selected' : ''}>${t}</option>`;
    return `<div class="vx-card">
      <div class="vx-row"><span id="vx-l1">Avisos por voz</span><label class="switch"><input type="checkbox" id="vx-voz" aria-labelledby="vx-l1" ${voz ? 'checked' : ''}><i></i></label></div>
      <div class="vx-row"><label for="vx-x">Avisarme antes de bajar</label><select id="vx-x">${x(0, 'Sólo en la parada')}${x(2, '2 paradas antes')}${x(3, '3 paradas antes')}${x(4, '4 paradas antes')}</select></div>
      <div class="vx-meta">${meta.filter(Boolean).join(' · ')}<br>Aviso de bajada a ~400, 200 y 80 m (vibra y suena sólo con la app abierta). Las paradas que faltan son una estimación.</div>
    </div>`;
  },
  bindPanel(root: HTMLElement) {
    const c = root.querySelector<HTMLInputElement>('#vx-voz');
    if (c) c.onchange = () => {
      voz = c.checked; ls.set(LS_VOZ, voz ? '1' : '0');
      if (voz) { if ('speechSynthesis' in window) hablar('Avisos por voz activados'); else { c.checked = voz = false; ls.set(LS_VOZ, '0'); alert('Este navegador no tiene voz para los avisos.'); } }
      else { try { speechSynthesis.cancel(); } catch { /* nada */ } }
    };
    const s = root.querySelector<HTMLSelectElement>('#vx-x');
    if (s) s.onchange = () => { xAntes = Number(s.value) || 0; ls.set(LS_X, String(xAntes)); for (const p of piernas.values()) p.xAvisado = false; };
  },
};
