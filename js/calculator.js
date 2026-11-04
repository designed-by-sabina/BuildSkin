import * as THREE from 'three';
import { mountNav, storageGet, storageSet, download, fmtInt } from './common.js';
import { buildMassing } from './massing-core.js';
import { Viewer, createMassingGroup, baseMaterial } from './viewer.js';
import { patternCanvas, drawSwatch } from './patterns.js';
import { loadAssemblies } from './assemblies.js';
import { initPanels, renderPanels } from './panels.js';
import { getMassing, getCurrentMassingId, setCurrentMassingId, listMassings, loadMassingText } from './massings.js';

const PER_PAGE = 9;
const $ = id => document.getElementById(id);

const state = {
  categories: [],
  assemblies: [],
  byId: new Map(),
  category: null,
  page: 0,
  selected: null, // assembly chosen in the library
  massingInfo: null,
  massing: null,
  assignments: new Map(), // surface index -> assembly id
  picked: null, // surface last clicked in the viewer
  totals: null,
  stale: true,
};

const ROWS = [
  [['Cladding Material', 'cladding'], ['Building Facade Structure Material', 'structure']],
  [['Facade Area', 'area'], ['Assembly Depth', 'depth']],
  [['Weighted-average U-FACTOR', 'u'], ['Insulation R-VALUES', 'r']],
  [['SHGC (Solar Heat Gain Coefficient)', 'shgc'], ['VT (Visible Transmittance)', 'vt']],
  [['Fenestration Ratio', 'wwr'], ['Double skin Facade Coverage', 'dsf']],
  [['Thermal Mass (heat capacity)', 'hc']],
];
// Embodied carbon and labor cost: data hooks only (assembly.embodied_carbon / assembly.cost), not calculated yet.

mountNav($('nav'), 2);
const mainView = new Viewer($('viewMain'), { view: 'front' });
const miniView = new Viewer($('viewMini'), { view: 'back' });
buildTable($('bigTable'), ['Selected', 'Total']);
buildTable($('miniTable'), ['Applied', 'Total']);
init();

async function init() {
  const data = await loadAssemblies();
  state.categories = data.categories;
  state.assemblies = data.assemblies;
  state.category = data.categories[0]?.id ?? null;
  state.assemblies.forEach(a => state.byId.set(a.id, a));
  await initPanels(state);
  renderTabs();
  renderLibrary();
  wireViewer(mainView);
  wireViewer(miniView);
  wireActions();
  await loadCurrentMassing();
  refresh();
  (function loop() {
    mainView.render();
    miniView.render();
    requestAnimationFrame(loop);
  })();
}

// ---------- Library ----------

function renderTabs() {
  const el = $('tabs');
  el.replaceChildren(
    ...state.categories.map(c => {
      const b = document.createElement('button');
      b.className = 'tab' + (c.id === state.category ? ' active' : '');
      b.textContent = c.label;
      b.setAttribute('role', 'tab');
      b.onclick = () => {
        state.category = c.id;
        state.page = 0;
        renderTabs();
        renderLibrary();
      };
      return b;
    })
  );
}

function renderLibrary() {
  const items = state.assemblies.filter(a => a.category === state.category);
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const pager = $('pager');
  pager.max = pages - 1;
  pager.value = state.page;
  pager.disabled = pages === 1;

  const cells = [];
  for (let i = 0; i < PER_PAGE; i++) {
    const a = items[state.page * PER_PAGE + i];
    const cell = document.createElement(a ? 'button' : 'div');
    cell.className = 'lib-cell';
    if (a) {
      cell.classList.toggle('selected', state.selected?.id === a.id);
      cell.title = a.name;
      cell.append(thumbFor(a));
      const cap = document.createElement('span');
      cap.className = 'lib-cap';
      cap.textContent = a.name;
      cell.append(cap);
      cell.onclick = () => {
        state.selected = state.selected?.id === a.id ? null : a;
        renderLibrary();
        refresh();
      };
    }
    cells.push(cell);
  }
  $('libGrid').replaceChildren(...cells);
}

