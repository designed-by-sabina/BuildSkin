// Loads data/assemblies.json and adds the flat fields the calculator works with.
// The JSON keeps full per-layer data; this only derives totals from it.

export async function loadAssemblies() {
  const data = await (await fetch('data/assemblies.json')).json();
  return { categories: data.categories, assemblies: data.assemblies.map(normalize) };
}

function normalize(a) {
  const layers = a.layers ?? [];
  const eff = a.effective ?? {};
  const rep = a.reported ?? {};
  // Prefer a sourced effective U; fall back to the tool-reported one and mark it unverified
  const u = eff.u_value ?? (rep.r_value ? 1 / rep.r_value : null);
  const uVerified = eff.u_value != null || rep.verified === true;
  const r = eff.r_value ?? rep.r_value ?? null;
  return {
    ...a,
    cladding: layers.find(l => l.is_cladding)?.name ?? layers[0]?.name ?? '—',
    structure: layers.find(l => l.structural)?.name ?? '—',
    depth_in: a.total_thickness_in ?? layers.reduce((s, l) => s + (l.thickness_in ?? 0), 0),
    u_factor: u,
    u_verified: uVerified,
    r_label: r == null ? 'N/A' : `R-${r.toFixed(1)}${uVerified ? '' : ' ⚠'}`,
    heat_capacity: rep.heat_capacity ?? null,
    wwr: a.optical?.wwr ?? 0,
    shgc: a.optical?.shgc ?? null,
    vt: a.optical?.vt ?? null,
    double_skin: !!a.double_skin,
  };
}

// Per-layer R where k is known (conduction only, same basis as Revit)
export const layerR = l => (l.k && l.thickness_in ? l.thickness_in / 12 / l.k : null);
