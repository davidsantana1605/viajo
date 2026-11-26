// Pestaña "Rutinas": viajes que repetís (destino, días, hora de llegada) con avisos push.
import { buscarLugares, type Lugar } from './geo';
import { planificar } from './trip';
import { DIAS, DIAS_L, hm, mensaje, momentos, proximaLlegada, recomendar, type Aviso, type Rutina } from './recomendar';
import { activarPush, desactivarPush, enviarPrueba, enviarUbicacion, estadoPush, servidorConfigurado, sincronizar, type EstadoPush } from './push';

export interface Ctx {
  content: HTMLElement;
  isMobile: () => boolean;
  setFull: () => void;
  esc: (s: unknown) => string;
}

const LS_R = 'viajo-rutinas', LS_U = 'viajo-usuario';
/** Lee las rutinas de localStorage validando forma y tipos (el contenido no es de fiar: puede estar manipulado). */
function cargarRutinas(): Rutina[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_R) ?? '[]');
    if (!Array.isArray(v)) return [];
    const txt = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
    const lugar = (x: unknown) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const lng = Number(o.lng), lat = Number(o.lat);
      return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? { nombre: txt(o.nombre, 120) || 'Lugar', lng, lat } : null;
    };
    const out: Rutina[] = [];
    for (const x of v.slice(0, 50)) {
      const o = (x ?? {}) as Record<string, unknown>;
      const destino = lugar(o.destino), origen = lugar(o.origen);
      const llegada = txt(o.llegada, 5);
      if (!destino || !origen || !/^([01]\d|2[0-3]):[0-5]\d$/.test(llegada)) continue;
      const id = txt(o.id, 60).replace(/[^\w-]/g, '') || String(Date.now()) + out.length;
      const dias = Array.isArray(o.dias) ? [...new Set((o.dias as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))] : [];
      const margen = Number(o.margen);
      out.push({ id, nombre: txt(o.nombre, 60) || 'Rutina', destino, origen, usarUbicacion: o.usarUbicacion === true, dias, llegada, margen: Number.isFinite(margen) && margen >= 0 && margen <= 60 ? margen : 10, activa: o.activa !== false });
    }
    return out;
  } catch { return []; }
}
let rutinas: Rutina[] = cargarRutinas();
let usuario = (localStorage.getItem(LS_U) ?? '').slice(0, 40);
let vista: 'lista' | 'form' = 'lista';
let editando: Rutina | null = null;
let ctx: Ctx;
let push: EstadoPush | null = null;
let aviso: { tipo: 'ok' | 'error'; texto: string } | null = null;

const guardar = () => localStorage.setItem(LS_R, JSON.stringify(rutinas));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/** Sube el estado actual al servidor si este dispositivo está suscripto (no hace nada si no). */
async function subir() {
  try { if ((await estadoPush()) === 'activo') await sincronizar(usuario, rutinas); }
  catch (e) { aviso = { tipo: 'error', texto: `No pude sincronizar con el servidor: ${(e as Error).message}` }; }
}

export function renderRutinas(c: Ctx) {
  ctx = c;
  if (vista === 'form') return drawForm();
  drawLista();
  estadoPush().then((e) => { push = e; pintarPush(); });
}