function thumbFor(a) {
  const swatch = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 240;
    drawSwatch(c, a.pattern);
    return c;
  };
  if (!a.thumb) return swatch();
  const img = new Image();
  img.alt = a.name;
  img.src = a.thumb;
  img.onerror = () => img.replaceWith(swatch());
  return img;
}

$('pager').addEventListener('input', e => {
  state.page = +e.target.value;
  renderLibrary();
});

// ---------- Massing / 3D ----------

async function loadCurrentMassing() {
  const param = new URLSearchParams(location.search).get('m');
  let info = await getMassing(param ?? getCurrentMassingId());
  info ??= (await listMassings())[0];
  if (!info) return showEmpty('No massing loaded — upload one on 02 MASSING.');
  setCurrentMassingId(info.id);
  try {
    state.massing = buildMassing(await loadMassingText(info), info);
  } catch (err) {
    return showEmpty(`Could not read ${info.name}: ${err.message}`);
  }
  state.massingInfo = info;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(createMassingGroup(state.massing));
  state.hover = overlay(0.08);
  state.pickMark = overlay(0.2);
  scene.add(state.hover, state.pickMark);
  mainView.setScene(scene, state.massing.viewBounds);
  miniView.setScene(scene, state.massing.viewBounds);

  const saved = storageGet(projectKey());
  if (saved?.assignments) {
    for (const [i, id] of Object.entries(saved.assignments)) {
      if (state.byId.has(id) && state.massing.surfaces[i]?.kind === 'wall') state.assignments.set(+i, id);
    }
    state.massing.walls.forEach(paint);
    calculate();
  }
}

function showEmpty(msg) {
  $('emptyMsg').textContent = msg;
  $('emptyMsg').hidden = false;
}

function overlay(opacity) {
  const m = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  m.visible = false;
  return m;
}

function mark(mesh, surface) {
  mesh.visible = !!surface;
  if (surface) mesh.geometry = surface.geometry;
}

const materials = new Map();
const defaultWall = baseMaterial();

function materialFor(a) {
  if (!materials.has(a.id)) {
    const tex = new THREE.CanvasTexture(patternCanvas(a.pattern.type));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1 / a.pattern.w, 1 / a.pattern.h);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = mainView.renderer.capabilities.getMaxAnisotropy();
    const m = baseMaterial();
    m.color.set(0xffffff);
    m.map = tex;
    materials.set(a.id, m);
  }
  return materials.get(a.id);
}

function paint(s) {
  const id = state.assignments.get(s.index);
  s.mesh.material = id ? materialFor(state.byId.get(id)) : defaultWall;
}

function wireViewer(view) {
  let down = null;
  const meshes = () => state.massing?.surfaces.map(s => s.mesh) ?? [];
  const wallAt = e => {
    const s = view.pick(e, meshes())?.userData.surface;
    return s?.kind === 'wall' ? s : null;
  };
  view.canvas.addEventListener('pointerdown', e => (down = { x: e.clientX, y: e.clientY }));
  view.canvas.addEventListener('pointermove', e => {
    if (!state.massing || e.buttons) return;
    const s = wallAt(e);
    mark(state.hover, s);
    view.canvas.style.cursor = s ? 'pointer' : '';
  });
  view.canvas.addEventListener('pointerleave', () => mark(state.hover, null));
  view.canvas.addEventListener('pointerup', e => {
    if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const s = wallAt(e);
    if (!s) return;
    if (e.altKey) assign([s], null);
    else if (!e.shiftKey && state.selected) assign([s], state.selected.id);
    state.picked = s;
    mark(state.pickMark, s);
    refresh();
  });
  view.canvas.addEventListener('dblclick', () => view.reset());
}

function assign(surfaces, id) {
  for (const s of surfaces) {
    if (id) state.assignments.set(s.index, id);
    else state.assignments.delete(s.index);
    paint(s);
  }
  state.stale = true;
}

