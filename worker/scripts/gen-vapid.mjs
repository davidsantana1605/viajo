// Genera el par de claves VAPID (P-256) para Web Push.
// - La clave pública va al cliente (se sirve desde el worker en /vapid).
// - La clave privada es un SECRETO: queda sólo en vapid-keys.json (ignorado por git) y en `wrangler secret`.
import { writeFileSync, existsSync } from 'node:fs';

const FILE = new URL('../vapid-keys.json', import.meta.url);
if (existsSync(FILE)) {
  console.log('Ya existe worker/vapid-keys.json: no se pisa. Borralo si querés regenerar (se invalidan las suscripciones).');
  process.exit(0);
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
const keys = { publicKey: b64u(pub), privateKey: jwk.d };
writeFileSync(FILE, JSON.stringify(keys, null, 2));
writeFileSync(new URL('../.dev.vars', import.meta.url), `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nDEBUG=1\n`);
console.log('Claves generadas en worker/vapid-keys.json y worker/.dev.vars (ambos ignorados por git).');
console.log('Clave pública:', keys.publicKey);