/* ---------------- Lista ---------------- */
function drawLista() {
  const { esc } = ctx;
  const cards = rutinas.map((r) => {
    const dias = r.dias.length === 7 ? 'Todos los días' : r.dias.length === 5 && !r.dias.includes(0) && !r.dias.includes(6) ? 'Lunes a viernes' : [...r.dias].sort().map((d) => DIAS[d]).join(' · ') || 'Sin días';
    return `<div class="rcard ${r.activa ? '' : 'off'}" data-id="${esc(r.id)}">
      <div class="rtop"><div class="rinfo"><b>${esc(r.nombre)}</b><span>${dias} · llegar a las <b>${esc(r.llegada)}</b></span><span>a ${esc(r.destino.nombre)}</span></div>
        <label class="switch" title="Activar o pausar"><input type="checkbox" data-act ${r.activa ? 'checked' : ''}><i></i></label></div>
      <div class="ract"><button class="chip" data-prev>Ver recomendación</button><button class="chip" data-edit>Editar</button><button class="chip del" data-del>Borrar</button></div>
      <div class="rprev" hidden></div>
    </div>`;
  }).join('');
  ctx.content.innerHTML = `
    <div class="pushbox" id="pushbox"></div>
    <div class="sec">Mis rutinas</div>
    ${cards || `<div class="empty small">Todavía no tenés rutinas. Creá una con tu destino, los días que vas y a qué hora querés llegar: te aviso cuándo salir.</div>`}
    <div class="gorow"><button class="btn go" id="nueva">＋ Nueva rutina</button></div>
    <div class="note pad">Avisos: 2 h antes de llegar (con la línea recomendada), 30 min y 15 min antes de que salga el colectivo.</div>`;
  pintarPush();
  ctx.content.querySelector<HTMLElement>('#nueva')!.onclick = () => { editando = null; vista = 'form'; drawForm(); };
  ctx.content.querySelectorAll<HTMLElement>('.rcard').forEach((el) => {
    const r = rutinas.find((x) => x.id === el.dataset.id)!;
    el.querySelector<HTMLInputElement>('[data-act]')!.onchange = (e) => { r.activa = (e.target as HTMLInputElement).checked; guardar(); el.classList.toggle('off', !r.activa); subir(); };
    el.querySelector<HTMLElement>('[data-edit]')!.onclick = () => { editando = r; vista = 'form'; drawForm(); };
    el.querySelector<HTMLElement>('[data-del]')!.onclick = () => { if (confirm(`¿Borrar la rutina «${r.nombre}»?`)) { rutinas = rutinas.filter((x) => x !== r); guardar(); subir(); drawLista(); } };
    el.querySelector<HTMLElement>('[data-prev]')!.onclick = () => vistaPrevia(r, el.querySelector<HTMLElement>('.rprev')!);
  });
}

function pintarPush() {
  const box = document.getElementById('pushbox');
  if (!box || push === null) return;
  const { esc } = ctx;
  const nombre = `<label class="fld inline"><span>Tu nombre para los avisos</span><input id="usuario" type="text" maxlength="40" placeholder="Ej.: David" value="${esc(usuario)}" autocomplete="given-name"></label>`;
  const msg: Record<EstadoPush, string> = {
    activo: '<b class="good">Notificaciones activadas</b> en este dispositivo.',
    inactivo: 'Activá las notificaciones para recibir los avisos de tus rutinas, <b>aunque la app esté cerrada</b>.',
    'sin-servidor': '<b>El servidor de avisos todavía no está configurado.</b> Podés crear rutinas y ver la recomendación, pero no llegarán notificaciones hasta publicarlo (ver README, sección “Rutinas”).',
    'ios-instalar': 'En iPhone/iPad los avisos requieren <b>agregar Viajo a la pantalla de inicio</b> (Compartir → “Agregar a inicio”) y abrirla desde ahí.',
    denegado: 'Bloqueaste las notificaciones. Habilitalas desde los ajustes del navegador para este sitio.',
    'no-soportado': 'Este navegador no soporta notificaciones push.',
  };
  const botones = push === 'activo'
    ? '<button class="btn sm" id="p-test">Enviar prueba</button><button class="btn sm ghost" id="p-off">Desactivar</button>'
    : push === 'inactivo' ? '<button class="btn sm" id="p-on">Activar notificaciones</button>' : '';
  box.innerHTML = `<div class="card"><div class="ptxt">${msg[push]}</div>${nombre}<div class="prow">${botones}</div>
    ${aviso ? `<div class="note flat ${aviso.tipo === 'error' ? 'bad' : 'good'}">${esc(aviso.texto)}</div>` : ''}
    <div class="note flat">Para saber dónde estás, la app le manda tu última ubicación al servidor <b>sólo mientras está abierta</b> (y sólo si lo activás en la rutina). Si no, usa el origen que guardes.</div></div>`;
  const inp = box.querySelector<HTMLInputElement>('#usuario')!;
  inp.onchange = () => { usuario = inp.value.trim(); localStorage.setItem(LS_U, usuario); subir(); };
  const ocupado = (b: HTMLElement, t: string) => { b.setAttribute('disabled', ''); b.textContent = t; };
  const on = box.querySelector<HTMLElement>('#p-on');
  if (on) on.onclick = async () => {
    usuario = inp.value.trim(); localStorage.setItem(LS_U, usuario);
    ocupado(on, 'Activando…');
    try { await activarPush(usuario, rutinas); aviso = { tipo: 'ok', texto: 'Listo: este dispositivo recibirá los avisos.' }; refrescarUbicacion(); }
    catch (e) { aviso = { tipo: 'error', texto: (e as Error).message }; }
    push = await estadoPush(); pintarPush();
  };
  const test = box.querySelector<HTMLElement>('#p-test');
  if (test) test.onclick = async () => {
    ocupado(test, 'Enviando…');
    try { await sincronizar(usuario, rutinas); await enviarPrueba(); aviso = { tipo: 'ok', texto: 'Prueba enviada: debería llegar en unos segundos.' }; }
    catch (e) { aviso = { tipo: 'error', texto: (e as Error).message }; }
    pintarPush();
  };
  const off = box.querySelector<HTMLElement>('#p-off');
  if (off) off.onclick = async () => { await desactivarPush(); aviso = null; push = await estadoPush(); pintarPush(); };
}

