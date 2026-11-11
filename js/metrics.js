// Facade metrics, grouped like the characteristics tables (one calculator tab per section):
// descriptive · thermal & solar · environmental impact (incl. cool walls + bird collision) · economic.
// Each row: [criteria, key, unit / target]. Values come from summarize().
import { fmtInt } from './common.js';

export const SECTIONS = [
  {
    id: 'descriptive',
    title: 'Descriptive',
    groups: [
      { cat: 'Materials', rows: [
        ['Facade material', 'cladding', 'Material type'],
        ['Building façade structure material', 'structure', 'Material type'],
      ] },
      { cat: 'Geometry', rows: [
        ['Façade area', 'area', 'SF'],
        ['Assembly depth', 'depth', 'in'],
      ] },
      { cat: 'Façade configuration', rows: [
        ['Fenestration ratio', 'wwr', '%'],
        ['Double-skin façade coverage', 'dsf', '% / N/A'],
      ] },
      { cat: 'Preservation', rows: [
        ['% of existing facade preserved', 'preserved', '%'],
      ] },
    ],
  },
  {
    id: 'thermal',
    title: 'Thermal & solar',
    groups: [
      { cat: 'Thermal performance', rows: [
        ['Weighted-average U-factor', 'u', 'BTU/(h·ft²·°F)'],
        ['Insulation R-value', 'r', 'h·ft²·°F/BTU'],
      ] },
      { cat: 'Solar & daylight performance', rows: [
        ['Solar Heat Gain Coefficient (SHGC)', 'shgc', '0–1'],
        ['Visible Transmittance (VT)', 'vt', '0–1'],
      ] },
    ],
  },
  {
    id: 'environmental',
    title: 'Environmental impact',
    groups: [
      { cat: 'Environmental impact', rows: [
        ['Embodied-carbon Global Warming Potential (GWP)', 'gwp', 'kg CO₂e'],
      ] },
      { cat: 'Heat island mitigation – cool walls', rows: [
        ['Initial solar reflectance', 'reflectance', '≥ 0.60'],
        ['Initial thermal emittance', 'emittance', '≥ 0.75'],
        ['Sunlight opacity', 'opacity', 'Opaque / Non-opaque'],
        ['Vegetated wall coverage', 'vegetated', 'SF / % of façade area'],
        ['Qualifying cool-wall coverage', 'coolWall', '≥ 60% of gross exterior wall area, incl. windows'],
        ['Pole-facing cool-wall allocation', 'poleFacing', '≤ 25% of qualifying cool-wall area'],
      ] },
      { cat: 'Bird collision deterrence', rows: [
        ['Material Threat Factor (TF)', 'tf', 'Numerical rating of bird collision risk'],
        ['Façade Zone 1 area', 'zone1', 'SF · first 36 ft above grade (and 12 ft above green roofs)'],
        ['Façade Zone 2 area', 'zone2', 'SF · remaining façade area'],
        ['Bird Collision Threat Rating (BCTR)', 'bctr', '≤ 15'],
        ['Hazardous glazing coverage in Zone 1', 'hazard', '≤ 15% of Zone 1 area with TF > 75'],
        ['Glazed corner / fly-through Threat Factor', 'flyThrough', '≤ 25'],
      ] },
    ],
  },
  {
    id: 'economic',
    title: 'Economic',
    groups: [
      { cat: 'Cost', rows: [
        ['Materials & production cost', 'costMaterial', 'High to Low'],
        ['Labor cost', 'costLabor', 'High to Low'],
      ] },
    ],
  },
];

export const ALL_ROWS = SECTIONS.flatMap(s => s.groups.flatMap(g => g.rows.map(([label, key, unit]) => ({ section: s.id, cat: g.cat, label, key, unit }))));

export const NO_DATA = 'No data';
export const ZONE1_FT = 36;
const POLE = new Set(['N', 'NE', 'NW']); // northern hemisphere: pole-facing = north-facing