// ---------- Calculations ----------

function entriesWhere(pred) {
  if (!state.massing) return [];
  return state.massing.walls
    .filter(s => state.assignments.has(s.index) && pred(s))
    .map(s => ({ surface: s, area: s.area, a: state.byId.get(state.assignments.get(s.index)) }));
}

// Area-weighted summary of a set of {a: assembly, area} entries.
// With no area but a fallback assembly, reports that assembly's intrinsic values.
function summarize(entries, { fallback = null, facadeArea = null } = {}) {
  const assigned = entries.reduce((s, e) => s + e.area, 0);
  const list = assigned ? entries : fallback ? [{ a: fallback, area: 1 }] : [];
  const W = list.reduce((s, e) => s + e.area, 0);
  const area = facadeArea ?? assigned;
  if (!W) return { area: area ? fmtInt(area) + ' SF' : '—' };

  const same = f => {
    const v = [...new Set(list.map(e => f(e.a)))];
    return v.length === 1 ? v[0] : 'Varies';
  };
  const wavg = f => list.reduce((s, e) => s + f(e.a) * e.area, 0) / W;
  const glazed = list.filter(e => e.a.shgc != null && e.a.wwr > 0);
  const GA = glazed.reduce((s, e) => s + e.area * e.a.wwr, 0);
  const gavg = k => (GA ? (glazed.reduce((s, e) => s + e.a[k] * e.area * e.a.wwr, 0) / GA).toFixed(2) : 'N/A');
  const dsf = list.filter(e => e.a.double_skin).reduce((s, e) => s + e.area, 0);
  const depth = same(a => a.depth_in);
  const unverified = list.some(e => !e.a.u_verified);
  const hcList = list.filter(e => e.a.heat_capacity != null);

  return {
    cladding: same(a => a.cladding),
    structure: same(a => a.structure),
    area: fmtInt(area) + ' SF',
    depth: depth === 'Varies' ? depth : `${depth} in`,
    u: list.every(e => e.a.u_factor != null) ? wavg(a => a.u_factor).toFixed(4) + (unverified ? ' ⚠' : '') : 'TODO',
    r: same(a => a.r_label),
    shgc: gavg('shgc'),
    vt: gavg('vt'),
    wwr: Math.round(wavg(a => a.wwr) * 100) + '%',
    dsf: dsf ? Math.round((dsf / W) * 100) + '%' : 'N/A',
    hc: hcList.length !== list.length ? 'TODO'
      : assigned ? fmtInt(entries.reduce((s, e) => s + e.a.heat_capacity * e.area, 0)) + ' BTU/°F'
      : `${fallback.heat_capacity} BTU/SF·°F`,
  };
}

function calculate() {
  state.totals = summarize(entriesWhere(() => true), { facadeArea: state.massing?.wallArea ?? 0 });
  state.stale = false;
  document.querySelectorAll('.actions .muted').forEach(b => b.classList.remove('muted'));
}

function refresh() {
  const sel = state.selected;
  const selected = sel ? summarize(entriesWhere(s => state.assignments.get(s.index) === sel.id), { fallback: sel }) : {};
  const p = state.picked;
  const pickedA = p && state.byId.get(state.assignments.get(p.index));
  const applied = p ? (pickedA ? summarize([{ a: pickedA, area: p.area }]) : { area: fmtInt(p.area) + ' SF', cladding: 'Unassigned' }) : {};
  const totals = state.totals ?? {};

  fillTable($('bigTable'), [selected, totals]);
  fillTable($('miniTable'), [applied, totals]);
  document.querySelectorAll('.data-table').forEach(t => t.classList.toggle('stale', state.stale && !!state.totals));
  renderPanels(state);

  const m = state.massing;
  if (!m) return ($('status').textContent = '');
  const done = entriesWhere(() => true).reduce((s, e) => s + e.area, 0);
  $('status').textContent =
    `${state.massingInfo.name.toUpperCase()} · ${fmtInt(m.wallArea)} SF FACADE · ${Math.round((done / m.wallArea) * 100) || 0}% ASSIGNED` +
    (p ? ` · SURFACE ${p.index} (${p.orientation})` : '');
}

