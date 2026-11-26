const API = 'https://ws.rosario.gob.ar/ubicaciones/public';

export interface Punto { lng: number; lat: number; nombre: string; parada?: string }
export interface Tramo {
  modo: 'walk' | 'bus';
  desde: Punto; hasta: Punto;
  dist: number; dur: number; // metros, segundos
  inicio: string; fin: string; // "HH:MM"
  linea?: { id: string; idEmpresa: string; nombre: string; codigo: string };
  geom: [number, number][];
}
export interface Ruta {
  denom: string; dur: number; dist: number; caminata: number; transbordos: number;
  inicio: string; fin: string; tramos: Tramo[];
}

interface RawPunto { coordinates: [number, number]; properties?: { nombre?: string; parada?: string } }
interface RawTramo {
  geometry: { type: string; coordinates: unknown };
  properties: {
    modo: number; desde: RawPunto; hasta: RawPunto; distancia: number; duracion: number; inicio: string; fin: string;
    linea?: { id: string; idEmpresa: string; nombre: string; codigoEMR: string; nombreCorto: string };
  };
}
interface RawRuta {
  denominacion: string; duracion: number; distanciaTotal: number; distanciaCaminata: number; cantidadTransbordos: number;
  inicio: string; fin: string; tramos: { features: RawTramo[] };
}

const hm = (s: string) => s.slice(11, 16);
const pt = (p: RawPunto): Punto => ({
  lng: p.coordinates[0], lat: p.coordinates[1],
  nombre: p.properties?.nombre ?? '', parada: p.properties?.parada,
});
const flatLine = (c: unknown): [number, number][] =>
  (Array.isArray(c) && typeof (c as unknown[])[0] === 'number' ? [c as [number, number]] : (c as unknown[]).flatMap(flatLine));

/** Planificador oficial de "Cómo Llego": devuelve hasta ~10 alternativas con caminata, colectivos y transbordos. */
export async function planificar(o: { lng: number; lat: number }, d: { lng: number; lat: number }, signal?: AbortSignal): Promise<Ruta[]> {
  const q = `xOrigen=${o.lng}&yOrigen=${o.lat}&xDestino=${d.lng}&yDestino=${d.lat}&cantCuadras=8&incluirBicicletasRentadas=false&usarCoordenadasWGS84=true`;
  const r = await fetch(`${API}/geojson/comollego?${q}`, { signal });
  if (!r.ok) throw new Error('planificador ' + r.status);
  const data = (await r.json()) as { rutas?: RawRuta[] };
  return (data.rutas ?? []).map((x) => ({
    denom: x.denominacion, dur: x.duracion, dist: x.distanciaTotal, caminata: x.distanciaCaminata,
    transbordos: x.cantidadTransbordos, inicio: hm(x.inicio), fin: hm(x.fin),
    tramos: x.tramos.features.map((f): Tramo => ({
      modo: f.properties.modo === 1 ? 'bus' : 'walk',
      desde: pt(f.properties.desde), hasta: pt(f.properties.hasta),
      dist: f.properties.distancia, dur: f.properties.duracion,
      inicio: hm(f.properties.inicio), fin: hm(f.properties.fin),
      linea: f.properties.linea && {
        id: f.properties.linea.id, idEmpresa: f.properties.linea.idEmpresa,
        nombre: f.properties.linea.nombre, codigo: f.properties.linea.codigoEMR || f.properties.linea.nombreCorto,
      },
      geom: flatLine(f.geometry.coordinates),
    })),
  }));
}
