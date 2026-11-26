import { describe, it, expect } from 'vitest';
import { norm, fmtDur, fmtDist, fmtMin, frecuencia } from '../src/util';
import { esEnVivo, type Arribo } from '../src/api';

const arr = (min: number, tipo = 'GPS'): Arribo => ({
  arriboEnMinutos: min, tipo, horaArribo: '', vehiculo: '', latitud: -32.95, longitud: -60.65, desvioHorario: '', ultimaFechaHoraGPS: null,
});

describe('norm', () => {
  it('quita tildes, diéresis y pasa a minúsculas', () => {
    expect(norm('Córdoba ÑANDÚ Güemes')).toBe('cordoba nandu guemes');
  });
  it('vacío y ASCII quedan igual', () => {
    expect(norm('')).toBe('');
    expect(norm('abc 123')).toBe('abc 123');
  });
});

describe('fmtDur (segundos)', () => {
  it('mínimo 1 min', () => { expect(fmtDur(0)).toBe('1 min'); expect(fmtDur(20)).toBe('1 min'); });
  it('minutos redondeados', () => { expect(fmtDur(90)).toBe('2 min'); expect(fmtDur(59 * 60)).toBe('59 min'); });
  it('horas con minutos de dos dígitos', () => {
    expect(fmtDur(3600)).toBe('1 h 00');
    expect(fmtDur(3600 + 5 * 60)).toBe('1 h 05');
    expect(fmtDur(2 * 3600 + 30 * 60)).toBe('2 h 30');
  });
});

describe('fmtDist (metros)', () => {
  it('redondea a decenas bajo 1 km', () => {
    expect(fmtDist(0)).toBe('0 m');
    expect(fmtDist(84)).toBe('80 m');
    expect(fmtDist(85)).toBe('90 m');
  });
  it('km con coma decimal', () => {
    expect(fmtDist(1000)).toBe('1,0 km');
    expect(fmtDist(1234)).toBe('1,2 km');
    expect(fmtDist(12500)).toBe('12,5 km');
  });
  it('999 m redondea a 1000 m (sin pasar a km)', () => expect(fmtDist(999)).toBe('1000 m'));
});

describe('fmtMin (minutos)', () => {
  it('<=0 => ahora', () => { expect(fmtMin(0)).toBe('ahora'); expect(fmtMin(-3)).toBe('ahora'); });
  it('minutos y horas', () => {
    expect(fmtMin(1)).toBe('1 min');
    expect(fmtMin(59)).toBe('59 min');
    expect(fmtMin(60)).toBe('1 h 00');
    expect(fmtMin(125)).toBe('2 h 05');
  });
});

describe('frecuencia', () => {
  it('menos de dos arribos => null', () => {
    expect(frecuencia([])).toBeNull();
    expect(frecuencia([arr(3)])).toBeNull();
  });
  it('promedio redondeado de los intervalos', () => {
    expect(frecuencia([arr(3), arr(13), arr(23)])).toBe(10);
    expect(frecuencia([arr(2), arr(9), arr(20)])).toBe(9); // (7 + 11) / 2
  });
  it('ignora intervalos no positivos (arribos duplicados)', () => {
    expect(frecuencia([arr(5), arr(5)])).toBeNull();
    expect(frecuencia([arr(5), arr(5), arr(15)])).toBe(10);
  });
});

describe('esEnVivo', () => {
  it('programado no es en vivo (sin importar mayúsculas)', () => {
    expect(esEnVivo(arr(5, 'Programado'))).toBe(false);
    expect(esEnVivo(arr(5, 'PROGRAMADO'))).toBe(false);
  });
  it('GPS con coordenadas válidas sí', () => expect(esEnVivo(arr(5, 'GPS'))).toBe(true));
  it('sin coordenadas válidas (0,0) no', () => {
    expect(esEnVivo({ ...arr(5), latitud: 0, longitud: 0 })).toBe(false);
    expect(esEnVivo({ ...arr(5), latitud: -32.9, longitud: 0 })).toBe(false);
  });
});