function buildTable(el, headers) {
  const head = `<div class="dt-row dt-head"><span></span>${headers.map(h => `<span>${h}</span>`).join('')}</div>`;
  const body = ROWS.map(
    group => `<div class="dt-group">${group.map(([label, key]) => `<div class="dt-row"><span>${label}</span><span data-k="${key}" data-c="0"></span><span data-k="${key}" data-c="1"></span></div>`).join('')}</div>`
  ).join('');
  el.innerHTML = head + body;
}

function fillTable(el, cols) {
  el.querySelectorAll('[data-k]').forEach(span => {
    span.textContent = cols[span.dataset.c][span.dataset.k] ?? '—';
  });
}

// ---------- Actions ----------

// 'facade:' prefix predates the BuildSkin rename; kept so saved projects still load
function projectKey() {
  return 'facade:project:' + state.massingInfo?.id;
}

function projectData() {
  return {
    app: 'buildskin',
    version: 2,
    savedAt: new Date().toISOString(),
    massing: { id: state.massingInfo.id, name: state.massingInfo.name, units: state.massingInfo.units, up: state.massingInfo.up },
    assignments: Object.fromEntries(state.assignments),
    totals: state.totals,
  };
}

function slug() {
  return (state.massingInfo?.name ?? 'project').replace(/[^\w-]+/g, '-').toLowerCase();
}

function wireActions() {
  $('btnCalc').onclick = () => {
    if (!state.massing) return;
    calculate();
    refresh();
  };
  $('btnSave').onclick = () => {
    if (!state.massing) return;
    if (state.stale) calculate();
    const data = projectData();
    storageSet(projectKey(), data);
    download(`${slug()}-buildskin.json`, JSON.stringify(data, null, 2), 'application/json');
    refresh();
  };
  $('btnExport').onclick = () => {
    if (!state.massing) return;
    if (state.stale) calculate();
    download(`${slug()}-buildskin-schedule.csv`, scheduleCsv(), 'text/csv');
    refresh();
  };
  $('applyAll').onclick = () => {
    if (state.massing && state.selected) assign(state.massing.walls, state.selected.id);
    refresh();
  };
  $('clearAll').onclick = () => {
    if (state.massing) assign(state.massing.walls, null);
    refresh();
  };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    state.selected = null;
    state.picked = null;
    mark(state.pickMark, null);
    renderLibrary();
    refresh();
  });
}

function scheduleCsv() {
  const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const rows = [['Surface', 'Orientation', 'Area (SF)', 'Assembly ID', 'Assembly', 'Cladding', 'Structure', 'Depth (in)', 'U-factor (BTU/h·SF·°F)', 'U verified', 'UA (BTU/h·°F)', 'R-value', 'Heat capacity (BTU/SF·°F)', 'SHGC', 'VT', 'WWR', 'Double skin']];
  for (const s of state.massing.walls) {
    const a = state.byId.get(state.assignments.get(s.index));
    rows.push([s.index, s.orientation, s.area.toFixed(1), ...(a ? [a.id, a.name, a.cladding, a.structure, a.depth_in, a.u_factor?.toFixed(4) ?? '', a.u_verified ? 'yes' : 'NO', a.u_factor != null ? (a.u_factor * s.area).toFixed(1) : '', a.r_label, a.heat_capacity ?? '', a.shgc ?? '', a.vt ?? '', a.wwr, a.double_skin ? 'yes' : 'no'] : ['', 'UNASSIGNED'])]);
  }
  rows.push([], ['TOTAL'], ...ROWS.flat().map(([label, key]) => [label, state.totals[key] ?? '']));
  return rows.map(r => r.map(q).join(',')).join('\n');
}
