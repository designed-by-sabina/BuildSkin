// Floors for a massing. One config: { count, typical, first, second, custom: { [floorNo]: heightFt } }.
// Stored per massing as a set: { perVolume, all: config, volumes: { [volumeIndex]: config } }
// - perVolume off: `all` runs from the ground to the top of the massing.
// - perVolume on: each volume gets its own config, from its base to its top.
// Heights are never changed: the top floor of each stack takes whatever height is left over.
import { storageGet } from './common.js';

export const floorsKey = massingId => 'buildskin:floors:' + massingId;
export const MAX_FLOORS = 200;

export function loadFloorSet(massingId) {
  const raw = massingId ? storageGet(floorsKey(massingId)) : null;
  if (!raw) return { perVolume: false, all: null, volumes: {} };
  if ('count' in raw) return { perVolume: false, all: raw, volumes: {} }; // older single-config shape
  return { perVolume: !!raw.perVolume, all: raw.all ?? null, volumes: raw.volumes ?? {} };
}

// The floor stacks in play: [{ volume (index or null for whole massing), base, height, cfg }]
// Missing configs are filled with defaults (and written into the set); counts clamped to fit.
export function floorStacks(set, massing) {
  const vols = massing.volumes ?? [];
  const stacks = set.perVolume && vols.length > 1
    ? vols.map(v => ({ volume: v.index, base: v.base, height: v.height, key: 'volumes', id: v.index }))
    : [{ volume: null, base: 0, height: massing.bounds.max.y, key: 'all' }];
  return stacks.map(st => {
    let cfg = st.key === 'all' ? set.all : set.volumes[st.id];
    if (!cfg) {
      cfg = defaultFloors(st.height);
      if (st.key === 'all') set.all = cfg;
      else set.volumes[st.id] = cfg;
    }
    cfg.count = Math.min(cfg.count, maxCount(cfg, st.height));
    return { volume: st.volume, base: st.base, height: st.height, cfg };
  });
}

// For drawing: [{ walls, elevations (absolute ft), top }] — one group per stack
export function floorLineGroups(set, massing) {
  return floorStacks(set, massing).map(st => ({
    walls: st.volume == null ? massing.walls : massing.walls.filter(w => w.volume === st.volume),
    elevations: floorElevations(st.cfg).map(e => st.base + e),
    top: st.base + st.height,
  }));
}

export function defaultFloors(height) {
  const c = { count: 1, typical: 12, first: 15, second: 12, custom: {} };
  if (height) c.count = maxCount(c, height);
  return c;
}

// Height of floor n as entered (ignores the top-floor remainder)
const setHeight = ({ typical, first, second, custom = {} }, n) =>
  custom[n] ?? (n === 1 ? first : n === 2 ? second : typical);

// Most floors that fit whole under the height; the top floor then only ever gets taller
export function maxCount(cfg, height) {
  let acc = 0;
  let n = 0;
  while (n < MAX_FLOORS) {
    acc += setHeight(cfg, n + 1);
    if (acc > height + 0.01) break;
    n++;
  }
  return Math.max(1, n);
}

// Height (ft) of each floor, bottom to top. With a stack height, the top floor is the remainder.
export function floorHeights(cfg, height) {
  const hs = Array.from({ length: cfg.count }, (_, i) => setHeight(cfg, i + 1));
  if (height) hs[hs.length - 1] = height - hs.slice(0, -1).reduce((a, b) => a + b, 0);
  return hs;
}

// Elevations (ft above the stack's base) of each floor level above its lowest floor
export function floorElevations(cfg) {
  let acc = 0;
  return Array.from({ length: cfg.count - 1 }, (_, i) => (acc += setHeight(cfg, i + 1)));
}
