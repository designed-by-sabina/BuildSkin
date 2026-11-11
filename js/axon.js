// Exploded isometric drawing of a wall assembly, built from its layer list (exterior → interior).
// Style: white faces, thin interior edges, heavy outer contour per layer, material linework on the faces.
//
// Model axes (inches): x along the wall, y through the wall (exterior y=0 → interior), z up.
// Seen from the exterior, above and to the left, so each layer shows its exterior face, left end and top.

const C = Math.cos(Math.PI / 6);
const S = 0.5;
const P = (x, y, z) => [(x - y) * C, -((x + y) * S + z)];

const MEMBRANE_T = 0.35; // drawn thickness for zero-thickness layers

// Which linework a layer gets, from its name/function. Display only.
export function layerKind(l) {
  const n = `${l.name ?? ''} ${l.function ?? ''}`.toLowerCase();
  if (l.kind) return l.kind;
  if (/brick|masonry|cmu/.test(n)) return 'brick';
  if (/stud/.test(n)) return 'stud';
  if (/insulation|mineral wool|polyiso|eps|xps/.test(n)) return 'insulation';
  if (/glass|glaz/.test(n)) return 'glass';
  if (/air/.test(n) && !(l.thickness_in > 0)) return 'membrane';
  if (/air/.test(n)) return 'air';
  if (/membrane|retarder|barrier|wrap/.test(n) || l.thickness_in === 0) return 'membrane';
  if (/plywood|osb|sheathing/.test(n)) return 'sheathing';
  if (/gypsum|gwb|drywall/.test(n)) return 'board';
  return 'plain';
}

// Returns { svg, anchors, box }.
// opts: w, h (panel size, in) · gap (explode distance, in) · stroke scale · opacity {layerIndex: 0..1}
//       labels: { x } → leader lines from each layer to a label column at x (drawing units); see anchors
export function assemblyAxon(layers, opts = {}) {
  const w = opts.w ?? 24;
  const h = opts.h ?? 34;
  const gap = opts.gap ?? 9;
  const k = opts.stroke ?? 1;
  const opacity = opts.opacity ?? {};
  const out = [];
  const anchors = [];

  let y = 0;
  const slabs = layers.map((l, i) => {
    const t = l.thickness_in > 0 ? l.thickness_in : MEMBRANE_T;
    const slab = { l, i, y0: y, y1: y + t, kind: layerKind(l) };
    y += t + gap;
    return slab;
  });

  // painter's order: interior (far) first
  for (const s of [...slabs].reverse()) out.push(drawSlab(s, w, h, k, opacity[s.i] ?? 1));
  for (const s of slabs) anchors.push({ index: s.i, at: P(w * 0.93, (s.y0 + s.y1) / 2, h) });

  // bounds of everything drawn
  const pts = slabs.flatMap(s => corners(0, w, s.y0, s.y1, 0, h));
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [px, py] of pts) {
    x0 = Math.min(x0, px); x1 = Math.max(x1, px);
    y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return { body: out.join(''), anchors, box: { x0, y0, x1, y1 } };
}

// Self-contained SVG string (thumbnails)
export function assemblySVG(layers, opts = {}) {
  const { body, box } = assemblyAxon(layers, opts);
  const pad = opts.pad ?? 4;
  const vb = [box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + 2 * pad, box.y1 - box.y0 + 2 * pad].map(v => v.toFixed(2)).join(' ');
  return `<svg class="axon" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(opts.title ?? 'Assembly')}">${body}</svg>`;
}

const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function corners(x0, x1, y0, y1, z0, z1) {
  const c = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) c.push(P(x, y, z));
  return c;
}

function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

const pt = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
const poly = (pts, attrs) => `<polygon points="${pts.map(pt).join(' ')}" ${attrs}/>`;
const seg = (a, b) => `M${pt(a)}L${pt(b)}`;

