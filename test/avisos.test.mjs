// Ejecutar: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { distM, umbralAAvisar, nuevoEstadoPasaste, actualizarPasaste, prepararRecorrido, paradasRestantes, avisarXParadas, proyectar } from '../src/avisosLogica.ts';

const LAT = -32.95, kx = 111320 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (m) => -60.7 + m / kx; // metros al este de -60.70
const P = (m, dy = 0) => [lngAt(m), LAT + dy / 110574];

test('distM ~ metros', () => {
  assert.ok(Math.abs(distM(P(0), P(1000)) - 1000) < 3);
});

test('umbrales: 400, 200, 80 en orden, sin repetir', () => {
  const s = new Set(); const fired = [];
  for (const d of [900, 500, 399, 350, 250, 199, 150, 100, 79, 40]) { const u = umbralAAvisar(d, s); if (u) fired.push(u); }
  assert.deepEqual(fired, [400, 200, 80]);
});

test('umbrales: primer dato ya cerca no dispara los mayores después', () => {
  const s = new Set();
  assert.equal(umbralAAvisar(150, s), 200);
  assert.equal(umbralAAvisar(140, s), null);
  assert.equal(umbralAAvisar(70, s), 80);
});

test('te pasaste: se acerca, llega y se aleja', () => {
  let s = nuevoEstadoPasaste(); const nuevos = [];
  for (const d of [600, 300, 120, 40, 60, 100, 140, 160]) { const r = actualizarPasaste(s, d); s = r.estado; if (r.nuevo) nuevos.push(d); }
  assert.deepEqual(nuevos, [140]);
  assert.equal(s.pasado, true);
});

test('te pasaste: no dispara si nunca estuvo cerca, ni por ruido del GPS', () => {
  let s = nuevoEstadoPasaste();
  for (const d of [900, 700, 500, 300, 250, 320, 260, 330]) s = actualizarPasaste(s, d).estado;
  assert.equal(s.pasado, false);
  s = nuevoEstadoPasaste();
  for (const d of [200, 100, 60, 90, 70, 100]) s = actualizarPasaste(s, d).estado;
  assert.equal(s.pasado, false);
});

test('te pasaste: dispara una sola vez', () => {
  let s = nuevoEstadoPasaste(); let n = 0;
  for (const d of [100, 30, 130, 200, 300, 500]) { const r = actualizarPasaste(s, d); s = r.estado; if (r.nuevo) n++; }
  assert.equal(n, 1);
});

// traza de ida (hacia el este) y de vuelta (hacia el oeste); paradas desordenadas, dos veredas
const ida = [P(0), P(5000)], vuelta = [P(5000, 12), P(0, 12)];
const paradas = [];
for (let m = 200; m <= 4800; m += 400) { paradas.push({ lng: P(m, 6)[0], lat: P(m, 6)[1] }); paradas.push({ lng: P(m + 20, 9)[0], lat: P(m + 20, 9)[1] }); }
paradas.reverse();

test('proyectar da posición a lo largo', () => {
  const p = proyectar(ida, P(1000, 5));
  assert.ok(Math.abs(p.s - 1000) < 5 && Math.abs(p.off - 5) < 1);
});

test('paradas restantes en sentido ida', () => {
  const rec = prepararRecorrido([ida, vuelta], paradas, P(100), P(2200));
  assert.ok(rec); assert.equal(rec.poly, 0);
  assert.equal(paradasRestantes(rec, ida, P(100)).paradas, 6); // 200,600,1000,1400,1800,2200
  const r2 = paradasRestantes(rec, ida, P(1650));
  assert.equal(r2.paradas, 2);
  assert.ok(Math.abs(r2.metros - 550) < 15);
  assert.equal(paradasRestantes(rec, ida, P(2150)).paradas, 1);
});

test('sentido vuelta se elige solo y el GPS lejos de la traza da null', () => {
  const rec = prepararRecorrido([ida, vuelta], paradas, P(4000, 12), P(1000, 12));
  assert.equal(rec.poly, 1);
  assert.equal(paradasRestantes(rec, vuelta, P(2000, 12)).paradas, 3); // 1800,1400,1000
  assert.equal(paradasRestantes(rec, vuelta, P(2000, 900)), null);
  assert.equal(prepararRecorrido([ida], paradas, P(4000), P(1000)), null);
});

test('aviso X paradas antes: una vez', () => {
  assert.equal(avisarXParadas(3, 4, false), false);
  assert.equal(avisarXParadas(3, 3, false), true);
  assert.equal(avisarXParadas(3, 2, true), false);
  assert.equal(avisarXParadas(0, 1, false), false);
  assert.equal(avisarXParadas(3, null, false), false);
});
