// Detail scale: one assembly, exploded, with the data tied to it and the parts that can be customized.
// Customizations are stored per assembly in the browser and are what-if / display only:
// they do not feed the calculator's compliance numbers.
import { mountNav, storageGet, storageSet, customKey } from './common.js';
import { loadAssemblies, layerR } from './assemblies.js';
import { assemblyAxon, layerKind } from './axon.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const todo = t => `<span class="todo" title="${esc(t ?? '')}">No data</span>`;
const params = new URLSearchParams(location.search);

mountNav($('nav'), 2);
if (params.get('m')) $('back').href = 'calculator.html?m=' + encodeURIComponent(params.get('m'));

let A = null; // the assembly
let library = [];
let custom = null;

init();

async function init() {
  const data = await loadAssemblies();
  library = data.assemblies;
  A = library.find(a => a.id === params.get('id')) ?? library[0];
  if (!A) return ($('aName').textContent = 'No assemblies in data/assemblies.json');
  custom = { ins: 'none', insT: 2, insR: '', opacity: 1, ...storageGet(customKey(A.id), {}) };
  document.title = `BuildSkin · ${A.name}`;
  $('aName').textContent = A.name;
  $('aSub').textContent = [A.description, `${A.depth_in} in`, A.source?.tool].filter(Boolean).join(' · ');
  new ResizeObserver(() => layoutCallouts()).observe($('axon'));
  render();
}

function save() {
  storageSet(customKey(A.id), custom);
  render();
}

// ---------- Layers with customizations applied ----------

const isCladding = (l, i) => l.is_cladding || (i === 0 && !A.layers.some(x => x.is_cladding));

// Where insulation goes: continuous = just outboard of the sheathing (or behind the cladding);
// cavity = fills the stud layer.
function customLayers() {
  const layers = A.layers.map(l => ({ ...l }));
  if (custom.ins === 'continuous') {
    let at = layers.findIndex(l => /substrate/i.test(l.function ?? '') || layerKind(l) === 'sheathing');
    if (at < 0) at = Math.min(1, layers.length);
    layers.splice(at, 0, {
      name: 'Insulation, continuous (custom)',
      kind: 'insulation',
      thickness_in: Math.max(0.25, +custom.insT || 0),
      custom: true,
    });
  }
  if (custom.ins === 'cavity') {
    const stud = layers.find(l => layerKind(l) === 'stud');
    if (stud) stud.cavityFill = true;
  }
  return layers;
}

// The layer the insulation callout hangs off
function insulationAnchor(layers) {
  const i = layers.findIndex(l => l.custom);
  if (i >= 0) return i;
  const s = layers.findIndex(l => layerKind(l) === 'stud');
  if (s >= 0) return s;
  const st = layers.findIndex(l => l.structural);
  return st >= 0 ? st : Math.min(1, layers.length - 1);
}

// Nominal R added by the user's insulation (R/in × in). Not an effective value: no bridging.
function customR() {
  const r = +custom.insR;
  if (!(r > 0) || custom.ins === 'none') return null;
  if (custom.ins === 'cavity') {
    const stud = A.layers.find(l => layerKind(l) === 'stud');
    return stud ? r * stud.thickness_in : null;
  }
  return r * (+custom.insT || 0);
}

// ---------- Render ----------

function render() {
  const layers = customLayers();
  renderImpact();
  renderDrawing(layers);
  renderCustom();
  renderTriad();
}