// Clip segment (u0,v0)-(u1,v1) to rect [0,W]×[0,H] (Liang–Barsky); returns null if outside
function clip(u0, v0, u1, v1, W, H) {
  let t0 = 0, t1 = 1;
  const du = u1 - u0, dv = v1 - v0;
  for (const [p, q] of [[-du, u0], [du, W - u0], [-dv, v0], [dv, H - v0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [u0 + t0 * du, v0 + t0 * dv, u0 + t1 * du, v0 + t1 * dv];
}

function drawSlab(s, w, h, k, alpha) {
  const { y0, y1, kind } = s;
  const t = y1 - y0;
  // stroke widths in screen px (the SVG uses non-scaling strokes)
  const thin = 0.7 * k, mid = 0.9 * k, heavy = 1.8 * k;
  // faces (visible from the exterior-left-top viewpoint)
  const front = [P(0, y0, 0), P(w, y0, 0), P(w, y0, h), P(0, y0, h)];
  const left = [P(0, y0, 0), P(0, y1, 0), P(0, y1, h), P(0, y0, h)];
  const top = [P(0, y0, h), P(w, y0, h), P(w, y1, h), P(0, y1, h)];
  const sil = hull(corners(0, w, y0, y1, 0, h));
  const g = [`<g class="layer layer-${kind}" data-layer="${s.i}" opacity="${alpha}">`];

  // On the exterior face: map face coordinates (u along x, v up z) to the drawing
  const F = (u, v) => P(u, y0, v);
  const T = (u, d) => P(u, y0 + d, h); // top face: u along x, d into the wall
  const L = (d, v) => P(0, y0 + d, v); // left end: d into the wall, v up
  let lines = '';
  let fine = '';

  if (kind === 'air') {
    // a void: dashed envelope only
    g.push(poly(sil, `fill="none" stroke="currentColor" stroke-width="${thin}" stroke-dasharray="3 2.5"`));
    g.push(`<path d="${seg(P(0, y0, h), P(w, y0, h))}${seg(P(0, y0, h), P(0, y1, h))}${seg(P(0, y0, h), P(0, y0, 0))}" fill="none" stroke="currentColor" stroke-width="${thin}" stroke-dasharray="3 2.5"/>`);
    g.push('</g>');
    return g.join('');
  }

  if (kind === 'stud') {
    // individual studs in a dashed envelope (open cavity), or in a hatched fill (cavity insulation)
    if (s.l.cavityFill) g.push(drawSlab({ ...s, kind: 'insulation' }, w, h, k, 1));
    else g.push(poly(sil, `fill="none" stroke="currentColor" stroke-width="${thin}" stroke-dasharray="3 2.5"`));
    const sw = 1.625, flange = 0.6;
    const studs = [];
    for (let x = w - 4; x > 0; x -= 16) studs.push(x - sw / 2);
    for (const x of studs) { // far (right) first: the viewer is at -x
      const a = x, b = x + sw;
      const f = [P(a, y0, 0), P(b, y0, 0), P(b, y0, h), P(a, y0, h)];
      const lf = [P(a, y0, 0), P(a, y1, 0), P(a, y1, h), P(a, y0, h)];
      const tp = [P(a, y0, h), P(b, y0, h), P(b, y1, h), P(a, y1, h)];
      g.push(poly(lf, `fill="#fff" stroke="none"`), poly(f, `fill="#fff" stroke="none"`), poly(tp, `fill="#fff" stroke="none"`));
      // C-profile on the cut top
      const cp = [[b, y0 + flange], [b, y0], [a, y0], [a, y1], [b, y1], [b, y1 - flange]].map(([u, d]) => P(u, d, h));
      g.push(`<path d="M${cp.map(pt).join('L')}" fill="none" stroke="currentColor" stroke-width="${mid}"/>`);
      g.push(`<path d="${seg(P(a, y0, h), P(a, y0, 0))}${seg(P(b, y0, h), P(b, y0, 0))}" fill="none" stroke="currentColor" stroke-width="${thin}"/>`);
      g.push(poly(hull(corners(a, b, y0, y1, 0, h)), `fill="none" stroke="currentColor" stroke-width="${mid}"`));
    }
    g.push('</g>');
    return g.join('');
  }

  // solid layer: faces
  const fill = `fill="#fff" stroke="none"`;
  g.push(poly(left, fill), poly(top, fill), poly(front, fill));

  switch (kind) {
    case 'brick': {
      const course = 2.6667, len = 8;
      for (let v = course, r = 1; v < h - 0.01; v += course, r++) lines += seg(F(0, v), F(w, v)) + seg(L(0, v), L(t, v));
      for (let v = 0, r = 0; v < h - 0.01; v += course, r++) {
        for (let u = (r % 2 ? len / 2 : len); u < w - 0.01; u += len) lines += seg(F(u, v), F(u, Math.min(v + course, h)));
      }
      // head joints on the top course, carried across the top
      const r = Math.floor((h - 0.01) / course);
      for (let u = (r % 2 ? len / 2 : len); u < w - 0.01; u += len) lines += seg(T(u, 0), T(u, t));
      break;
    }
    case 'insulation': {
      // rigid board: diagonal hatch on the face, zig-zag batt symbol on the top
      for (let c = -h; c < w; c += 3) {
        const q = clip(c, 0, c + h, h, w, h);
        if (q) fine += seg(F(q[0], q[1]), F(q[2], q[3]));
      }
      const zz = [];
      const n = Math.max(2, Math.round(w / 2.5));
      for (let i = 0; i <= n; i++) zz.push(T((i / n) * w, i % 2 ? t * 0.85 : t * 0.15));
      lines += `M${zz.map(pt).join('L')}`;
      break;
    }
    case 'sheathing':
      lines += seg(F(w * 0.5, 0), F(w * 0.5, h)) + seg(T(w * 0.5, 0), T(w * 0.5, t));
      for (let v = 3; v < h; v += 7) fine += seg(F(1.5, v), F(w * 0.5 - 1.5, v + 1.2)) + seg(F(w * 0.5 + 1.5, v + 3), F(w - 1.5, v + 4.2));
      break;
    case 'glass':
      for (const c of [w * 0.15, w * 0.3]) {
        const q = clip(c, 0, c + h * 0.5, h * 0.5, w, h);
        if (q) fine += seg(F(q[0], q[1] + h * 0.35), F(q[2], q[3] + h * 0.35));
      }
      break;
    case 'membrane':
      for (let u = 2; u < w; u += 4) fine += seg(F(u, 0), F(u, h));
      break;
    case 'board':
      lines += seg(F(0, h * 0.62), F(w, h * 0.62));
      break;
  }
  if (fine) g.push(`<path d="${fine}" fill="none" stroke="currentColor" stroke-width="${thin * 0.75}" opacity=".7"/>`);
  if (lines) g.push(`<path d="${lines}" fill="none" stroke="currentColor" stroke-width="${thin}"/>`);
  // the three inner box edges, then the heavy contour
  g.push(`<path d="${seg(P(0, y0, h), P(w, y0, h))}${seg(P(0, y0, h), P(0, y1, h))}${seg(P(0, y0, h), P(0, y0, 0))}" fill="none" stroke="currentColor" stroke-width="${mid}"/>`);
  g.push(poly(sil, `fill="none" stroke="currentColor" stroke-width="${heavy}" stroke-linejoin="round"`));
  g.push('</g>');
  return g.join('');
}
