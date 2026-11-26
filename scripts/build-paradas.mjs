// Genera public/data/paradas.json a partir de public/data/lineas/*.json.
// Formato columnar y compacto:
//   { v:1, lineas:[{file,codigo,nombre}], p:[[id,nombre,desc,lng,lat,[idxLinea,...]], ...] }
// Las paradas son únicas por id; cada una lista los índices (en "lineas") de las líneas que pasan.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const dir = join(root, 'lineas');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const lineas = [];
const paradas = new Map();
const r5 = (n) => Math.round(n * 1e5) / 1e5;

for (const f of files) {
  const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const idx = lineas.push({ file: f.replace(/\.json$/, ''), codigo: d.codigo, nombre: d.nombre }) - 1;
  for (const s of d.paradas ?? []) {
    const id = String(s.id);
    let p = paradas.get(id);
    if (!p) {
      p = [id, s.nombre ?? '', s.desc ?? '', r5(s.lng), r5(s.lat), []];
      paradas.set(id, p);
    }
    if (!p[5].includes(idx)) p[5].push(idx);
  }
}

const out = JSON.stringify({ v: 1, lineas, p: [...paradas.values()] });
const dest = join(root, 'paradas.json');
writeFileSync(dest, out);
console.log(`paradas.json: ${paradas.size} paradas únicas, ${lineas.length} líneas, ${(statSync(dest).size / 1024).toFixed(0)} KB`);