/* ---------------- Vista previa de los avisos ---------------- */
async function vistaPrevia(r: Rutina, el: HTMLElement) {
  if (!el.hidden) { el.hidden = true; return; }
  el.hidden = false; el.innerHTML = '<div class="note flat">Consultando recorridos…</div>';
  try {
    const rutas = await planificar(r.origen, r.destino, undefined, 10);
    const prox = proximaLlegada(r, Date.now());
    if (!prox) { el.innerHTML = '<div class="note flat">Elegí al menos un día.</div>'; return; }
    const reco = recomendar(rutas, prox.ms, r.margen);
    if (!reco) { el.innerHTML = '<div class="note flat">No encontré recorridos en colectivo entre esos puntos.</div>'; return; }
    const mom = momentos(prox.ms, reco.abordarMs);
    const fila = (a: Aviso) => {
      const m = mensaje(a, { usuario, rutina: r, reco });
      return `<div class="pv"><em>${hm(mom[a])}</em><div><b>${ctx.esc(m.titulo)}</b><p>${ctx.esc(m.cuerpo)}</p></div></div>`;
    };
    el.innerHTML = `<div class="note flat">Próxima llegada: <b>${DIAS[new Date(prox.ms - 3 * 3600_000).getUTCDay()]} ${r.llegada}</b>. Así llegarían los avisos (según el recorrido de ahora; se reajusta con datos en vivo cerca de la hora):</div>${fila('n1')}${fila('n2')}${fila('n3')}`;
  } catch { el.innerHTML = '<div class="note flat bad">No pude consultar el planificador. Probá de nuevo.</div>'; }
}

/* ---------------- Formulario ---------------- */
function autocompletar(input: HTMLInputElement, lista: HTMLElement, alElegir: (l: Lugar) => void) {
  let t = 0, ac: AbortController | null = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 3) { lista.innerHTML = ''; return; }
    t = window.setTimeout(async () => {
      ac?.abort(); ac = new AbortController();
      try {
        const items = await buscarLugares(q, ac.signal);
        lista.innerHTML = items.map((l, i) => `<button type="button" class="row sug" data-i="${i}"><span class="main"><div class="t">${ctx.esc(l.nombre)}</div><div class="s">${ctx.esc(l.detalle)}</div></span></button>`).join('') || '<div class="empty small">Sin resultados.</div>';
        lista.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => (b.onpointerdown = (e) => { e.preventDefault(); const l = items[+b.dataset.i!]; input.value = l.nombre; lista.innerHTML = ''; alElegir(l); }));
      } catch { /* cancelado */ }
    }, 260);
  });
}

