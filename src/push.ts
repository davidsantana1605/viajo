import { PUSH_URL } from './config';
import type { Rutina } from './recomendar';

export type EstadoPush = 'no-soportado' | 'ios-instalar' | 'sin-servidor' | 'denegado' | 'inactivo' | 'activo';

const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export const servidorConfigurado = () => !!PUSH_URL;

export async function registrarSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('sw.js', { scope: './' }); } catch { return null; }
}

async function suscripcion(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return esIOS() && !instalada() ? 'ios-instalar' : 'no-soportado';
  if (esIOS() && !instalada()) return 'ios-instalar';
  if (!PUSH_URL) return 'sin-servidor';
  if (Notification.permission === 'denied') return 'denegado';
  return (await suscripcion()) && Notification.permission === 'granted' ? 'activo' : 'inactivo';
}

const b64uToBytes = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function post(path: string, body: unknown) {
  const r = await fetch(`${PUSH_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error || `Error ${r.status}`);
  return d;
}

/** Pide permiso, suscribe este dispositivo y sube las rutinas al servidor. */
export async function activarPush(usuario: string, rutinas: Rutina[], loc?: [number, number]): Promise<void> {
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') throw new Error('Permiso de notificaciones denegado');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registrarSW());
  if (!reg) throw new Error('No se pudo registrar el service worker');
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = (await (await fetch(`${PUSH_URL}/vapid`)).json()) as { publicKey: string };
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  }
  await sincronizar(usuario, rutinas, loc);
}

export async function sincronizar(usuario: string, rutinas: Rutina[], loc?: [number, number]): Promise<void> {
  const sub = await suscripcion();
  if (!sub) return;
  await post('/sync', { subscription: sub.toJSON(), usuario, rutinas, loc: loc ? { lng: loc[0], lat: loc[1], nombre: 'Ubicación' } : undefined });
}

export async function enviarPrueba(): Promise<void> {
  const sub = await suscripcion();
  if (!sub) throw new Error('Este dispositivo no está suscripto');
  await post('/test', { endpoint: sub.endpoint });
}

export async function enviarUbicacion(ll: [number, number]): Promise<void> {
  const sub = await suscripcion();
  if (sub) await post('/loc', { endpoint: sub.endpoint, lng: ll[0], lat: ll[1], nombre: 'Ubicación' }).catch(() => undefined);
}

export async function desactivarPush(): Promise<void> {
  const sub = await suscripcion();
  if (!sub) return;
  await post('/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
