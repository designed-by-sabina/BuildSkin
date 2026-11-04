// RESULTS / LAYERS / TARGETS tabs over the big data table on the calculator page.
import { storageGet, storageSet, fmtInt } from './common.js';
import { layerR } from './assemblies.js';

const $ = id => document.getElementById(id);
const TARGET_KEY = 'buildskin:targets';
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const todo = text => `<span class="todo">TODO${text ? ': ' + esc(text) : ''}</span>`;

let targets = null;
let tab = 'results';
const input = { cz: '', baseU: '', ...storageGet(TARGET_KEY, {}) };

export async function initPanels(state) {
  try {
    targets = await (await fetch('data/targets.json')).json();
  } catch {
    targets = null;
  }
  document.querySelectorAll('#panelTabs button').forEach(b => {
    b.onclick = () => {
      tab = b.dataset.tab;
      renderPanels(state);
    };
  });
  $('targetsPanel').addEventListener('change', e => {
    if (!e.target.dataset.in) return;
    input[e.target.dataset.in] = e.target.value;
    storageSet(TARGET_KEY, input);
    renderPanels(state);
  });
}

export function renderPanels(state) {
  document.querySelectorAll('#panelTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('bigTable').hidden = tab !== 'results';
  $('layersPanel').hidden = tab !== 'layers';
  $('targetsPanel').hidden = tab !== 'targets';
  if (tab === 'layers') renderLayers(state);
  if (tab === 'targets') renderTargets(state);
}

// ---------- Layers ----------

function shownAssembly(state) {
  if (state.selected) return state.selected;
  const p = state.picked;
  return (p && state.byId.get(state.assignments.get(p.index))) ?? null;
}

function renderLayers(state) {
  const a = shownAssembly(state);
  const el = $('layersPanel');
  if (!a) {
    el.innerHTML = '<p class="muted-note">Select an assembly in the library (or click a painted wall) to see its layers.</p>';
    return;
  }
  const num = (v, d) => (v == null ? todo() : (+v).toFixed(d));
  const rows = a.layers
    .map(l => {
      const r = layerR(l);
      return `<tr>
        <td>${esc(l.name)}${l.function ? `<small>${esc(l.function)}</small>` : ''}</td>
        <td>${num(l.thickness_in, 3)}</td>
        <td>${num(l.k, 4)}</td>
        <td>${num(l.cp, 4)}</td>
        <td>${num(l.density, 2)}</td>
        <td>${num(l.emissivity, 2)}</td>
        <td>${l.thickness_in === 0 ? '0' : r == null ? todo() : r.toFixed(2)}</td>
      </tr>`;
    })
    .join('');
  const rep = a.reported ?? {};
  const flags = (rep.flags ?? []).map(f => `<li>${esc(f)}</li>`).join('');
  el.innerHTML = `
    <div class="panel-title">${esc(a.name)} <span class="muted-note">exterior → interior · ${a.depth_in} in</span></div>
    <table class="layers">
      <thead><tr><th>Layer</th><th>in</th><th>k</th><th>cp</th><th>lb/ft³</th><th>ε</th><th>R</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="panel-sub">Reported (${esc(a.source?.tool ?? 'source')}): R ${rep.r_value ?? '—'} · thermal mass ${rep.heat_capacity ?? '—'} BTU/SF·°F · U ${rep.u_si_w_m2k?.toFixed(3) ?? '—'} W/m²K</div>
    ${a.u_verified ? '' : `<div class="warn">⚠ Unverified U/R: not valid for compliance.</div><ul class="flags">${flags}</ul>`}
    <div class="panel-sub">Effective U: ${a.effective?.u_value ?? todo('source from ASHRAE 90.1 App. A / thermalenvelope.ca')}</div>
    <div class="panel-sub">Cost: ${todo('hook only')} · Embodied carbon: ${todo('hook only')}</div>`;
}

// ---------- Targets ----------

function wallUA(state) {
  if (!state.massing) return null;
  let ua = 0, area = 0, unverified = false, missing = false;
  for (const s of state.massing.walls) {
    const a = state.byId.get(state.assignments.get(s.index));
    if (!a) continue;
    if (a.u_factor == null) missing = true;
    else ua += a.u_factor * s.area;
    area += s.area;
    if (!a.u_verified) unverified = true;
  }
  return { ua, area, unverified, missing };
}

function renderTargets(state) {
  const el = $('targetsPanel');
  if (!targets) {
    el.innerHTML = '<p class="muted-note">Could not load data/targets.json.</p>';
    return;
  }
  const L = targets.leed;
  const cz = input.cz ? +input.cz : null;
  const group = cz ? L.groups.find(g => g.climate_zones.includes(cz)) : null;
  const tableU = cz ? L.baseline_wall_u.by_climate_zone[cz] : null;
  const baseU = tableU ?? (input.baseU !== '' ? +input.baseU : null);
  const w = wallUA(state);

  let uaLine;
  if (!w || !w.area) uaLine = '<span class="muted-note">Paint walls to compute UA.</span>';
  else if (w.missing) uaLine = todo('some applied assemblies have no U');
  else if (!baseU) uaLine = `Design wall UA ${w.ua.toFixed(1)} BTU/h·°F over ${fmtInt(w.area)} SF · baseline ${todo('enter baseline wall U')}`;
  else {
    const base = baseU * w.area;
    const red = (1 - w.ua / base) * 100;
    uaLine = `Design UA ${w.ua.toFixed(1)} vs baseline ${base.toFixed(1)} BTU/h·°F → <b>${red.toFixed(1)}% reduction</b>`;
  }
  const red = w?.area && baseU && !w.missing ? (1 - w.ua / (baseU * w.area)) * 100 : null;

  const optRow = o => {
    let status;
    if (!o.computable) status = `<span class="muted-note">not computable: ${esc(o.why ?? '')}</span>`;
    else if (red == null) status = '<span class="muted-note">—</span>';
    else status = red >= o.threshold_pct ? `<b>MEETS</b>${w.unverified ? ' ⚠' : ''}` : `does not meet${w.unverified ? ' ⚠' : ''}`;
    const thr = o.threshold_pct != null ? `≥ ${o.threshold_pct}%` : todo();
    return `<tr><td>${esc(o.label)}</td><td>${thr}</td><td>${status}</td></tr>`;
  };

  const W = targets.well;
  const wellRows = W.criteria
    .map(c => `<tr><td>${esc(c.label)}<small>${esc(c.feature)}</small></td><td>${c.threshold ? esc(c.threshold) : todo()}</td><td><span class="muted-note">${c.computable ? '' : 'not computable: ' + esc(c.why)}</span></td></tr>`)
    .join('');

  el.innerHTML = `
    <div class="panel-title">${esc(L.label)}</div>
    <div class="todo-line">${esc(L.status)}</div>
    <div class="target-inputs">
      <label>CLIMATE ZONE <select data-in="cz"><option value="">—</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(z => `<option ${z === cz ? 'selected' : ''}>${z}</option>`).join('')}</select></label>
      <label>BASELINE WALL U <input data-in="baseU" type="number" step="0.001" min="0" placeholder="${tableU ?? 'TODO'}" value="${esc(tableU ?? input.baseU)}" ${tableU != null ? 'disabled' : ''}></label>
      <span class="muted-note">${esc(L.baseline_standard)} · walls only</span>
    </div>
    <div class="panel-sub">${uaLine}</div>
    ${w?.unverified ? '<div class="warn">⚠ Uses unverified assembly U (Revit R-54). Result is not valid for compliance.</div>' : ''}
    ${group ? `<table class="targets"><thead><tr><th>Option · ${esc(group.rule)}</th><th>Target</th><th>Status</th></tr></thead><tbody>${group.options.map(optRow).join('')}</tbody></table>` : '<p class="muted-note">Pick a climate zone to see the options.</p>'}
    <div class="panel-title">${esc(W.label)}</div>
    <div class="todo-line">${esc(W.status)}</div>
    <table class="targets"><thead><tr><th>Criterion</th><th>Threshold</th><th>Status</th></tr></thead><tbody>${wellRows}</tbody></table>`;
}
