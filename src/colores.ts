/** Temas de color: cambia el acento de la app y el logo (los valores viven en style.css, [data-color]). */
const COLORES: [string, string, string][] = [
  ['azul', 'Azul', '#007aff'], ['rosa', 'Rosa', '#ff2d78'], ['verde', 'Verde', '#22b45a'],
  ['violeta', 'Violeta', '#8b5cf6'], ['naranja', 'Naranja', '#ff8a00'], ['rojo', 'Rojo', '#ff3b30'], ['turquesa', 'Turquesa', '#00b3b8'],
];

function favicon(c: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='${c}'/><path d='M18 40V24a6 6 0 0 1 6-6h16a6 6 0 0 1 6 6v16a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3z' fill='white'/><rect x='22' y='23' width='20' height='9' rx='2' fill='${c}'/><circle cx='25' cy='38' r='2' fill='${c}'/><circle cx='39' cy='38' r='2' fill='${c}'/></svg>`;
  document.querySelector<HTMLLinkElement>('link[rel=icon]')?.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
}

export function initColores(onChange?: () => void) {
  let actual = 'azul';
  try { const g = localStorage.getItem('viajo-color'); if (g && COLORES.some((c) => c[0] === g)) actual = g; } catch { /* sin storage */ }
  const aplicar = (k: string) => {
    actual = k;
    if (k === 'azul') delete document.documentElement.dataset.color; else document.documentElement.dataset.color = k;
    favicon(COLORES.find((c) => c[0] === k)![2]);
    try { localStorage.setItem('viajo-color', k); } catch { /* sin storage */ }
    pop.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    onChange?.();
  };
  const pop = document.createElement('div');
  pop.className = 'swatches'; pop.hidden = true; pop.setAttribute('role', 'group'); pop.setAttribute('aria-label', 'Color de la app');
  pop.innerHTML = COLORES.map(([k, n, c]) => `<button type="button" data-k="${k}" style="--c:${c}" aria-label="${n}" title="${n}" aria-pressed="false"></button>`).join('');
  document.body.appendChild(pop);
  const btn = document.querySelector<HTMLButtonElement>('#btn-color')!;
  btn.onclick = (e) => {
    e.stopPropagation();
    if (pop.hidden) { const r = btn.getBoundingClientRect(); pop.hidden = false; pop.style.top = r.top + 'px'; pop.style.right = innerWidth - r.left + 8 + 'px'; } else pop.hidden = true;
  };
  pop.onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (b) aplicar(b.dataset.k!); };
  document.addEventListener('click', () => { pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
  aplicar(actual);
}
