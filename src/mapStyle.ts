import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from 'maplibre-gl';

export type Theme = 'light' | 'dark';

// Estilo propio inspirado en Apple Maps, sobre teselas vectoriales OpenMapTiles
// de OpenFreeMap (gratis, sin clave). Todo el color vive en esta paleta.
interface Palette {
  land: string; residential: string; commercial: string; industrial: string;
  institution: string; hospital: string; park: string; wood: string; sand: string;
  water: string; waterLine: string; building: string; buildingEdge: string;
  minor: string; minorCase: string; mid: string; midCase: string;
  primary: string; primaryCase: string; major: string; majorCase: string;
  path: string; rail: string; boundary: string;
  text: string; textSoft: string; halo: string; waterText: string; parkText: string;
}

const PALETTE: Record<Theme, Palette> = {
  light: {
    land: '#f3f0e9', residential: '#f0ede5', commercial: '#f1eadf', industrial: '#ebe8e2',
    institution: '#f1ead8', hospital: '#f8e3df', park: '#d5ebc1', wood: '#c9e3b3', sand: '#f2e7c6',
    water: '#acd4f3', waterLine: '#9ccaee', building: '#e8e3d9', buildingEdge: '#d8d1c3',
    minor: '#ffffff', minorCase: '#e2ddd1', mid: '#ffffff', midCase: '#d9d2c3',
    primary: '#fff3cf', primaryCase: '#e0cf9c', major: '#fcd47a', majorCase: '#e0a94c',
    path: '#d8cfbd', rail: '#c9c3b6', boundary: '#c3b9d6',
    text: '#34343a', textSoft: '#6a6a74', halo: '#ffffffe6', waterText: '#3f76ab', parkText: '#46723a',
  },
  dark: {
    land: '#1b1c20', residential: '#1e1f24', commercial: '#212227', industrial: '#202125',
    institution: '#222327', hospital: '#2a2024', park: '#223829', wood: '#1d2f24', sand: '#2b2820',
    water: '#17344f', waterLine: '#1d4163', building: '#272930', buildingEdge: '#303239',
    minor: '#35373e', minorCase: '#18191c', mid: '#3d4048', midCase: '#18191c',
    primary: '#4b4738', primaryCase: '#211f17', major: '#7b6330', majorCase: '#2e2410',
    path: '#3a3c42', rail: '#3a3c42', boundary: '#4a4560',
    text: '#dcdee4', textSoft: '#9ea1ab', halo: '#1b1c20ec', waterText: '#6a9fd0', parkText: '#86b88a',
  },
};

type Stops = [number, number][];
const interp = (s: Stops, extra = 0): ExpressionSpecification => [
  'interpolate', ['exponential', 1.5], ['zoom'],
  ...s.flatMap(([z, v]) => [z, v + extra]),
] as unknown as ExpressionSpecification;

const cls = (...c: string[]): ExpressionSpecification =>
  ['match', ['get', 'class'], c, true, false] as ExpressionSpecification;
const tunnel: ExpressionSpecification = ['==', ['get', 'brunnel'], 'tunnel'];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];

const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:latin'], ['get', 'name']];
const REG = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

const WIDTH: Record<string, Stops> = {
  motorway: [[8, 0.8], [12, 2.4], [14, 5], [16, 9], [18, 20], [20, 44]],
  primary: [[10, 0.6], [12, 1.8], [14, 4], [16, 8], [18, 18], [20, 40]],
  mid: [[11, 0.5], [13, 1.5], [14, 3], [16, 7], [18, 16], [20, 36]],
  minor: [[13, 0.4], [14, 1.3], [16, 4.5], [18, 11], [20, 26]],
  service: [[15, 0.5], [16, 2], [18, 6], [20, 14]],
};

