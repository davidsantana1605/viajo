import type { Theme } from './mapStyle';

const FIXED: Record<string, number> = { K: 280, COSTA: 190 };

/** Matiz estable por código de línea (101, 102…). La variante (negro/rojo/verde) va aparte como etiqueta. */
export function hue(codigo: string): number {
  const n = parseInt(codigo, 10);
  if (!Number.isNaN(n)) return (n * 37 + 200) % 360;
  const k = codigo.toUpperCase();
  if (k in FIXED) return FIXED[k];
  let h = 0;
  for (const c of k) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export const lineColor = (codigo: string, theme: Theme) =>
  `hsl(${hue(codigo)} ${theme === 'dark' ? 80 : 72}% ${theme === 'dark' ? 62 : 46}%)`;

export const VARIANTE: Record<string, { label: string; css: string }> = {
  black: { label: 'Negro', css: '#2b2b30' },
  red: { label: 'Rojo', css: '#e5484d' },
  green: { label: 'Verde', css: '#30a46c' },
};