// ---------- Per-assembly inputs (null = not in the data yet) ----------
const cladLayer = a => a.layers?.find(l => l.is_cladding) ?? a.layers?.[0];
export const reflectanceOf = a => a.optical?.solar_reflectance ?? null; // not Revit "reflectivity": unsourced
export const emittanceOf = a => cladLayer(a)?.emissivity ?? null; // exterior layer emissivity
export const opaqueOf = a => (a.optical?.opaque == null ? null : a.optical.opaque ? 'Opaque' : 'Non-opaque');
export const tfOf = a => a.bird?.threat_factor ?? null;
export const gwpOf = a => a.embodied_carbon?.gwp_a1a3_kgco2e_per_sf ?? null;
export const costMaterialOf = a => a.cost?.material_per_sf ?? null;
export const costLaborOf = a => a.cost?.labor_per_sf ?? null;
const qualifiesCool = a => reflectanceOf(a) >= 0.6 && emittanceOf(a) >= 0.75;

// Wall area below height h (ft above grade = model y). Clips each triangle at y = h.
export function areaBelow(surface, h) {
  surface._below ??= {};
  if (surface._below[h] != null) return surface._below[h];
  const p = surface.geometry.attributes.position.array;
  let area = 0;
  for (let i = 0; i < p.length; i += 9) {
    const tri = [0, 3, 6].map(o => [p[i + o], p[i + o + 1], p[i + o + 2]]);
    const poly = [];
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      const ina = a[1] <= h, inb = b[1] <= h;
      if (ina) poly.push(a);
      if (ina !== inb) {
        const t = (h - a[1]) / (b[1] - a[1]);
        poly.push([a[0] + t * (b[0] - a[0]), h, a[2] + t * (b[2] - a[2])]);
      }
    }
    for (let j = 1; j + 1 < poly.length; j++) {
      const [o, u, v] = [poly[0], poly[j], poly[j + 1]];
      const e1 = [u[0] - o[0], u[1] - o[1], u[2] - o[2]];
      const e2 = [v[0] - o[0], v[1] - o[1], v[2] - o[2]];
      area += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
    }
  }
  return (surface._below[h] = area);
}

const pct = (v, of) => (of ? Math.round((v / of) * 100) + '%' : '—');
const money = v => '$' + fmtInt(v);

