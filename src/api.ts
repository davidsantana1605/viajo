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

export async function loadLinea(file: string): Promise<Linea> {
  const d = await fetch(`${BASE}data/lineas/${file}.json`).then((r) => r.json());
  return { ...d, stops: d.paradas };
}

export async function arribos(parada: string, linea?: string): Promise<ArriboLinea[]> {
  const q = `?parada=${encodeURIComponent(parada)}${linea ? `&linea=${encodeURIComponent(linea)}` : ''}`;
  const r = await fetch(`${API}/cuandollega${q}`);
  if (!r.ok) throw new Error('cuandollega ' + r.status);
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

/** Un arribo trae posición real sólo si no es "Programado" y tiene coordenadas válidas. */
export const esEnVivo = (a: Arribo) =>
  a.tipo.toLowerCase() !== 'programado' && Math.abs(a.latitud) > 1 && Math.abs(a.longitud) > 1;