function renderDrawing(layers) {
  const cladIdx = layers.findIndex(isCladding);
  const { body, anchors, box } = assemblyAxon(layers, { w: 24, h: 34, gap: 10, stroke: 1, opacity: { [cladIdx]: custom.opacity } });
  const pad = 6;
  const vb = [box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + 2 * pad, box.y1 - box.y0 + 2 * pad];
  const insAt = insulationAnchor(layers);

  const wrap = $('axon');
  wrap.innerHTML = `
    <svg class="axon axon-main" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet">${body}</svg>
    <svg class="leaders" aria-hidden="true"></svg>
    ${layers.map((l, i) => callout(l, i, i === cladIdx, i === insAt)).join('')}`;
  wrap._layout = { vb, anchors };

  wrap.querySelectorAll('[data-in]').forEach(el => {
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      custom[el.dataset.in] = el.type === 'range' || el.type === 'number' ? +el.value : el.value;
      if (el.type === 'range') {
        // live: just change the drawing, no full re-render (keeps the slider focused)
        wrap.querySelector(`.axon-main [data-layer="${cladIdx}"]`)?.setAttribute('opacity', el.value);
        el.nextElementSibling.textContent = Math.round(el.value * 100) + '%';
        storageSet(customKey(A.id), custom);
        return;
      }
      save();
    });
  });
  wrap.querySelectorAll('.callout').forEach(c => {
    const i = c.dataset.layer;
    const g = () => wrap.querySelector(`.axon-main [data-layer="${i}"]`);
    c.addEventListener('mouseenter', () => g()?.classList.add('hot'));
    c.addEventListener('mouseleave', () => g()?.classList.remove('hot'));
  });
  requestAnimationFrame(layoutCallouts);
}

function callout(l, i, cladding, insulation) {
  const r = layerR(l);
  const meta = [
    l.thickness_in > 0 ? `${+l.thickness_in.toFixed(3)} in` : 'membrane',
    l.function,
    r != null && !l.custom ? `R ${r.toFixed(2)}${/air/i.test(l.thermal_asset ?? '') || layerKind(l) === 'air' ? ' ⚠ still-air k' : ''}` : null,
  ].filter(Boolean).join(' · ');
  let extra = '';
  if (cladding) {
    extra += `<label class="ctl">Opacity
      <span class="range"><input type="range" min="0.15" max="1" step="0.05" value="${custom.opacity}" data-in="opacity" aria-label="Exterior layer opacity"><output>${Math.round(custom.opacity * 100)}%</output></span>
      <small>Display only · not yet linked to VT / SHGC</small></label>`;
  }
  if (insulation) {
    const hasStud = A.layers.some(x => layerKind(x) === 'stud');
    extra += `<label class="ctl">Insulation
      <select data-in="ins">
        <option value="none" ${custom.ins === 'none' ? 'selected' : ''}>None (as modeled)</option>
        <option value="continuous" ${custom.ins === 'continuous' ? 'selected' : ''}>Custom · continuous</option>
        ${hasStud ? `<option value="cavity" ${custom.ins === 'cavity' ? 'selected' : ''}>Custom · stud cavity</option>` : ''}
      </select></label>
      ${custom.ins !== 'none' ? `<div class="ctl-row">
        ${custom.ins === 'continuous' ? `<label>Thickness <input type="number" min="0.25" step="0.25" value="${esc(custom.insT)}" data-in="insT"> in</label>` : ''}
        <label>R / in <input type="number" min="0" step="0.1" value="${esc(custom.insR)}" placeholder="enter" data-in="insR"></label>
      </div>` : ''}`;
  }
  return `<div class="callout${l.custom ? ' is-custom' : ''}${extra ? ' has-ctl' : ''}" data-layer="${i}">
    <div class="c-name">${esc(l.name)}</div>
    <div class="c-meta">${esc(meta)}</div>${extra}</div>`;
}

