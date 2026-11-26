import './styles/pwa.css';

/* PWA: instalación, estado de conexión y aviso de versión nueva. Se autoinyecta en el DOM (no depende del render del panel). */

interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const LS_DISMISS = 'viajo-pwa-install-dismissed';
const DISMISS_MS = 14 * 24 * 3600 * 1000;

const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esSafariIOS = () => esIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
export const estaInstalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const estaOffline = () => !navigator.onLine;

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin storage */ } };

let stack: HTMLElement;
let banner: HTMLElement;
let deferred: BIPEvent | null = null;
let installCard: HTMLElement | null = null;
let onlineTimer = 0;

const el = (cls: string, html = '', role?: string) => {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  if (role) d.setAttribute('role', role);
  return d;
};

/* ---------------- conexión ---------------- */
function paintConexion(initial = false) {
  clearTimeout(onlineTimer);
  document.documentElement.classList.toggle('is-offline', estaOffline());
  if (estaOffline()) {
    banner.className = 'pwa-pill pwa-offline';
    banner.innerHTML = '<i></i><span>Sin conexión · mostrando lo guardado. Los arribos en vivo no están disponibles</span>';
    banner.hidden = false;
  } else if (!initial && !banner.hidden) {
    banner.className = 'pwa-pill pwa-online';
    banner.innerHTML = '<i></i><span>Volvió la conexión</span>';
    onlineTimer = window.setTimeout(() => (banner.hidden = true), 2500);
  } else {
    banner.hidden = true;
  }
}

/* ---------------- instalación ---------------- */
function descartado() {
  const t = Number(lsGet(LS_DISMISS));
  return !!t && Date.now() - t < DISMISS_MS;
}
function quitarTarjeta() { installCard?.remove(); installCard = null; }

function mostrarInstalar(ios: boolean) {
  if (installCard || estaInstalada() || descartado()) return;
  installCard = el('pwa-card glass', `
    <div class="pwa-ic" aria-hidden="true">🚌</div>
    <div class="pwa-tx"><b>Instalá Viajo</b><small>${ios ? 'Tocá <b>Compartir</b> y después <b>Agregar a inicio</b>.' : 'Abrila como app y usala aun sin conexión.'}</small></div>
    ${ios ? '' : '<button class="pwa-btn" data-a="install">Instalar</button>'}
    <button class="pwa-x" data-a="close" aria-label="Cerrar">✕</button>`);
  installCard.addEventListener('click', async (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (a === 'close') { lsSet(LS_DISMISS, String(Date.now())); quitarTarjeta(); }
    if (a === 'install' && deferred) {
      const d = deferred; deferred = null;
      try { await d.prompt(); const r = await d.userChoice; if (r.outcome === 'dismissed') lsSet(LS_DISMISS, String(Date.now())); } catch { /* cancelado */ }
      quitarTarjeta();
    }
  });
  stack.append(installCard);
}

/* ---------------- versión nueva ---------------- */
function avisarActualizacion(reg: ServiceWorkerRegistration) {
  if (stack.querySelector('.pwa-update')) return;
  const c = el('pwa-pill pwa-update', '<span>Hay una versión nueva</span><button class="pwa-btn" data-a="upd">Actualizar</button>', 'status');
  const b = c.querySelector('button') as HTMLButtonElement;
  b.addEventListener('click', () => {
    b.disabled = true;
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
  stack.append(c);
}

async function vigilarSW() {
  if (!('serviceWorker' in navigator)) return;
  let reg: ServiceWorkerRegistration;
  try { reg = await navigator.serviceWorker.ready; } catch { return; }
  const hayControlador = !!navigator.serviceWorker.controller;
  if (reg.waiting && hayControlador) avisarActualizacion(reg);
  reg.addEventListener('updatefound', () => {
    const nw = reg.installing;
    nw?.addEventListener('statechange', () => {
      if (nw.state === 'installed' && navigator.serviceWorker.controller) avisarActualizacion(reg);
    });
  });
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hayControlador || recargando) return; // primera instalación: clients.claim, no recargar
    recargando = true;
    location.reload();
  });
  // Busca versión nueva al volver a la app y cada hora.
  const check = () => { reg.update().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 3600 * 1000);
}

/* ---------------- theme-color coherente con el modo ---------------- */
function syncThemeColor() {
  const c = document.documentElement.dataset.theme === 'dark' ? '#1b1c20' : '#f3f0e9';
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => m.setAttribute('content', c));
}

export function initPWA() {
  stack = el('pwa-stack');
  banner = el('pwa-pill', '', 'status');
  banner.hidden = true;
  stack.append(banner);
  document.body.append(stack);

  paintConexion(true);
  addEventListener('online', () => paintConexion());
  addEventListener('offline', () => paintConexion());

  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; mostrarInstalar(false); });
  addEventListener('appinstalled', () => { deferred = null; quitarTarjeta(); });
  if (esSafariIOS()) setTimeout(() => mostrarInstalar(true), 4000);

  new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  syncThemeColor();
  vigilarSW();
}
