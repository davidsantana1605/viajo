/** Generador de códigos QR mínimo (modo byte, versiones 1–10, corrección L/M). Sin dependencias. */
const ECC = {
  L: { bits: 1, cw: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4] },
  M: { bits: 0, cw: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] },
} as const;

const rawModules = (v: number) => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
};
const gfMul = (x: number, y: number) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; };
function rsDivisor(n: number): number[] {
  const r = new Array<number>(n).fill(0); r[n - 1] = 1;
  let root = 1;
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { r[j] = gfMul(r[j], root); if (j + 1 < n) r[j] ^= r[j + 1]; } root = gfMul(root, 2); }
  return r;
}
function rsRemainder(data: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of data) { const f = b ^ r.shift()!; r.push(0); div.forEach((c, i) => (r[i] ^= gfMul(c, f))); }
  return r;
}

function codewords(bytes: number[], ver: number, lvl: 'L' | 'M'): number[] | null {
  const e = ECC[lvl], nb = e.blocks[ver - 1], eccLen = e.cw[ver - 1];
  const raw = Math.floor(rawModules(ver) / 8), cap = raw - eccLen * nb;
  const cc = ver <= 9 ? 8 : 16;
  if (bytes.length >= 1 << cc || 4 + cc + bytes.length * 8 > cap * 8) return null;
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, cc); bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < cap; pad ^= 0xec ^ 0x11) data.push(pad);
  const div = rsDivisor(eccLen), nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += d.length;
    const ecc = rsRemainder(d, div);
    if (i < nShort) d.push(0);
    blocks.push(d.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) out.push(b[i]); });
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function penalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const lines = [...m.map((r) => r.map(Number).join('')), ...m.map((_, x) => m.map((r) => Number(r[x])).join(''))];
  for (const s of lines) {
    for (const run of s.match(/0+|1+/g)!) if (run.length >= 5) p += run.length - 2;
    p += 40 * ((s.match(/(?=10111010000)/g) ?? []).length + (s.match(/(?=00001011101)/g) ?? []).length);
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  const dark = m.flat().filter(Boolean).length, total = n * n;
  return p + Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
}

/** Devuelve la matriz del QR (true = módulo oscuro) o null si el texto no entra en la versión 10. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));
  for (const lvl of ['M', 'L'] as const) for (let ver = 1; ver <= 10; ver++) {
    const cw = codewords(bytes, ver, lvl);
    if (cw) return build(cw, ver, lvl);
  }
  return null;
}

function build(cw: number[], ver: number, lvl: 'L' | 'M'): boolean[][] {
  const size = ver * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, v: boolean) => { m[y][x] = v; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2;
  const pos: number[] = [];
  if (na) { const step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2; pos.push(6); for (let p = size - 7, i = 0; i < na - 1; i++, p -= step) pos.splice(1, 0, p); }
  pos.forEach((cx, i) => pos.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const format = (mask: number) => {
    const data = (ECC[lvl].bits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412, b = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i));
    set(8, size - 8, true);
  };
  format(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const v = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, v); set(b, a, v); }
  }
  // datos en zigzag
  for (let i = 0, right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fn[y][x] && i < cw.length * 8) { m[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }
  const apply = (k: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
  let best = 0, bestP = Infinity;
  for (let k = 0; k < 8; k++) { apply(k); format(k); const p = penalty(m); if (p < bestP) { bestP = p; best = k; } apply(k); }
  apply(best); format(best);
  return m;
}

/** Dibuja la matriz en un canvas (con zona silenciosa de 4 módulos). */
export function qrToCanvas(m: boolean[][], canvas: HTMLCanvasElement, px = 8): void {
  const q = 4, n = m.length + q * 2;
  canvas.width = canvas.height = n * px;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#000';
  m.forEach((row, y) => row.forEach((v, x) => { if (v) c.fillRect((x + q) * px, (y + q) * px, px, px); }));
}
