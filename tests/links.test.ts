// Ejecutar con: npm test   (node --test, Node >= 22.6 con type stripping)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash, textoViaje, textoEta, inBox } from '../src/links.ts';
import { qrMatrix } from '../src/qr.ts';

const o = { lng: -60.6393, lat: -32.9468, nombre: 'Córdoba 1500' };
const d = { lng: -60.7, lat: -32.99, nombre: 'Plaza & Cía <b>' };

test('linea y parada', () => {
  assert.deepEqual(parseHash('#linea=1-28&parada=5074'), { k: 'linea', file: '1-28', parada: '5074' });
  assert.deepEqual(parseHash('#linea=1-28'), { k: 'linea', file: '1-28', parada: undefined });
  assert.deepEqual(parseHash('#parada=5074'), { k: 'parada', id: '5074' });
  assert.equal(toHash({ k: 'linea', file: '1-28', parada: '5074' }), '#linea=1-28&parada=5074');
  assert.equal(toHash({ k: 'parada', id: '5074' }), '#parada=5074');
});

test('rutinas y vacíos', () => {
  assert.deepEqual(parseHash('#rutinas'), { k: 'rutinas' });
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#'), null);
  assert.equal(parseHash('#cualquiera'), null);
});

test('viaje: ida y vuelta con nombres codificados', () => {
  const h = toHash({ k: 'viaje', o, d });
  assert.match(h, /^#viaje=-60\.6393,-32\.9468~-60\.7,-32\.99&o=/);
  const p = parseHash(h);
  assert.equal(p?.k, 'viaje');
  if (p?.k !== 'viaje') return;
  assert.equal(p.o.nombre, 'Córdoba 1500');
  assert.equal(p.d.nombre, 'Plaza & Cía b'); // los < > se reemplazan por espacios
  assert.ok(Math.abs(p.o.lng - o.lng) < 1e-6 && Math.abs(p.d.lat - d.lat) < 1e-6);
});

test('viaje: validación estricta', () => {
  const ok = '-60.65,-32.95~-60.66,-32.96';
  assert.equal(parseHash(`#viaje=${ok}`)?.k, 'viaje');
  assert.equal(parseHash('#viaje=-60.65,-32.95~-60.66,-32.96&o=A&d=B')?.k, 'viaje');
  for (const bad of [
    '-10,-32.95~-60.66,-32.96', // fuera de Rosario
    '-60.65,-10~-60.66,-32.96',
    '-60.65,-32.95', // falta destino
    '-60.65,-32.95~-60.66,-32.96~-60.7,-32.9',
    'a,b~c,d', '-60.65,-32.95,1~-60.66,-32.96', '1e2,3~4,5', '-60.65,-32.95~NaN,-32.9', '',
  ]) assert.equal(parseHash(`#viaje=${bad}`), null, bad);
  assert.equal(parseHash(`#viaje=${ok}&o=%E0%A4%A`)?.k, 'viaje'); // %-inválido: se ignora el nombre
});

test('largo máximo, ids y escapes', () => {
  assert.equal(parseHash('#linea=' + 'a'.repeat(41)), null);
  assert.equal(parseHash('#linea=1-28"><script>'), null);
  assert.equal(parseHash('#parada=../x'), null);
  assert.equal(parseHash('#viaje=-60.65,-32.95~-60.66,-32.96&o=' + 'x'.repeat(800)), null);
  const long = parseHash('#viaje=-60.65,-32.95~-60.66,-32.96&o=' + 'x'.repeat(300));
  assert.equal(long?.k === 'viaje' && long.o.nombre.length, 80);
  const inj = parseHash('#viaje=-60.65,-32.95~-60.66,-32.96&o=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  assert.ok(inj?.k === 'viaje' && !/[<>]/.test(inj.o.nombre));
});

test('toHash rechaza datos inválidos', () => {
  assert.equal(toHash({ k: 'viaje', o: { ...o, lng: 0 }, d }), '');
  assert.equal(toHash({ k: 'linea', file: 'a b' }), '');
  assert.ok(inBox(-60.65, -32.95) && !inBox(-58, -34.6));
});

test('textos', () => {
  assert.equal(textoViaje({ nombre: 'A' }, { nombre: 'B' }, { lineas: ['129'], salgo: '16:10', llego: '16:55' }), 'Viaje de A a B: 129 · salgo 16:10, llego 16:55 – Viajo');
  assert.equal(textoEta('Casa', '16:52'), 'Voy en camino a Casa: llego estimado a las 16:52 – Viajo');
});

test('QR: entra un enlace típico (versión <= 10)', () => {
  const url = 'https://davidsantana1605.github.io/viajo/' + toHash({ k: 'viaje', o, d });
  const m = qrMatrix(url);
  assert.ok(m && m.length >= 21 && m.length <= 57 && m.length === m[0].length, 'tamaño ' + m?.length);
  assert.equal(qrMatrix('x'.repeat(500)), null);
});