// Place callouts in a column right of the drawing, in anchor order, without overlaps; draw leaders.
function layoutCallouts() {
  const wrap = $('axon');
  const L = wrap._layout;
  if (!L) return;
  const svg = wrap.querySelector('.axon-main');
  const leaders = wrap.querySelector('.leaders');
  const W = wrap.clientWidth;
  const narrow = W < 640;
  wrap.classList.toggle('stacked', narrow);
  const drawW = narrow ? W : W * 0.56;
  const [vx, vy, vw, vh] = L.vb;
  const drawH = Math.min(narrow ? W * 0.9 : 640, (drawW / vw) * vh);
  svg.style.width = drawW + 'px';
  svg.style.height = drawH + 'px';
  const s = Math.min(drawW / vw, drawH / vh);
  const ox = (drawW - vw * s) / 2, oy = (drawH - vh * s) / 2;
  const toPx = ([x, y]) => [ox + (x - vx) * s, oy + (y - vy) * s];

  const cards = [...wrap.querySelectorAll('.callout')];
  if (narrow) {
    // stacked under the drawing, no leaders
    leaders.innerHTML = '';
    wrap.style.height = '';
    cards.forEach(c => (c.style.cssText = ''));
    return;
  }
  const colX = drawW + 60;
  const items = L.anchors
    .map(a => ({ a, p: toPx(a.at), el: cards.find(c => +c.dataset.layer === a.index) }))
    .filter(x => x.el)
    .sort((m, n) => m.p[1] - n.p[1]);
  items.forEach(it => {
    it.el.style.left = colX + 'px';
    it.el.style.width = Math.max(180, W - colX) + 'px';
    it.h = it.el.offsetHeight;
  });
  const GAP = 10;
  let y = 0;
  for (const it of items) {
    it.top = Math.max(y, it.p[1] - it.h / 2);
    y = it.top + it.h + GAP;
  }
  // pull the stack up if it ran far below the drawing
  const over = y - GAP - Math.max(drawH, 0);
  if (over > 0) {
    let shift = Math.min(over, items[0]?.top ?? 0);
    items.forEach(it => (it.top -= shift));
  }
  const H = Math.max(drawH, ...items.map(it => it.top + it.h));
  wrap.style.height = H + 'px';
  leaders.setAttribute('viewBox', `0 0 ${W} ${H}`);
  leaders.setAttribute('width', W);
  leaders.setAttribute('height', H);
  // Orthogonal leaders: right from the layer, down/up at a staggered elbow, right into the callout.
  // Elbows step left as anchors go down, so no two leaders cross.
  const n = items.length;
  const step = Math.min(7, 40 / Math.max(1, n - 1));
  leaders.innerHTML = items
    .map((it, i) => {
      it.el.style.top = it.top + 'px';
      const ly = it.top + 14;
      const [ax, ay] = it.p.map(v => +v.toFixed(1));
      const ex = Math.max(ax + 6, drawW + 4 + (n - 1 - i) * step).toFixed(1);
      return `<path d="M${ax},${ay} H${ex} V${ly.toFixed(1)} H${colX}"/><circle cx="${ax}" cy="${ay}" r="2.2"/>`;
    })
    .join('');
}

// ---------- Environmental impact (left) ----------

function renderImpact() {
  const ec = A.embodied_carbon ?? {};
  const cost = A.cost ?? {};
  const rep = A.reported ?? {};
  const layersWithEpd = A.layers.filter(l => l.epd).length;
  const cr = customR();
  const row = (label, value, note) => `<div class="i-row"><span>${label}${note ? `<small>${note}</small>` : ''}</span><span>${value}</span></div>`;
  const money = v => (v == null ? todo('Not built yet. Hook only.') : `$${(+v).toFixed(2)}`);
  $('impact').innerHTML = `
    <h2 class="i-head">Environmental impact</h2>
    <div class="i-group">
      <div class="label">Embodied carbon</div>
      ${row('GWP A1–A3', ec.gwp_a1a3_kgco2e_per_sf != null ? `${ec.gwp_a1a3_kgco2e_per_sf} kgCO₂e/SF` : todo(ec.TODO))}
      ${row('EPD', ec.epd ? esc(ec.epd) : todo(ec.TODO))}
      ${row('Layers with EPD', `${layersWithEpd} / ${A.layers.length}`)}
    </div>
    <div class="i-group">
      <div class="label">Thermal</div>
      ${row('R-value', rep.r_value != null ? `R-${(+rep.r_value).toFixed(1)}${A.u_verified ? '' : ' <b class="warn-mark" title="Unverified: not valid for compliance">⚠</b>'}` : todo(), rep.verified === false ? `Reported by ${esc((A.source?.tool ?? '').split(' ').slice(0, 2).join(' '))}, unverified` : '')}
      ${row('Effective U', A.effective?.u_value != null ? A.effective.u_value : todo(A.effective?.TODO))}
      ${row('Thermal mass', rep.heat_capacity != null ? `${(+rep.heat_capacity).toFixed(2)} BTU/SF·°F` : todo())}
      ${custom.ins !== 'none' ? row('Custom insulation', cr != null ? `+R-${cr.toFixed(1)}` : '<span class="todo">Enter R / in</span>', 'Nominal, user input · no bridging') : ''}
    </div>
    <div class="i-group">
      <div class="label">Cost</div>
      ${row('Material', money(cost.material_per_sf), 'per SF')}
      ${row('Labor', money(cost.labor_per_sf), 'per SF')}
    </div>
    <div class="i-group">
      <div class="label">Light</div>
      ${row('Opaque', A.optical?.opaque ? 'Yes' : 'No')}
      ${row('WWR', Math.round((A.wwr ?? 0) * 100) + '%')}
      ${row('SHGC', A.shgc ?? 'N/A')}
      ${row('VT', A.vt ?? 'N/A')}
    </div>`;
}

