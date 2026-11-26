// Uso: node tests/qr-dump.ts <texto> > matriz.txt ; tests/qr-verify.py lo decodifica con OpenCV.
import { qrMatrix } from '../src/qr.ts';

const m = qrMatrix(process.argv[2] ?? '');
if (!m) { console.error('no entra'); process.exit(1); }
console.log(m.map((r) => r.map((v) => (v ? '1' : '0')).join('')).join('\n'));
