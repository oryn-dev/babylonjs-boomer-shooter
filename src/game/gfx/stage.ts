import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Look } from "../../oryn/look";
import { onSettings, settings } from "../../oryn/settings";
import { type Model, parseModels } from "../level/kit";
import type { LevelBuilder } from "../level/build";
import type { V3 } from "../level/vec";
import { Actor } from "./actor";
import { DynamicLights } from "./lights";
import { v4 } from "./materials";
import { Particles } from "./particles";
import { Retro } from "./retro";
import { loadSurfaces, type Surfaces } from "./textures";
import { World } from "../level/world";

/** Camera, shaders, models and effects shared by every level. */
export class Stage {
  readonly camera: TargetCamera;
  readonly lights = new DynamicLights();
  readonly particles: Particles;
  readonly retro: Retro;
  readonly engine: AbstractEngine;
  surfaces!: Surfaces;
  kit!: Map<string, Model>;
  models!: Map<string, Model>;
  world: World | null = null;
  time = 0;
  fov = 100;
  gunFov = 58;
  eye: V3 = [0, 2, 0];
  readonly forward = new Vector3(0, 0, 1);
  readonly right = new Vector3(1, 0, 0);
  readonly up = new Vector3(0, 1, 0);
  private gunProjection = new Matrix();
  private gunView = new Matrix();
  /** 0 full, 1 fine, 2 chunky. */
  pixelLook = 1;

  constructor(readonly scene: Scene, look: Look, private url: (path: string) => string) {
    this.engine = scene.getEngine();
    this.camera = new TargetCamera("camera", new Vector3(0, 2, 0), scene);
    this.camera.minZ = 0.06;
    this.camera.maxZ = 260;
    scene.activeCamera = this.camera;
    scene.clearColor = new Color4(0.004, 0.003, 0.003, 1);
    scene.getMeshByName("sky")?.setEnabled(false);
    look.setPixel({ bloom: true, msaa: true });
    this.particles = new Particles(scene);
    this.retro = new Retro(this.camera, this.engine);
    onSettings(() => this.sharpness());
    window.addEventListener("resize", () => this.sharpness());
  }

  async load() {
    const get = async (name: string) => {
      const [head, blob] = await Promise.all([fetch(this.url(`${name}.json`)).then((r) => r.json()), fetch(this.url(`${name}.bin`)).then((r) => r.arrayBuffer())]);
      return parseModels(head, blob);
    };
    const [surfaces, kit, models] = await Promise.all([loadSurfaces(this.scene, this.url), get("kit"), get("cast")]);
    this.surfaces = surfaces;
    this.kit = kit;
    this.models = models;
  }

  /** Render size: whole-number pixels of the screen, so the picture stays crisp. */
  sharpness() {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const high = Math.min(window.innerHeight, window.innerWidth * 0.75) * ratio;
    const target = this.pixelLook === 0 ? 1080 : this.pixelLook === 1 ? 560 : 340;
    const cap = settings.quality === "low" ? Math.min(target, 420) : target;
    const step = Math.max(1, this.pixelLook === 0 ? high / cap : Math.round(high / cap));
    this.engine.setHardwareScalingLevel(Math.max(step, this.pixelLook === 0 ? 1 : step) / ratio);
    const canvas = this.engine.getRenderingCanvas();
    if (canvas) canvas.style.imageRendering = this.pixelLook === 0 ? "auto" : "pixelated";
    this.particles.amount = settings.quality === "low" ? 0.5 : settings.quality === "medium" ? 0.75 : 1;
    this.retro.reattach();
  }

  actor(name: string, group = 0, from: "cast" | "kit" = "cast") {
    const model = (from === "cast" ? this.models : this.kit).get(name);
    if (!model) throw new Error(`no model ${name}`);
    return new Actor(this.scene, model, this.surfaces, group);
  }

  async show(id: string, level: LevelBuilder) {
    this.world?.dispose();
    this.particles.clear();
    this.lights.clear();
    this.world = new World(level, this.scene);
    await this.world.load(id, this.kit, this.surfaces, this.url);
  }

  look(eye: V3, yaw: number, pitch: number, roll: number) {
    this.eye = eye;
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.rotation.set(pitch, yaw, roll);
    // The field of view is given for a 16:9 screen; narrower ones keep what is seen across.
    const aspect = this.engine.getAspectRatio(this.camera);
    const half = Math.tan((this.fov * Math.PI) / 360);
    this.camera.fov = 2 * Math.atan(half / Math.max(16 / 9, Math.min(aspect, 2.3)));
    this.camera.computeWorldMatrix();
    this.camera.getDirectionToRef(Vector3.Forward(), this.forward);
    this.camera.getDirectionToRef(Vector3.Right(), this.right);
    this.camera.getDirectionToRef(Vector3.Up(), this.up);
  }

  /** World place of a point on the gun as it shows on screen: the gun has its own field of view. */
  gunPoint(p: V3): V3 {
    const e = this.eye;
    const { right: r, up: u, forward: f } = this;
    const d: V3 = [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
    const k = Math.tan(this.camera.fov / 2) / Math.tan((this.gunFov * Math.PI) / 360);
    const x = (d[0] * r.x + d[1] * r.y + d[2] * r.z) * k;
    const y = (d[0] * u.x + d[1] * u.y + d[2] * u.z) * k;
    const z = d[0] * f.x + d[1] * f.y + d[2] * f.z;
    return [e[0] + r.x * x + u.x * y + f.x * z, e[1] + r.y * x + u.y * y + f.y * z, e[2] + r.z * x + u.z * y + f.z * z];
  }

  /** Everything that follows the frame's state, before drawing. */
  flush(dt: number) {
    this.time += dt;
    const { level } = this.world ?? {};
    const eye = this.eye;
    this.lights.update(dt, eye);
    const p = this.particles;
    p.right = [this.right.x, this.right.y, this.right.z];
    p.up = [this.up.x, this.up.y, this.up.z];
    p.eye = eye;
    const fog = level?.fog ?? { color: [0, 0, 0] as V3, density: 0 };
    const common = (m: ShaderMaterial) => {
      v4(m, "u_eye", eye[0], eye[1], eye[2], this.time);
      v4(m, "u_fog", fog.color[0], fog.color[1], fog.color[2], fog.density);
    };
    const lit = (m: ShaderMaterial) => {
      common(m);
      v4(m, "u_fogHeight", level?.fog.floor ?? -50, level?.fog.height ?? 1, level?.fog.floor === undefined ? 0 : fog.density * 2.2, 0);
      this.lights.apply(m);
    };
    for (const m of p.materials) common(m);
    if (this.world) lit(this.world.material);
    const view = this.camera.getViewMatrix(true);
    const projection = this.scene.activeCamera!.getProjectionMatrix(true);
    const vp = view.multiply(projection);
    const aspect = this.engine.getAspectRatio(this.camera);
    Matrix.PerspectiveFovLHToRef((this.gunFov * Math.PI) / 180, aspect, 0.02, 20, this.gunProjection, true, this.engine.isNDCHalfZRange);
    view.multiplyToRef(this.gunProjection, this.gunView);
    for (const a of Actor.list) {
      if (!a.mesh.isEnabled()) continue;
      lit(a.material);
      a.pose();
      a.apply(a.mesh.renderingGroupId === 1 ? this.gunView : vp);
    }
    p.update(dt);
  }
}