export function buildStyle(theme: Theme, threeD = true): StyleSpecification {
  const p = PALETTE[theme];
  const L: LayerSpecification[] = [];
  const add = (l: LayerSpecification) => L.push(l);

  add({ id: 'bg', type: 'background', paint: { 'background-color': p.land } });

  add({
    id: 'landcover', type: 'fill', source: 'om', 'source-layer': 'landcover',
    paint: {
      'fill-color': ['match', ['get', 'class'], 'wood', p.wood, 'grass', p.park, 'sand', p.sand, 'wetland', p.wood, 'farmland', p.land, p.land],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 1],
    },
  });
  add({
    id: 'landuse', type: 'fill', source: 'om', 'source-layer': 'landuse',
    paint: {
      'fill-color': ['match', ['get', 'class'],
        'residential', p.residential, 'suburb', p.residential, 'neighbourhood', p.residential,
        'commercial', p.commercial, 'retail', p.commercial,
        'industrial', p.industrial, 'railway', p.industrial,
        'school', p.institution, 'university', p.institution, 'college', p.institution, 'kindergarten', p.institution,
        'hospital', p.hospital,
        'park', p.park, 'playground', p.park, 'pitch', p.park, 'garden', p.park, 'cemetery', p.wood, 'stadium', p.park,
        p.land],
    },
  });
  add({
    id: 'park', type: 'fill', source: 'om', 'source-layer': 'park',
    paint: { 'fill-color': p.park, 'fill-opacity': 0.9 },
  });
  add({
    id: 'water', type: 'fill', source: 'om', 'source-layer': 'water',
    paint: { 'fill-color': p.water },
  });
  add({
    id: 'waterway', type: 'line', source: 'om', 'source-layer': 'waterway',
    paint: { 'line-color': p.waterLine, 'line-width': interp([[8, 0.5], [14, 1.6], [18, 5]]) },
  });
  add({
    id: 'aeroway', type: 'fill', source: 'om', 'source-layer': 'aeroway', minzoom: 11,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': p.industrial },
  });
  add({
    id: 'building', type: 'fill', source: 'om', 'source-layer': 'building', minzoom: 14.5, ...(threeD ? { maxzoom: 15.4 } : {}),
    paint: {
      'fill-color': p.building,
      'fill-outline-color': p.buildingEdge,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 16, 1],
    },
  });

  // Caminos
  const roadGroups: [string, string[], Stops, string, string, number][] = [
    ['service', ['service', 'track'], WIDTH.service, p.minor, p.minorCase, 15],
    ['minor', ['minor'], WIDTH.minor, p.minor, p.minorCase, 12.5],
    ['mid', ['tertiary', 'secondary'], WIDTH.mid, p.mid, p.midCase, 10],
    ['primary', ['primary'], WIDTH.primary, p.primary, p.primaryCase, 9],
    ['motorway', ['trunk', 'motorway'], WIDTH.motorway, p.major, p.majorCase, 6],
  ];

  add({
    id: 'path', type: 'line', source: 'om', 'source-layer': 'transportation', minzoom: 15,
    filter: cls('path', 'pedestrian'),
    paint: { 'line-color': p.path, 'line-width': interp([[15, 0.6], [18, 2]]), 'line-dasharray': [2, 1.5] },
  });
  add({
    id: 'rail', type: 'line', source: 'om', 'source-layer': 'transportation', minzoom: 11,
    filter: cls('rail'),
    paint: { 'line-color': p.rail, 'line-width': interp([[11, 0.5], [16, 1.6]]), 'line-dasharray': [4, 3] },
  });
  add({
    id: 'tunnel', type: 'line', source: 'om', 'source-layer': 'transportation', minzoom: 12,
    filter: ['all', tunnel, cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor')],
    layout: { 'line-cap': 'butt' },
    paint: { 'line-color': p.minorCase, 'line-width': interp(WIDTH.mid), 'line-opacity': 0.6, 'line-dasharray': [2, 2] },
  });
  for (const [id, classes, w, fill, casing, minzoom] of roadGroups) {
    add({
      id: `${id}-case`, type: 'line', source: 'om', 'source-layer': 'transportation', minzoom,
      filter: ['all', notTunnel, cls(...classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': casing, 'line-width': interp(w, 1.4) },
    });
  }
  for (const [id, classes, w, fill, , minzoom] of roadGroups) {
    add({
      id: `${id}-fill`, type: 'line', source: 'om', 'source-layer': 'transportation', minzoom,
      filter: ['all', notTunnel, cls(...classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': fill, 'line-width': interp(w) },
    });
  }

  // Edificios en 3D: sólo cerca del suelo (zoom alto) para que el costo de GPU sea mínimo
  if (threeD) {
    add({
      id: 'building-3d', type: 'fill-extrusion', source: 'om', 'source-layer': 'building', minzoom: 15.4,
      filter: ['>', ['coalesce', ['get', 'render_height'], 0], 0],
      paint: {
        'fill-extrusion-color': theme === 'dark' ? '#2e3038' : '#f1ede5',
        'fill-extrusion-height': ['min', ['coalesce', ['get', 'render_height'], 6], 80],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 15.4, 0, 16.2, 0.88],
        'fill-extrusion-vertical-gradient': true,
      },
    });
  }

  add({
    id: 'boundary', type: 'line', source: 'om', 'source-layer': 'boundary',
    filter: ['<=', ['get', 'admin_level'], 4],
    paint: { 'line-color': p.boundary, 'line-width': 1, 'line-dasharray': [3, 2] },
  });

  // Etiquetas
  add({
    id: 'water-label', type: 'symbol', source: 'om', 'source-layer': 'water_name',
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-letter-spacing': 0.15, 'text-max-width': 8 },
    paint: { 'text-color': p.waterText, 'text-halo-color': p.halo, 'text-halo-width': 1 },
  });
  // Jerarquía: avenidas principales se leen antes y más grandes; calles menores sólo con zoom alto
  const MAJOR = ['motorway', 'trunk', 'primary', 'secondary'];
  add({
    id: 'road-label-major', type: 'symbol', source: 'om', 'source-layer': 'transportation_name', minzoom: 12.8,
    filter: cls(...MAJOR),
    layout: {
      'symbol-placement': 'line', 'text-field': NAME, 'text-font': BOLD,
      'text-size': interp([[13, 10], [18, 14]]), 'text-letter-spacing': 0.03, 'symbol-spacing': 360,
    },
    paint: { 'text-color': p.text, 'text-halo-color': p.halo, 'text-halo-width': 2 },
  });
  add({
    id: 'road-label', type: 'symbol', source: 'om', 'source-layer': 'transportation_name', minzoom: 14.5,
    filter: ['!', cls(...MAJOR)],
    layout: {
      'symbol-placement': 'line', 'text-field': NAME, 'text-font': REG,
      'text-size': interp([[14, 10], [18, 13]]), 'text-letter-spacing': 0.02, 'symbol-spacing': 320,
    },
    paint: { 'text-color': p.textSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.6 },
  });
  add({
    id: 'poi', type: 'symbol', source: 'om', 'source-layer': 'poi', minzoom: 15.5,
    filter: ['all', ['<=', ['get', 'rank'], 20], cls('park', 'hospital', 'college', 'school', 'stadium', 'library', 'museum', 'railway', 'bus', 'zoo', 'theatre', 'cinema', 'town_hall', 'attraction')],
    layout: { 'text-field': NAME, 'text-font': REG, 'text-size': 11, 'text-max-width': 7, 'text-anchor': 'center' },
    paint: { 'text-color': p.parkText, 'text-halo-color': p.halo, 'text-halo-width': 1.4 },
  });
  add({
    id: 'place-small', type: 'symbol', source: 'om', 'source-layer': 'place', minzoom: 12.5,
    filter: cls('suburb', 'neighbourhood', 'quarter', 'village', 'hamlet'),
    layout: {
      'text-field': NAME, 'text-font': BOLD, 'text-size': interp([[12, 10], [16, 13]]),
      'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8,
    },
    paint: { 'text-color': p.textSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.4 },
  });
  add({
    id: 'place-town', type: 'symbol', source: 'om', 'source-layer': 'place', maxzoom: 14,
    filter: cls('town', 'city'),
    layout: { 'text-field': NAME, 'text-font': BOLD, 'text-size': interp([[6, 12], [10, 17]]), 'text-max-width': 8 },
    paint: { 'text-color': p.text, 'text-halo-color': p.halo, 'text-halo-width': 1.6 },
  });

  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { om: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenFreeMap © OpenMapTiles Datos © OpenStreetMap' } },
    layers: L,
  };
}
