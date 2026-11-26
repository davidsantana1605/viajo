/**
 * URL del worker de notificaciones (Cloudflare). Se define al compilar con VITE_PUSH_URL
 * (en GitHub: variable de repositorio VITE_PUSH_URL; en local: archivo .env.local).
 * Sin ella las rutinas funcionan igual, pero sin avisos push.
 */
export const PUSH_URL: string = ((import.meta.env.VITE_PUSH_URL as string | undefined) ?? '').replace(/\/$/, '');