// Area-weighted summary of {a: assembly, area, surface?} entries.
// opts.fallback: an assembly to describe on its own when nothing is applied (per-SF values).
// opts.walls: every wall surface counted as façade (totals); defaults to the entries' surfaces.
// opts.facadeArea / opts.existingArea: totals only.
export function summarize(entries, { fallback = null, facadeArea = null, walls = null, existingArea = null } = {}) {
  const assigned = entries.reduce((s, e) => s + e.area, 0);
  const perSF = !assigned && !!fallback;
  const list = assigned ? entries : fallback ? [{ a: fallback, area: 1 }] : [];
  const W = list.reduce((s, e) => s + e.area, 0);
  const area = facadeArea ?? assigned;
  const out = {};
  if (area) out.area = fmtInt(area) + ' SF';
  if (existingArea != null && facadeArea) out.preserved = `${pct(existingArea, facadeArea)} · ${fmtInt(existingArea)} SF`;

  // geometry-only rows: bird zones
  const surfs = walls ?? entries.map(e => e.surface).filter(Boolean);
  if (surfs.length) {
    const z1 = surfs.reduce((t, s) => t + areaBelow(s, ZONE1_FT), 0);
    const all = surfs.reduce((t, s) => t + s.area, 0);
    out.zone1 = fmtInt(z1) + ' SF';
    out.zone2 = fmtInt(all - z1) + ' SF';
  }
  if (!W) return out;

  const same = f => {
    const v = [...new Set(list.map(e => f(e.a)))];
    return v.length === 1 ? v[0] : 'Varies';
  };
  const has = f => list.every(e => f(e.a) != null);
  const wavg = f => list.reduce((s, e) => s + f(e.a) * e.area, 0) / W;
  const sum = f => list.reduce((s, e) => s + f(e.a) * e.area, 0);
  const glazed = list.filter(e => e.a.shgc != null && e.a.wwr > 0);
  const GA = glazed.reduce((s, e) => s + e.area * e.a.wwr, 0);
  const gavg = k => (GA ? (glazed.reduce((s, e) => s + e.a[k] * e.area * e.a.wwr, 0) / GA).toFixed(2) : 'N/A');
  const dsf = list.filter(e => e.a.double_skin).reduce((s, e) => s + e.area, 0);
  const depth = same(a => a.depth_in);
  const unverified = list.some(e => !e.a.u_verified);
  const veg = list.filter(e => e.a.vegetated).reduce((s, e) => s + e.area, 0);
  const total = facadeArea ?? W;

  Object.assign(out, {
    cladding: same(a => a.cladding),
    structure: same(a => a.structure),
    depth: depth === 'Varies' ? depth : `${depth} in`,
    wwr: Math.round(wavg(a => a.wwr) * 100) + '%',
    dsf: dsf ? Math.round((dsf / W) * 100) + '%' : 'N/A',

    u: has(a => a.u_factor) ? wavg(a => a.u_factor).toFixed(4) + (unverified ? ' ⚠' : '') : NO_DATA,
    r: same(a => a.r_label),
    shgc: gavg('shgc'),
    vt: gavg('vt'),

    gwp: !has(gwpOf) ? NO_DATA : perSF ? `${gwpOf(fallback)} kg CO₂e/SF` : fmtInt(sum(gwpOf)) + ' kg CO₂e',
    reflectance: has(reflectanceOf) ? wavg(reflectanceOf).toFixed(2) : NO_DATA,
    emittance: has(emittanceOf) ? wavg(emittanceOf).toFixed(2) : NO_DATA,
    opacity: has(opaqueOf) ? same(opaqueOf) : NO_DATA,
    vegetated: perSF ? (fallback.vegetated ? 'Vegetated' : 'None') : `${fmtInt(veg)} SF · ${pct(veg, total)}`,
    tf: has(tfOf) ? (perSF ? String(tfOf(fallback)) : wavg(tfOf).toFixed(1)) : NO_DATA,
    flyThrough: 'Not modeled',
    costMaterial: !has(costMaterialOf) ? NO_DATA : perSF ? `$${costMaterialOf(fallback).toFixed(2)}/SF` : money(sum(costMaterialOf)),
    costLabor: !has(costLaborOf) ? NO_DATA : perSF ? `$${costLaborOf(fallback).toFixed(2)}/SF` : money(sum(costLaborOf)),
  });

  // cool walls: needs reflectance + emittance for every applied assembly
  if (!has(reflectanceOf) || !has(emittanceOf)) out.coolWall = out.poleFacing = NO_DATA;
  else if (perSF) {
    out.coolWall = qualifiesCool(fallback) ? 'Qualifies' : 'Does not qualify';
  } else {
    const q = list.filter(e => qualifiesCool(e.a));
    const qa = q.reduce((s, e) => s + e.area, 0);
    out.coolWall = pct(qa, total);
    const pole = q.filter(e => POLE.has(e.surface?.orientation)).reduce((s, e) => s + e.area, 0);
    out.poleFacing = qa ? pct(pole, qa) : '—';
  }

  // bird collision: needs a TF for every applied assembly
  if (!has(tfOf)) out.bctr = out.hazard = NO_DATA;
  else if (perSF) out.bctr = out.hazard = '—';
  else {
    out.bctr = wavg(tfOf).toFixed(1); // area-weighted TF over the applied façade
    const z1 = list.reduce((t, e) => t + (e.surface ? areaBelow(e.surface, ZONE1_FT) : 0), 0);
    const bad = list.filter(e => tfOf(e.a) > 75).reduce((t, e) => t + (e.surface ? areaBelow(e.surface, ZONE1_FT) : 0), 0);
    out.hazard = z1 ? pct(bad, z1) : '—';
  }
  return out;
}
