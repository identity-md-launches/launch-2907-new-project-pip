import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AccessoryId, FoodId, Gesture, Part } from '../game/engine';
import {
  addPose, approach, classify, CLIPS, findLandmarks, idleGapSeconds, mouthOf, pickIdle, ZERO,
  type Landmarks, type Pose,
} from './pose';
import { PointerGestures, type GestureEvent } from './gestures';

export interface SceneCallbacks {
  onTouch(part: Part, gesture: Gesture): void;
  onLoad(ok: boolean, error?: string): void;
}

interface ActiveClip {
  name: string;
  start: number;
  dur: number;
  priority: number;
  hold?: boolean;
}

const HEIGHTS = [1.6, 1.78, 1.96, 2.08, 2.18];

/** Vertex deformation injected into the authored material. Smooth gaussian falloffs only, and
 *  the authored normals are rotated with the head, never recomputed, so shading stays smooth. */
const DEFORM_GLSL = /* glsl */ `
uniform vec3 uMin; uniform vec3 uSize;
uniform vec3 uNose; uniform float uNeck;
uniform vec3 uHead; // yaw pitch roll
uniform float uBreath, uCheek, uJaw, uPawL, uPawR, uEarL, uEarR, uStretch, uPoke;
uniform vec3 uPokeAt;
float gss(vec3 p, vec3 c, float r){ vec3 d=(p-c)/uSize.y; return exp(-dot(d,d)/(r*r)); }
mat3 headRot(float w){
  float y=uHead.x*w, x=uHead.y*w, z=uHead.z*w;
  mat3 ry=mat3(cos(y),0.,-sin(y), 0.,1.,0., sin(y),0.,cos(y));
  mat3 rx=mat3(1.,0.,0., 0.,cos(x),sin(x), 0.,-sin(x),cos(x));
  mat3 rz=mat3(cos(z),sin(z),0., -sin(z),cos(z),0., 0.,0.,1.);
  return ry*rx*rz;
}
vec3 L(vec3 u){ return uMin + u*uSize; }
float headW(vec3 p){ float h=(p.y-uMin.y)/uSize.y; return smoothstep(uNeck-0.09, uNeck+0.07, h); }
vec3 deformP(vec3 p, vec3 n){
  float H=uSize.y;
  vec3 nose=L(uNose);
  vec3 mouth=L(vec3(0.5, uNose.y-0.06, uNose.z-0.04));
  vec3 cl=L(vec3(0.33, uNose.y-0.05, uNose.z-0.14)), cr=L(vec3(0.67, uNose.y-0.05, uNose.z-0.14));
  vec3 pl=L(vec3(0.3, uNeck-0.12, 0.85)), pr=L(vec3(0.7, uNeck-0.12, 0.85));
  vec3 el=L(vec3(0.25, 0.95, 0.5)), er=L(vec3(0.75, 0.95, 0.5));
  vec3 d=vec3(0.);
  vec3 centre=L(vec3(0.5,0.5,0.5));
  d += normalize(p-L(vec3(0.5,uNose.y-0.05,0.45))+1e-5) * (gss(p,cl,0.09)+gss(p,cr,0.09)) * uCheek * 0.035*H;
  d.y -= gss(p,mouth,0.05) * uJaw * 0.018*H;
  d += vec3(0.,0.10,0.05)*H*gss(p,pl,0.085)*uPawL + vec3(0.,0.10,0.05)*H*gss(p,pr,0.085)*uPawR;
  d += vec3(-0.02,-0.03,0.)*H*gss(p,el,0.1)*uEarL*-1. + vec3(0.02,-0.03,0.)*H*gss(p,er,0.1)*uEarR*-1.;
  d -= n * gss(p,uPokeAt,0.08) * uPoke * 0.02*H;
  vec3 q=p+d;
  float w=headW(p);
  vec3 pivot=L(vec3(0.5,uNeck,0.5));
  q = pivot + headRot(w)*(q-pivot);
  float h=(p.y-uMin.y)/uSize.y;
  float bw=smoothstep(0.05,0.3,h)*(1.-smoothstep(0.35,0.75,h));
  q.xz += (q.xz-centre.xz)*bw*uBreath*0.035;
  q.y = uMin.y + (q.y-uMin.y)*(1.+uStretch*0.08);
  return q;
}
`;