// ---------- Customize (right) ----------

function renderCustom() {
  const n = (custom.ins !== 'none') + (custom.opacity < 1);
  $('custom').innerHTML = `
    <p class="muted-note">Use the callouts on the drawing: <b>Opacity</b> on the exterior layer, <b>Insulation</b> on the cavity. Changes are saved in this browser for this assembly and don't change calculator results yet.</p>
    <div class="custom-foot">
      <span>${n ? `${n} change${n > 1 ? 's' : ''}` : 'As modeled'}</span>
      ${n ? '<button class="link" id="resetCustom">Reset</button>' : ''}
    </div>`;
  $('resetCustom')?.addEventListener('click', () => {
    custom = { ins: 'none', insT: 2, insR: '', opacity: 1 };
    save();
  });
}

// ---------- Impact / cost / efficiency triad ----------
// Each node is coloured green → red by where this assembly sits in the library on that metric
// (lower carbon, lower cost, lower U = greener). Grey when there's no data.

const metrics = {
  impact: a => a.embodied_carbon?.gwp_a1a3_kgco2e_per_sf ?? null,
  cost: a => (a.cost?.material_per_sf != null || a.cost?.labor_per_sf != null ? (a.cost.material_per_sf ?? 0) + (a.cost.labor_per_sf ?? 0) : null),
  efficiency: a => (a.u_verified ? a.u_factor : null),
};

function score(key) {
  const v = metrics[key](A);
  if (v == null) return null;
  const vals = library.map(metrics[key]).filter(x => x != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return hi > lo ? (v - lo) / (hi - lo) : 0.5;
}

const scoreColor = t => `hsl(${Math.round(130 * (1 - t))} 62% 46%)`;

function renderTriad() {
  const nodes = [
    { key: 'impact', label: 'Impact', x: 130, y: 22 },
    { key: 'cost', label: 'Cost', x: 40, y: 150 },
    { key: 'efficiency', label: 'Efficiency', x: 205, y: 150 },
  ];
  nodes.forEach(n => (n.t = score(n.key)));
  const box = n => {
    const w = n.label.length * 7.4 + 26;
    const fill = n.t == null ? 'url(#nodata)' : scoreColor(n.t);
    return `<g class="node${n.t == null ? ' none' : ''}">
      <rect x="${n.x - w / 2}" y="${n.y - 15}" width="${w}" height="30" fill="${fill}"/>
      <text x="${n.x}" y="${n.y + 4.5}" text-anchor="middle">${n.label}</text>
      ${n.t == null ? `<text class="nd" x="${n.x}" y="${n.y + 30}" text-anchor="middle">no data</text>` : ''}
    </g>`;
  };
  const [a, b, c] = nodes;
  $('triad').innerHTML = `
    <svg class="triad" viewBox="0 0 260 190" role="img" aria-label="Impact, cost and efficiency, coloured green to red">
      <defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#e2e2e2" stroke-width="1.5"/></pattern></defs>
      <path class="edge" d="M${a.x},${a.y + 15} L${b.x},${b.y - 15} M${a.x},${a.y + 15} L${c.x},${c.y - 15} M${b.x + 23},${b.y} L${c.x - 50},${c.y}"/>
      ${nodes.map(box).join('')}
    </svg>
    <div class="scale"><span>Better</span><i></i><span>Worse</span></div>
    <p class="muted-note">Ranked against the ${library.length} assembl${library.length === 1 ? 'y' : 'ies'} in the library. Cost and embodied carbon are not in the data yet, and efficiency needs a verified effective U.</p>`;
}

