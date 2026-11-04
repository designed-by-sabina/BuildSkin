// Turns an OBJ massing into facade "surfaces": connected, coplanar groups of triangles.
// Each wall surface is the unit an assembly gets applied to. Everything is converted to feet, Y-up.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const TO_FT = { ft: 1, in: 1 / 12, m: 3.28084, cm: 0.0328084, mm: 0.00328084 };
const UP = new THREE.Vector3(0, 1, 0);

export function buildMassing(text, { units = 'ft', up = 'y' } = {}) {
  const root = new OBJLoader().parse(text);
  root.updateMatrixWorld(true);

  const k = TO_FT[units] ?? 1;
  const conv = new THREE.Matrix4().makeScale(k, k, k);
  if (up === 'z') conv.premultiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

  const pts = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const m = new THREE.Matrix4().multiplyMatrices(conv, o.matrixWorld);
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      pts.push(new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m));
    }
  });
  if (!pts.length) throw new Error('No mesh faces found in OBJ');

  // Sit the model on the ground, centered on the origin
  const box = new THREE.Box3().setFromPoints(pts);
  const c = box.getCenter(new THREE.Vector3());
  const offset = new THREE.Vector3(-c.x, -box.min.y, -c.z);
  pts.forEach(p => p.add(offset));
  box.translate(offset);

  // Group triangles by plane (normal + offset)
  const planes = new Map();
  const e = new THREE.Vector3();
  for (let i = 0; i < pts.length; i += 3) {
    const [a, b, c] = [pts[i], pts[i + 1], pts[i + 2]];
    const n = new THREE.Vector3().subVectors(b, a).cross(e.subVectors(c, a));
    const len = n.length();
    if (len < 1e-6) continue;
    n.divideScalar(len);
    const d = n.dot(a);
    const key = [n.x * 50, n.y * 50, n.z * 50, d * 4].map(Math.round).join(',');
    if (!planes.has(key)) planes.set(key, { normal: n, tris: [] });
    planes.get(key).tris.push({ a, b, c, area: len / 2 });
  }

  // Split each plane into connected pieces (triangles sharing a vertex)
  const vkey = p => `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
  const surfaces = [];
  for (const { normal, tris } of planes.values()) {
    const parent = tris.map((_, i) => i);
    const find = i => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const owner = new Map();
    tris.forEach((t, i) => {
      for (const p of [t.a, t.b, t.c]) {
        const key = vkey(p);
        if (owner.has(key)) parent[find(i)] = find(owner.get(key));
        else owner.set(key, i);
      }
    });
    const pieces = new Map();
    tris.forEach((t, i) => {
      const r = find(i);
      if (!pieces.has(r)) pieces.set(r, []);
      pieces.get(r).push(t);
    });
    for (const piece of pieces.values()) surfaces.push(makeSurface(normal, piece));
  }
  surfaces.forEach((s, i) => (s.index = i));

  const merged = new THREE.BufferGeometry().setFromPoints(pts);
  const edges = new THREE.EdgesGeometry(merged, 15);
  merged.dispose();

  const walls = surfaces.filter(s => s.kind === 'wall');
  return {
    surfaces,
    walls,
    edges,
    bounds: box,
    wallArea: walls.reduce((sum, s) => sum + s.area, 0),
  };
}

function makeSurface(normal, tris) {
  const kind = Math.abs(normal.y) < 0.5 ? 'wall' : normal.y > 0 ? 'roof' : 'floor';
  // Texture axes: walls run horizontally along the wall and vertically in Y; roofs use plan XZ
  const tangent = kind === 'wall' ? new THREE.Vector3().crossVectors(UP, normal).normalize() : null;
  const pos = new Float32Array(tris.length * 9);
  const uv = new Float32Array(tris.length * 6);
  const centroid = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let area = 0;
  tris.forEach((t, i) => {
    [t.a, t.b, t.c].forEach((p, j) => {
      pos.set([p.x, p.y, p.z], (i * 3 + j) * 3);
      uv.set(tangent ? [p.dot(tangent), p.y] : [p.x, -p.z], (i * 3 + j) * 2);
    });
    area += t.area;
    centroid.addScaledVector(tmp.copy(t.a).add(t.b).add(t.c).divideScalar(3), t.area);
  });
  centroid.divideScalar(area);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeBoundingSphere();

  return { kind, normal: normal.clone(), area, centroid, geometry, orientation: kind === 'wall' ? compass(normal) : kind.toUpperCase() };
}

// North = -Z (Rhino +Y maps to OBJ -Z when exporting Y-up)
function compass(n) {
  const deg = ((Math.atan2(n.x, -n.z) * 180) / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
