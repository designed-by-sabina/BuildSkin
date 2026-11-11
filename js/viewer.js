// Axonometric line-drawing viewer in the style of an architectural diagram:
// white faces, crisp thin edges, a heavy outer silhouette, orthographic camera.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export const INK = 0x1c1c1c;
const PAPER = 0xffffff;
const EDGE_PX = 1; // interior edges, CSS px
const SILHOUETTE_PX = 2.25; // outer contour, CSS px
const MASK_LAYER = 1; // objects on this layer get the heavy silhouette

export const VIEW_DIRS = {
  front: new THREE.Vector3(1, 0.85, 1).normalize(),
  back: new THREE.Vector3(-1, 0.85, -1).normalize(),
};

export const baseMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: PAPER,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

const DEFAULT_MAT = baseMaterial();
const lineMaterials = new Set();
const edgeMaterial = () => {
  const m = new LineMaterial({ color: INK, linewidth: EDGE_PX });
  lineMaterials.add(m);
  return m;
};
const EDGE_MAT = edgeMaterial();
const INK_MAT = new THREE.MeshBasicMaterial({ color: INK, side: THREE.DoubleSide });

// Adds a .mesh to every surface and returns a group holding them, the edge lines and a north arrow.
// Also sets massing.viewBounds (massing + arrow) for camera fitting.
export function createMassingGroup(massing) {
  const group = new THREE.Group();
  for (const s of massing.surfaces) {
    s.mesh = new THREE.Mesh(s.geometry, DEFAULT_MAT);
    s.mesh.userData.surface = s;
    s.mesh.layers.enable(MASK_LAYER);
    group.add(s.mesh);
  }
  const edges = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(massing.edges), EDGE_MAT);
  group.add(edges);
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
  const shaft = new LineSegmentsGeometry().setPositions([x, y, z0, x, y, z1 + head]);
  g.add(new LineSegments2(shaft, EDGE_MAT));
  const tri = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x, y, z1),
    new THREE.Vector3(x - head * 0.45, y, z1 + head),
    new THREE.Vector3(x + head * 0.45, y, z1 + head),
  ]);
  g.add(new THREE.Mesh(tri, INK_MAT));

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
  const font = "700 92px Roboto, 'Helvetica Neue', Arial, sans-serif";
  const draw = () => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#1c1c1c';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 64, 70);
  };
  draw();
  nTex = new THREE.CanvasTexture(c);
  nTex.colorSpace = THREE.SRGBColorSpace;
  // Redraw once the web font has loaded (the first draw may use the fallback)
  document.fonts?.load(font).then(() => {
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

// ---------- Ink rendering: silhouette pass + scene ----------
// 1. Render the massing (MASK_LAYER) as a solid mask into a render target.
// 2. Paint the screen: ink wherever the mask, dilated by SILHOUETTE_PX, is covered; paper elsewhere.
// 3. Render the scene on top. White faces cover the inside, leaving a heavy outer contour.

const QUAD_CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const inkState = new WeakMap();

function inkFor(renderer) {
  if (inkState.has(renderer)) return inkState.get(renderer);
  const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tMask: { value: rt.texture },
      texel: { value: new THREE.Vector2() },
      radius: { value: 2 },
      ink: { value: new THREE.Color(INK) },
      paper: { value: new THREE.Color(PAPER) },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tMask; uniform vec2 texel; uniform float radius; uniform vec3 ink; uniform vec3 paper;
      varying vec2 vUv;
      void main() {
        float a = texture2D(tMask, vUv).a;
        for (int i = 0; i < 24; i++) {
          float t = float(i) * 0.2617994;
          vec2 d = vec2(cos(t), sin(t)) * texel;
          a = max(a, texture2D(tMask, vUv + d * radius).a);
          a = max(a, texture2D(tMask, vUv + d * radius * 0.55).a);
        }
        gl_FragColor = vec4(mix(paper, ink, a), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const st = { rt, mat, scene };
  inkState.set(renderer, st);
  return st;
}

export function inkRender(renderer, scene, camera, silhouettePx = SILHOUETTE_PX) {
  const st = inkFor(renderer);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  if (st.rt.width !== size.x || st.rt.height !== size.y) st.rt.setSize(size.x, size.y);
  // Line widths are in CSS px against the canvas's CSS size
  for (const m of lineMaterials) m.resolution.set(size.x / pr, size.y / pr);

  const bg = scene.background;
  const autoClear = renderer.autoClear;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  scene.background = null;

  // 1. mask
  renderer.setRenderTarget(st.rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  camera.layers.set(MASK_LAYER);
  scene.overrideMaterial = INK_MAT;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  camera.layers.set(0);
  renderer.setRenderTarget(null);

  // 2. dilated silhouette on paper
  st.mat.uniforms.texel.value.set(1 / size.x, 1 / size.y);
  st.mat.uniforms.radius.value = silhouettePx * pr;
  renderer.setClearColor(PAPER, 1);
  renderer.clear();
  renderer.render(st.scene, QUAD_CAM);

  // 3. the drawing
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, camera);

  renderer.autoClear = autoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  scene.background = bg;
}

export class Viewer {
  constructor(container, { view = 'front', silhouette = SILHOUETTE_PX } = {}) {
    this.container = container;
    this.dir = VIEW_DIRS[view];
    this.silhouette = silhouette;
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
    if (this.scene) inkRender(this.renderer, this.scene, this.camera, this.silhouette);
  }
}

let thumbRenderer = null;
export function renderThumbnail(massing, size = 480) {
  thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  thumbRenderer.setPixelRatio(1);
  thumbRenderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(createMassingGroup(massing));
  const camera = new THREE.OrthographicCamera();
  fitOrtho(camera, massing.viewBounds, 1, VIEW_DIRS.front);
  inkRender(thumbRenderer, scene, camera, 3);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  scene.traverse(o => o.isLineSegments2 && o.geometry.dispose());
  massing.surfaces.forEach(s => s.geometry.dispose());
  massing.edges.dispose();
  return url;
}
