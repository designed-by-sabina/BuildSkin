// Line-drawing style axonometric viewer: white faces, black edges, orthographic camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const VIEW_DIRS = {
  front: new THREE.Vector3(1, 0.85, 1).normalize(),
  back: new THREE.Vector3(-1, 0.85, -1).normalize(),
};

export const baseMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

const DEFAULT_MAT = baseMaterial();
const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x000000 });

// Adds a .mesh to every surface and returns a group holding them, the edge lines and a north arrow.
// Also sets massing.viewBounds (massing + arrow) for camera fitting.
export function createMassingGroup(massing) {
  const group = new THREE.Group();
  for (const s of massing.surfaces) {
    s.mesh = new THREE.Mesh(s.geometry, DEFAULT_MAT);
    s.mesh.userData.surface = s;
    group.add(s.mesh);
  }
  group.add(new THREE.LineSegments(massing.edges, EDGE_MAT));
  const arrow = northArrow(massing.bounds);
  group.add(arrow);
  massing.viewBounds = massing.bounds.clone().union(new THREE.Box3().setFromObject(arrow));
  return group;
}

// North arrow on the ground plane, beside the massing. Model north = -Z
// (Rhino +Y; the massing is never rotated, so this matches the drawing).
function northArrow(bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  const L = Math.max(8, 0.2 * Math.max(size.x, size.z));
  const x = bounds.max.x + 0.5 * L;
  const z0 = bounds.min.z + L; // tail
  const z1 = bounds.min.z; // tip
  const y = 0.01;
  const g = new THREE.Group();
  g.name = 'north-arrow';

  const head = L * 0.3;
  const shaft = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z0), new THREE.Vector3(x, y, z1 + head)]);
  g.add(new THREE.Line(shaft, EDGE_MAT));
  const tri = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, y, z1),
    new THREE.Vector3(x - head * 0.45, y, z1 + head),
    new THREE.Vector3(x + head * 0.45, y, z1 + head),
  ]);
  g.add(new THREE.Mesh(tri, new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })));

  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: letterTexture('N'), transparent: true }));
  label.scale.setScalar(L * 0.35);
  label.position.set(x, y + L * 0.15, z1 - L * 0.25);
  g.add(label);
  return g;
}

let nTex = null;
function letterTexture(ch) {
  if (nTex) return nTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const draw = () => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#000';
    ctx.font = "96px 'Architects Daughter', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 64, 70);
  };
  draw();
  nTex = new THREE.CanvasTexture(c);
  nTex.colorSpace = THREE.SRGBColorSpace;
  // Redraw once the web font has loaded (the first draw may use the fallback)
  document.fonts?.load("96px 'Architects Daughter'").then(() => {
    draw();
    nTex.needsUpdate = true;
  });
  return nTex;
}

export function fitOrtho(camera, bounds, aspect, dir, target) {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 1;
  camera.userData.half = r * 1.1;
  camera.position.copy(sphere.center).addScaledVector(dir, r * 4);
  camera.near = 0.1;
  camera.far = r * 10;
  camera.zoom = 1;
  camera.lookAt(sphere.center);
  target?.copy(sphere.center);
  setOrthoAspect(camera, aspect);
}

function setOrthoAspect(camera, aspect) {
  const h = camera.userData.half ?? 1;
  const [w, v] = aspect >= 1 ? [h * aspect, h] : [h, h / aspect];
  Object.assign(camera, { left: -w, right: w, top: v, bottom: -v });
  camera.updateProjectionMatrix();
}

export class Viewer {
  constructor(container, { view = 'front' } = {}) {
    this.container = container;
    this.dir = VIEW_DIRS[view];
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.prepend(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.raycaster = new THREE.Raycaster();
    this.scene = null;
    new ResizeObserver(() => this.resize()).observe(container);
  }

  get canvas() {
    return this.renderer.domElement;
  }

  setScene(scene, bounds) {
    this.scene = scene;
    this.bounds = bounds;
    this.reset();
  }

  reset() {
    if (!this.bounds) return;
    fitOrtho(this.camera, this.bounds, this.aspect(), this.dir, this.controls.target);
    this.controls.update();
  }

  aspect() {
    const { clientWidth: w, clientHeight: h } = this.container;
    return w && h ? w / h : 1;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    setOrthoAspect(this.camera, w / h);
  }

  pick(event, objects) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, false)[0]?.object ?? null;
  }

  render() {
    this.controls.update();
    if (this.scene) this.renderer.render(this.scene, this.camera);
  }
}

let thumbRenderer = null;
export function renderThumbnail(massing, size = 480) {
  thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  thumbRenderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(createMassingGroup(massing));
  const camera = new THREE.OrthographicCamera();
  fitOrtho(camera, massing.viewBounds, 1, VIEW_DIRS.front);
  thumbRenderer.render(scene, camera);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  massing.surfaces.forEach(s => s.geometry.dispose());
  massing.edges.dispose();
  return url;
}
