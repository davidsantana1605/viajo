// Avisos breves (toasts) accesibles: reemplazan a alert(). Sin dependencias.
export type ToastKind = 'info' | 'ok' | 'error';
export interface ToastOpts {
  kind?: ToastKind;
  /** Texto del botón de acción (ej. "Reintentar"). */
  action?: string;
  onAction?: () => void;
  /** Milisegundos en pantalla; 0 = hasta cerrarlo. */
  duration?: number;
}

const ICONS: Record<ToastKind, string> = {
  info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.2"/></svg>',
  ok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16 9.5"/></svg>',
  error: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>',
};

let host: HTMLElement | null = null;
const getHost = () => {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.id = 'toasts';
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'Avisos');
  document.body.appendChild(host);
  return host;
};

/** Vibración corta si el dispositivo la tiene (no hace nada si no). */
export function vibrar(ms: number | number[] = 12) {
  try { navigator.vibrate?.(ms); } catch { /* sin soporte */ }
}

export function toast(texto: string, opts: ToastOpts = {}): () => void {
  const kind = opts.kind ?? 'info';
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const ic = document.createElement('span'); ic.className = 'ti'; ic.innerHTML = ICONS[kind];
  const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = texto;
  el.append(ic, tx);
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    if (!el.isConnected || el.classList.contains('out')) return;
    el.classList.add('out');
    const rm = () => el.remove();
    el.addEventListener('animationend', rm, { once: true });
    setTimeout(rm, 400);
  };
  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ta'; b.textContent = opts.action;
    b.onclick = () => { close(); opts.onAction?.(); };
    el.appendChild(b);
  }
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'tc'; x.setAttribute('aria-label', 'Cerrar aviso');
  x.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m2 2 8 8M10 2l-8 8"/></svg>';
  x.onclick = close;
  el.appendChild(x);
  const h = getHost();
  while (h.children.length >= 3) h.firstElementChild?.remove();
  h.appendChild(el);
  const d = opts.duration ?? (opts.action ? 8000 : kind === 'error' ? 6500 : 3800);
  if (d > 0) timer = window.setTimeout(close, d);
  if (kind === 'error') vibrar([20, 40, 20]);
  return close;
}