export class PetScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  private root = new THREE.Group(); // yaw (turn), hop, spin
  private body = new THREE.Group(); // squash/lean
  private mesh: THREE.Mesh | null = null;
  private landmarks: Landmarks | null = null;
  private uniforms = {
    uMin: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector3(1, 1, 1) },
    uNose: { value: new THREE.Vector3(0.5, 0.7, 1) }, uNeck: { value: 0.55 },
    uHead: { value: new THREE.Vector3() },
    uBreath: { value: 0 }, uCheek: { value: 0 }, uJaw: { value: 0 }, uPawL: { value: 0 }, uPawR: { value: 0 },
    uEarL: { value: 0 }, uEarR: { value: 0 }, uStretch: { value: 0 }, uPoke: { value: 0 },
    uPokeAt: { value: new THREE.Vector3(0, -99, 0) },
  };
  private pose: Pose = { ...ZERO };
  private clip: ActiveClip | null = null;
  private nextIdleAt = 3;
  private clock = new THREE.Clock();
  private t = 0;
  private raf = 0;
  private turnYaw = 0.35;
  private asleep = false;
  private energy = 80;
  private reduced = false;
  private stage = 0;
  private food: THREE.Mesh | null = null;
  private foodLeft = 0;
  private ball: THREE.Mesh | null = null;
  private ballStart = 0;
  private accessory: THREE.Object3D | null = null;
  private accessoryId: AccessoryId | null = null;
  private ring: THREE.Mesh;
  private proximity = 0;
  private shadow: THREE.Mesh;
  private loader: GLTFLoader;
  private loadToken = 0;
  private gestures: PointerGestures;
  private resizeObs: ResizeObserver;
  private hidden = false;
  private insets = { top: 0, bottom: 0 };
  private modelH = 0.8;
  private modelW = 0.6;
  mode: 'pet' | 'turn' = 'pet';
  onClipEnd: ((name: string) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private cb: SceneCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0xb9a48c, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1.5, 3, 2.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe2c4, 0.9);
    rim.position.set(-2, 1.5, -2);
    this.scene.add(rim);
    this.scene.add(this.root);
    this.root.add(this.body);
    // Contact shadow keeps the feet grounded.
    const sc = document.createElement('canvas');
    sc.width = sc.height = 128;
    const g = sc.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(60,40,20,0.45)');
    grad.addColorStop(1, 'rgba(60,40,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.scene.add(this.shadow);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.085, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, depthTest: false }),
    );
    this.ring.renderOrder = 10;
    this.scene.add(this.ring);
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.gestures = new PointerGestures(canvas, {
      hit: (x, y) => this.hitPart(x, y),
      turn: (dx) => {
        this.turnYaw += dx * 0.012;
      },
      gesture: (e: GestureEvent) => this.handleGesture(e),
      mode: () => this.mode,
    });
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private handleGesture(e: GestureEvent) {
    if (e.point instanceof THREE.Vector3) this.pokeAt(e.point);
    this.cb.onTouch(e.part, e.gesture);
  }

  load(stage: number, url: string) {
    const token = ++this.loadToken;
    this.stage = stage;
    this.loader.load(
      url,
      (gltf) => {
        if (token !== this.loadToken) return;
        let found: THREE.Mesh | null = null;
        gltf.scene.traverse((o) => {
          if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
        });
        if (!found) return this.cb.onLoad(false, 'no mesh');
        this.install(gltf.scene, found);
        this.cb.onLoad(true);
      },
      undefined,
      (err) => {
        if (token === this.loadToken) this.cb.onLoad(false, String((err as Error)?.message || err));
      },
    );
  }

  private install(sceneRoot: THREE.Object3D, mesh: THREE.Mesh) {
    this.body.clear();
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const lm = findLandmarks(pos.array, pos.count, (i, c) => (c === 0 ? pos.getX(i) : c === 1 ? pos.getY(i) : pos.getZ(i)));
    this.landmarks = lm;
    this.uniforms.uMin.value.set(...lm.min);
    this.uniforms.uSize.value.set(...lm.size);
    this.uniforms.uNose.value.set(...lm.nose);
    this.uniforms.uNeck.value = lm.neck;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${DEFORM_GLSL}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nobjectNormal = headRot(headW(position)) * objectNormal;`)
        .replace('#include <begin_vertex>', `vec3 transformed = deformP(position, normalize(normal));`);
    };
    mat.customProgramCacheKey = () => 'pip-deform';
    mat.needsUpdate = true;
    // Normalise: feet on y=0, centred, height per stage.
    const wrap = new THREE.Group();
    wrap.add(sceneRoot);
    sceneRoot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(sceneRoot);
    const h = box.max.y - box.min.y;
    const scale = (HEIGHTS[this.stage] ?? 1.8) / 2.18 / h;
    wrap.scale.setScalar(scale);
    wrap.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
    this.body.add(wrap);
    this.mesh = mesh;
    this.shadow.scale.setScalar((box.max.x - box.min.x) * scale * 1.2);
    this.modelH = h * scale;
    this.modelW = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * scale;
    if (this.accessoryId) this.setAccessory(this.accessoryId);
    this.frame();
  }

  /**
   * Fits the current growth mesh into the unobstructed band of the canvas: below the stage-top
   * controls and above the meters/snack tray, whose measured heights Stage passes in (CSS px).
   * The view offset moves the band's centre without cropping, and raycasting/mouth projection use
   * the same projection matrix, so touch targets and the mouth socket stay exact.
   */
  setInsets(top: number, bottom: number) {
    this.insets = { top: Math.max(0, top), bottom: Math.max(0, bottom) };
    this.frame();
  }

  private frame() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const band = Math.max(h * 0.35, h - this.insets.top - this.insets.bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const H = this.modelH * 1.16; // head-room above the ears, contact shadow below the feet
    const dV = (H * h) / (band * 2 * tan);
    const dH = (this.modelW * 1.5) / (2 * tan * (w / h));
    const d = Math.max(dV, dH, 1.2);
    const cy = this.modelH * 0.5;
    this.camera.position.set(0, cy + d * 0.1, d);
    this.camera.lookAt(0, cy, 0);
    // Shift the rendered window so the model centre lands on the band centre.
    const dy = this.insets.top + band / 2 - h / 2;
    this.camera.setViewOffset(w, h, 0, -dy, w, h);
    this.camera.updateProjectionMatrix();
  }

  private resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 34 : 28;
    this.frame();
  }

  /** Where the feet anchor projects, in client px (used by the layout tests). */
  feetScreen(): { x: number; y: number } | null {
    if (!this.mesh || !this.landmarks) return null;
    const v = this.mesh.localToWorld(this.deformed([0.5, 0.04, 0.8])).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  setMode(m: 'pet' | 'turn') {
    this.mode = m;
  }
  setAsleep(a: boolean) {
    this.asleep = a;
    if (a && this.clip && this.clip.priority < 4) this.clip = null;
  }
  setEnergy(e: number) {
    this.energy = e;
  }
  setReducedMotion(r: boolean) {
    this.reduced = r;
  }
  setHidden(h: boolean) {
    this.hidden = h;
  }
  turnBy(rad: number) {
    this.turnYaw += rad;
  }
  busyPriority() {
    return this.clip?.priority ?? 0;
  }
  currentClip() {
    return this.clip?.name ?? null;
  }

  /** Plays a clip if nothing more important is running. Returns whether it started. */
  play(name: string, opts: { force?: boolean } = {}): boolean {
    const def = CLIPS[name];
    if (!def) return false;
    if (this.asleep && def.priority < 4 && !opts.force) return false;
    if (this.clip && this.clip.priority > def.priority && !opts.force) return false;
    const replaced = this.clip?.name ?? null;
    this.clip = { name, start: this.t, dur: def.dur, priority: def.priority };
    // A clip cut short still ends: listeners (e.g. the feeding lock) must hear about it.
    if (replaced && replaced !== name) this.onClipEnd?.(replaced);
    if (name === 'ball') this.spawnBall();
    return true;
  }
  stopClip(name: string) {
    if (this.clip?.name === name) this.clip = { ...this.clip, dur: Math.min(this.clip.dur, this.t - this.clip.start + 0.35) };
  }

  startEating(food: FoodId) {
    this.play('eat', { force: true });
    if (this.food) this.body.remove(this.food);
    const color = food === 'seed' ? 0x8a6a4a : food === 'carrot' ? 0xf28c28 : 0xd8344f;
    const geo = food === 'carrot' ? new THREE.ConeGeometry(0.035, 0.13, 16) : new THREE.SphereGeometry(food === 'seed' ? 0.035 : 0.04, 20, 14);
    if (food === 'seed') geo.scale(0.7, 1.3, 0.6);
    this.food = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    if (food === 'carrot') this.food.rotation.z = Math.PI / 2;
    this.foodLeft = 1;
    this.scene.add(this.food);
  }

  private spawnBall() {
    if (!this.ball) {
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), new THREE.MeshStandardMaterial({ color: 0x5aa9e6, roughness: 0.4 }));
      this.scene.add(this.ball);
    }
    this.ball.visible = true;
    this.ballStart = this.t;
  }

  setAccessory(id: AccessoryId | null) {
    this.accessoryId = id;
    if (this.accessory) this.scene.remove(this.accessory);
    this.accessory = null;
    if (!id) return;
    const g = new THREE.Group();
    const m = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 });
    if (id === 'bow') {
      const a = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 16), m(0xe85d8a));
      a.rotation.z = Math.PI / 2;
      a.position.x = -0.05;
      const b = a.clone();
      b.rotation.z = -Math.PI / 2;
      b.position.x = 0.05;
      g.add(a, b, new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), m(0xd94677)));
    } else if (id === 'scarf') {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.04, 12, 36), m(0x3f8f6b));
      t.rotation.x = Math.PI / 2;
      g.add(t);
    } else if (id === 'leaf') {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), m(0x6fae3b));
      leaf.scale.set(1, 0.25, 0.6);
      leaf.rotation.z = 0.4;
      g.add(leaf);
    } else {
      const shape = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.025 : 0.06;
        const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }), m(0xf2c230)));
    }
    this.accessory = g;
    this.scene.add(g);
  }

  /** Ray-casts against the authored mesh. Returns null for background (no reward). */
  hitPart(clientX: number, clientY: number): { part: Part; point: THREE.Vector3 } | null {
    if (!this.mesh || !this.landmarks) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    const local = this.mesh.worldToLocal(hit.point.clone());
    const lm = this.landmarks;
    const u: [number, number, number] = [
      (local.x - lm.min[0]) / lm.size[0], (local.y - lm.min[1]) / lm.size[1], (local.z - lm.min[2]) / lm.size[2],
    ];
    return { part: classify(u, lm), point: local };
  }

  /** Simulated touch for keyboard users: same reaction path as a pointer touch. */
  touchPartByKey(part: Part, gesture: Gesture) {
    if (this.landmarks) {
      const lm = this.landmarks;
      const u: Record<Part, [number, number, number]> = {
        head: [0.5, 0.92, 0.6], cheek: [0.33, lm.nose[1] - 0.05, lm.nose[2] - 0.12], nose: lm.nose,
        belly: [0.5, 0.3, 0.95], paw: [0.7, lm.neck - 0.12, 0.85], feet: [0.5, 0.04, 0.8], back: [0.5, 0.4, 0.05],
      };
      const p = u[part];
      this.pokeAt(new THREE.Vector3(lm.min[0] + p[0] * lm.size[0], lm.min[1] + p[1] * lm.size[1], lm.min[2] + p[2] * lm.size[2]));
    }
    this.cb.onTouch(part, gesture);
  }

  private pokeAt(localPoint: THREE.Vector3) {
    this.uniforms.uPokeAt.value.copy(localPoint);
    this.uniforms.uPoke.value = 1;
  }

  /** Mesh-local point after the same deformation the shader applies (CPU mirror for sockets). */
  private deformed(u: [number, number, number]): THREE.Vector3 {
    const lm = this.landmarks!;
    const p = new THREE.Vector3(lm.min[0] + u[0] * lm.size[0], lm.min[1] + u[1] * lm.size[1], lm.min[2] + u[2] * lm.size[2]);
    const h = u[1];
    const w = THREE.MathUtils.smoothstep(h, lm.neck - 0.09, lm.neck + 0.07);
    const pivot = new THREE.Vector3(lm.min[0] + 0.5 * lm.size[0], lm.min[1] + lm.neck * lm.size[1], lm.min[2] + 0.5 * lm.size[2]);
    const head = this.uniforms.uHead.value;
    const m = new THREE.Matrix4().makeRotationY(head.x * w).multiply(new THREE.Matrix4().makeRotationX(head.y * w)).multiply(new THREE.Matrix4().makeRotationZ(head.z * w));
    p.sub(pivot).applyMatrix4(m).add(pivot);
    p.y = lm.min[1] + (p.y - lm.min[1]) * (1 + this.uniforms.uStretch.value * 0.08);
    return p;
  }

  /** Live mouth socket in client (CSS pixel) coordinates. */
  mouthScreen(): { x: number; y: number } | null {
    const w = this.mouthWorld();
    if (!w) return null;
    const v = w.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }
  private mouthWorld(): THREE.Vector3 | null {
    if (!this.mesh || !this.landmarks) return null;
    return this.mesh.localToWorld(this.deformed(mouthOf(this.landmarks)));
  }
  setProximity(p: number) {
    this.proximity = p;
  }

  private loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (this.hidden) {
      this.clock.getDelta();
      return;
    }
    const dt = Math.min(0.05, this.clock.getDelta());
    this.t += dt;
    const t = this.t;
    // Target pose: breathing + sleep posture + active clip.
    let target: Pose = { ...ZERO };
    const breathRate = this.asleep ? 1.3 : 1.9 + (this.energy / 100) * 0.8;
    target.breath = Math.sin(t * breathRate) * (this.asleep ? 1.2 : 0.8);
    target.yaw = Math.sin(t * 0.37) * 0.05;
    target.earL = Math.sin(t * 0.8) * 0.08;
    target.earR = Math.sin(t * 0.8 + 1) * 0.08;
    if (this.asleep) {
      target = addPose(target, { pitch: 0.45, stretch: -0.3, earL: -0.8, earR: -0.8, pawL: 0.4, pawR: 0.4, squash: 0.04 });
    }
    if (this.clip) {
      const ct = t - this.clip.start;
      if (ct >= this.clip.dur) {
        const ended = this.clip.name;
        this.clip = null;
        this.nextIdleAt = t + idleGapSeconds(this.energy, Math.random());
        this.onClipEnd?.(ended);
      } else {
        const w = this.reduced ? 0.35 : 1;
        const part = CLIPS[this.clip.name].fn(ct, this.clip.dur);
        const scaled: Partial<Pose> = { ...part };
        if (this.reduced) {
          scaled.hop = (part.hop ?? 0) * 0.2;
          scaled.spin = 0;
        }
        target = addPose(target, scaled, w);
        if (this.reduced) target.spin = 0;
      }
    } else if (!this.asleep && !this.reduced && t >= this.nextIdleAt) {
      this.play(pickIdle(this.energy, Math.random()));
    }
    this.pose = approach(this.pose, target, dt, this.reduced ? 5 : 9);
    const p = this.pose;
    const u = this.uniforms;
    u.uHead.value.set(p.yaw, p.pitch, p.roll);
    u.uBreath.value = p.breath;
    u.uCheek.value = Math.max(0, p.cheek);
    u.uJaw.value = Math.max(0, p.jaw);
    u.uPawL.value = p.pawL;
    u.uPawR.value = p.pawR;
    u.uEarL.value = p.earL;
    u.uEarR.value = p.earR;
    u.uStretch.value = p.stretch;
    u.uPoke.value *= Math.exp(-dt * 6);
    this.root.rotation.y = this.turnYaw + p.spin;
    this.root.position.y = Math.max(0, p.hop);
    this.body.rotation.x = p.lean;
    this.body.scale.set(1 + p.squash * 0.5, 1 - p.squash, 1 + p.squash * 0.5);
    this.shadow.scale.setScalar(this.shadow.scale.x); // keep
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 1 - Math.min(0.6, p.hop * 2);
    this.scene.updateMatrixWorld(true);
    // Food at the animated mouth, shrinking as Pip nibbles.
    const mouth = this.mouthWorld();
    if (this.food && mouth) {
      if (this.clip?.name === 'eat') {
        const ct = t - this.clip.start;
        this.foodLeft = Math.max(0, 1 - ct / (this.clip.dur * 0.85));
      } else this.foodLeft = 0;
      const fwd = new THREE.Vector3(0, -0.02, 0.06).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y);
      this.food.position.copy(mouth).add(fwd);
      this.food.scale.setScalar(Math.max(0.001, this.foodLeft));
      if (this.foodLeft <= 0) {
        this.scene.remove(this.food);
        this.food = null;
      }
    }
    if (mouth) {
      this.ring.position.copy(mouth).add(new THREE.Vector3(0, 0, 0.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y));
      this.ring.quaternion.copy(this.camera.quaternion);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = this.proximity * 0.9;
      this.ring.scale.setScalar(1 + this.proximity * 0.5 + Math.sin(t * 8) * 0.05 * this.proximity);
    }
    if (this.ball?.visible) {
      const bt = t - this.ballStart;
      this.ball.position.set(0.55 - Math.min(1, bt / 1.2) * 0.35, 0.09 + Math.abs(Math.sin(bt * 5)) * 0.25 * Math.max(0, 1 - bt / 2.6), 0.45);
      if (bt > 2.8) this.ball.visible = false;
    }
    if (this.accessory && this.mesh && this.landmarks) {
      const lm = this.landmarks;
      const anchors: Record<AccessoryId, [number, number, number]> = {
        bow: [0.5, 0.97, 0.55], scarf: [0.5, lm.neck - 0.03, 0.5], leaf: [0.5, 0.99, 0.5], star: [0.5, lm.neck - 0.14, 0.97],
      };
      const a = this.deformed(anchors[this.accessoryId!]);
      this.accessory.position.copy(this.mesh.localToWorld(a));
      const s = (HEIGHTS[this.stage] ?? 1.8) / 2;
      this.accessory.scale.setScalar(this.accessoryId === 'scarf' ? s * (lm.size[0] / lm.size[1]) * 1.25 : s);
      this.accessory.rotation.set(this.accessoryId === 'star' ? 0 : p.pitch * 0.8 + this.body.rotation.x, this.root.rotation.y + p.yaw * 0.8, p.roll * 0.8);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.gestures.dispose();
    this.renderer.dispose();
  }
}