function drawForm() {
  const { esc } = ctx;
  const r = editando;
  let destino = r?.destino ?? null, origen = r?.origen ?? null;
  const dias = new Set<number>(r?.dias ?? [1, 2, 3, 4, 5]);
  ctx.content.innerHTML = `
    <button class="row back" id="cancelar"><span class="iconbtn">‹</span><span class="main"><div class="t">${r ? 'Editar rutina' : 'Nueva rutina'}</div></span></button>
    <form class="rform" id="rform" autocomplete="off">
      <label class="fld"><span>Nombre</span><input id="f-nombre" required maxlength="60" placeholder="Ej.: Trabajo, Facultad" value="${esc(r?.nombre ?? '')}"></label>
      <label class="fld"><span>¿A dónde vas?</span><input id="f-dest" required placeholder="Dirección, esquina o lugar" value="${esc(r?.destino.nombre ?? '')}"><div class="aclist" id="l-dest"></div></label>
      <label class="fld"><span>¿Desde dónde salís? (casa u origen fijo)</span><input id="f-orig" required placeholder="Tu dirección" value="${esc(r?.origen.nombre ?? '')}"><div class="aclist" id="l-orig"></div></label>
      <label class="chk"><input type="checkbox" id="f-ubic" ${r?.usarUbicacion ? 'checked' : ''}><span>Usar mi ubicación actual cuando la app la conozca (si no, uso el origen de arriba)</span></label>
      <div class="fld"><span>Días de la semana</span><div class="dchips">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="dchip" data-d="${d}" aria-pressed="${dias.has(d)}" title="${DIAS[d]}">${DIAS_L[d]}</button>`).join('')}</div></div>
      <div class="two">
        <label class="fld"><span>Quiero llegar a las</span><input id="f-hora" type="time" required value="${r?.llegada ?? '08:00'}"></label>
        <label class="fld"><span>Colchón</span><select id="f-margen">${[5, 10, 15, 20, 30].map((m) => `<option value="${m}" ${(r?.margen ?? 10) === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
      </div>
      <div class="note flat bad" id="f-err" hidden></div>
      <button class="btn go" type="submit">Guardar rutina</button>
    </form>`;
  if (ctx.isMobile()) ctx.setFull();
  const $f = <T extends HTMLElement>(id: string) => ctx.content.querySelector<T>('#' + id)!;
  $f('cancelar').onclick = () => { vista = 'lista'; drawLista(); estadoPush().then((e) => { push = e; pintarPush(); }); };
  autocompletar($f<HTMLInputElement>('f-dest'), $f('l-dest'), (l) => (destino = { nombre: l.nombre, lng: l.lng, lat: l.lat }));
  autocompletar($f<HTMLInputElement>('f-orig'), $f('l-orig'), (l) => (origen = { nombre: l.nombre, lng: l.lng, lat: l.lat }));
  // si cambia el texto a mano, el lugar elegido deja de valer
  $f<HTMLInputElement>('f-dest').addEventListener('input', () => { if (destino && $f<HTMLInputElement>('f-dest').value !== destino.nombre) destino = null; });
  $f<HTMLInputElement>('f-orig').addEventListener('input', () => { if (origen && $f<HTMLInputElement>('f-orig').value !== origen.nombre) origen = null; });
  ctx.content.querySelectorAll<HTMLElement>('.dchip').forEach((b) => (b.onclick = () => {
    const d = +b.dataset.d!; dias.has(d) ? dias.delete(d) : dias.add(d); b.setAttribute('aria-pressed', String(dias.has(d)));
  }));
  $f<HTMLInputElement>('f-ubic').onchange = (e) => { if ((e.target as HTMLInputElement).checked) navigator.geolocation?.getCurrentPosition(() => refrescarUbicacion(), () => undefined, { timeout: 10000 }); };
  $f<HTMLFormElement>('rform').onsubmit = (e) => {
    e.preventDefault();
    const err = $f('f-err');
    const falla = !destino ? 'Elegí el destino de la lista de sugerencias.' : !origen ? 'Elegí el origen de la lista de sugerencias.' : !dias.size ? 'Elegí al menos un día.' : '';
    if (falla) { err.textContent = falla; err.hidden = false; return; }
    const nueva: Rutina = {
      id: r?.id ?? uid(), nombre: $f<HTMLInputElement>('f-nombre').value.trim() || 'Rutina', destino: destino!, origen: origen!,
      usarUbicacion: $f<HTMLInputElement>('f-ubic').checked, dias: [...dias].sort(), llegada: $f<HTMLInputElement>('f-hora').value,
      margen: +$f<HTMLSelectElement>('f-margen').value, activa: r?.activa ?? true,
    };
    rutinas = r ? rutinas.map((x) => (x === r ? nueva : x)) : [...rutinas, nueva];
    guardar(); subir(); vista = 'lista'; drawLista();
  };
}

/* ---------------- Ubicación para los avisos ---------------- */
export async function refrescarUbicacion() {
  if (!servidorConfigurado() || !rutinas.some((r) => r.activa && r.usarUbicacion) || !navigator.geolocation) return;
  if ((await estadoPush()) !== 'activo') return;
  navigator.geolocation.getCurrentPosition((p) => enviarUbicacion([p.coords.longitude, p.coords.latitude]), () => undefined, { maximumAge: 300_000, timeout: 15_000 });
}
export function iniciarUbicacionPeriodica() {
  setTimeout(refrescarUbicacion, 5000);
  setInterval(() => { if (!document.hidden) refrescarUbicacion(); }, 10 * 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescarUbicacion(); });
}
