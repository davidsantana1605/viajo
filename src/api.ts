const API = 'https://ws.rosario.gob.ar/ubicaciones/public';
const BASE = import.meta.env.BASE_URL;

export interface LineaIdx {
  file: string; id: string; idEmpresa: string; empresa: string;
  nombre: string; nombreCorto: string; codigo: string; variante: string; paradas: number;
}
export interface Parada { id: string; nombre: string; desc: string; lng: number; lat: number }
export interface Linea extends Omit<LineaIdx, 'paradas'> {
  ida: number[][][]; vuelta: number[][][]; stops: Parada[];
}
export interface Arribo {
  arriboEnMinutos: number; tipo: string; horaArribo: string; vehiculo: string;
  latitud: number; longitud: number; desvioHorario: string; ultimaFechaHoraGPS: string | null;
}
export interface ArriboLinea {
  linea: { id: string; idEmpresa: string; nombre: string; nombreCorto: string; codigoEMR: string };
  arribos: Arribo[];
}

export const loadIndex = (): Promise<LineaIdx[]> =>
  fetch(`${BASE}data/lineas.json`).then((r) => r.json());

const lineaMem = new Map<string, Promise<Linea>>();
/** Las líneas ya cargadas se reutilizan (cada archivo pesa decenas de KB); si falla, se reintenta la próxima vez. */
export function loadLinea(file: string): Promise<Linea> {
  let p = lineaMem.get(file);
  if (!p) {
    p = fetch(`${BASE}data/lineas/${file}.json`).then((r) => r.json()).then((d): Linea => ({ ...d, stops: d.paradas }));
    p.catch(() => lineaMem.delete(file));
    lineaMem.set(file, p);
  }
  return p;
}

const ARRIBO_TTL = 8000; // ms: evita pedir lo mismo dos veces entre vistas (línea, viaje, parada)
const arriboMem = new Map<string, { t: number; p: Promise<ArriboLinea[]> }>();

const esperar = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Abortado', 'AbortError')); }, { once: true });
  });

async function pedirArribos(q: string, signal?: AbortSignal): Promise<ArriboLinea[]> {
  // El servicio municipal devuelve 500 de forma intermitente: se reintenta un par de veces.
  let err: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${API}/cuandollega${q}`, { signal });
      if (r.ok) { const d = await r.json(); return Array.isArray(d) ? d : []; }
      err = new Error('cuandollega ' + r.status);
    } catch (e) { if (signal?.aborted) throw e; err = e; }
    await esperar(350 * (i + 1), signal);
  }
  throw err;
}

export function arribos(parada: string, linea?: string, signal?: AbortSignal): Promise<ArriboLinea[]> {
  const q = `?parada=${encodeURIComponent(parada)}${linea ? `&linea=${encodeURIComponent(linea)}` : ''}`;
  const hit = arriboMem.get(q);
  if (hit && Date.now() - hit.t < ARRIBO_TTL) return hit.p;
  // La promesa compartida no lleva la señal de un solo consumidor: se cancela sólo la espera de quien aborta.
  const p = pedirArribos(q);
  p.catch(() => { if (arriboMem.get(q)?.p === p) arriboMem.delete(q); });
  arriboMem.set(q, { t: Date.now(), p });
  if (arriboMem.size > 200) for (const [k, v] of arriboMem) if (Date.now() - v.t > ARRIBO_TTL) arriboMem.delete(k);
  if (!signal) return p;
  return new Promise<ArriboLinea[]>((res, rej) => {
    if (signal.aborted) return rej(new DOMException('Abortado', 'AbortError'));
    signal.addEventListener('abort', () => rej(new DOMException('Abortado', 'AbortError')), { once: true });
    p.then(res, rej);
  });
}

/** Un arribo trae posición real sólo si no es "Programado" y tiene coordenadas válidas. */
export const esEnVivo = (a: Arribo) =>
  a.tipo.toLowerCase() !== 'programado' && Math.abs(a.latitud) > 1 && Math.abs(a.longitud) > 1;
