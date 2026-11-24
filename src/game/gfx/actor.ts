import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Model } from "../level/kit";
import type { LightGrid } from "../level/world";
import type { V3 } from "../level/vec";
import { actorMaterial, BONES, v4 } from "./materials";
import type { Surfaces } from "./textures";

export interface Pose {
  rx: number; ry: number; rz: number;
  x: number; y: number; z: number;
  s: number;
}
const geometry = new WeakMap<Scene, Map<string, Mesh>>();

function source(scene: Scene, model: Model) {
  let store = geometry.get(scene);
  if (!store) geometry.set(scene, (store = new Map()));
  let mesh = store.get(model.name);
  if (mesh) return mesh;
  mesh = new Mesh(`model ${model.name}`, scene);
  const tint = new Float32Array(model.count * 4);
  for (let i = 0; i < model.count; i++) tint.set([model.color[i * 3], model.color[i * 3 + 1], model.color[i * 3 + 2], model.glow[i]], i * 4);
  mesh.setVerticesData(VertexBuffer.PositionKind, model.pos, false, 3);
  mesh.setVerticesData(VertexBuffer.NormalKind, model.nor, false, 3);
  mesh.setVerticesData("tangent3", model.tan, false, 3);
  mesh.setVerticesData(VertexBuffer.UVKind, model.uv, false, 2);
  mesh.setVerticesData("layer", model.layer, false, 1);
  mesh.setVerticesData("part", model.part, false, 1);
  mesh.setVerticesData("tint", tint, false, 4);
  const index = new Uint32Array(model.index.length);
  for (let i = 0; i < index.length; i += 3) ((index[i] = model.index[i]), (index[i + 1] = model.index[i + 2]), (index[i + 2] = model.index[i + 1]));
  mesh.setIndices(index);
  mesh.setEnabled(false);
  store.set(model.name, mesh);
  return mesh;
}

/** A model whose rigid parts are posed on the processor and drawn in one call. */
export class Actor {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly poses: Pose[];
  readonly bones = new Float32Array(BONES * 16);
  pos: V3 = [0, 0, 0];
  yaw = 0;
  pitch = 0;
  roll = 0;
  scale = 1;
  stretch = 1;
  flash = 0;
  flashColor: V3 = [1, 0.8, 0.5];
  glow = 1;
  rim = 0.5;
  heat = 0;
  fogScale = 1;
  /** Draws one part alone, turning about its own pivot. */
  solo = -1;
  light = { amb: [0.2, 0.2, 0.2] as V3, key: [0.2, 0.2, 0.2] as V3, dir: [0, 1, 0] as V3 };
  private lightAge = Math.random() * 0.1;
  private names: Map<string, number>;
  private static all = new Set<Actor>();

  constructor(scene: Scene, readonly model: Model, surfaces: Surfaces, group = 0) {
    this.mesh = source(scene, model).clone(`actor ${model.name}`, null, true);
    this.mesh.setEnabled(true);
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = group;
    this.material = actorMaterial(scene, surfaces);
    this.mesh.material = this.material;
    // The shader reads the live bone array on every draw.
    (this.material as unknown as { _matrixArrays: Record<string, Float32Array> })._matrixArrays.u_bones = this.bones;
    this.poses = model.parts.map(() => ({ rx: 0, ry: 0, rz: 0, x: 0, y: 0, z: 0, s: 1 }));
    this.names = new Map(model.parts.map((p, i) => [p.name, i]));
    Actor.all.add(this);
  }
  /** Frees shapes made for one level. */
  static forget(scene: Scene, prefix: string) {
    const store = geometry.get(scene);
    for (const [name, mesh] of store ?? []) if (name.startsWith(prefix)) (mesh.dispose(), store!.delete(name));
  }
  static get list(): Iterable<Actor> {
    return Actor.all;
  }
  part(name: string): Pose | undefined {
    const i = this.names.get(name);
    return i === undefined ? undefined : this.poses[i];
  }
  has(name: string) {
    return this.names.has(name);
  }
  reset() {
    for (const p of this.poses) ((p.rx = p.ry = p.rz = p.x = p.y = p.z = 0), (p.s = p.s > 0 ? 1 : 0));
  }

  /** Writes the world matrix of every part. */
  pose() {
    const { bones, model } = this;
    if (this.solo >= 0) {
      write(bones, this.solo * 16, this.yaw, this.pitch, this.roll, this.scale, this.scale, this.pos, model.parts[this.solo].pivot);
      this.mesh.position.set(this.pos[0], this.pos[1], this.pos[2]);
      return;
    }
    write(bones, 0, this.yaw, this.pitch, this.roll, this.scale, this.scale * this.stretch, this.pos, [0, 0, 0]);
    const root = this.poses[0];
    if (root.rx || root.ry || root.rz || root.x || root.y || root.z || root.s !== 1) {
      write(LOCAL, 0, root.ry, root.rx, root.rz, root.s, root.s, [root.x, root.y, root.z], [0, 0, 0]);
      TEMP.set(bones.subarray(0, 16));
      multiply(bones, 0, LOCAL, 0, TEMP, 0);
    }
    for (let i = 1; i < model.parts.length; i++) {
      const p = this.poses[i];
      const { pivot, parent } = model.parts[i];
      write(LOCAL, 0, p.ry, p.rx, p.rz, p.s, p.s, [pivot[0] + p.x, pivot[1] + p.y, pivot[2] + p.z], pivot);
      multiply(bones, i * 16, LOCAL, 0, bones, parent * 16);
    }
    this.mesh.position.set(this.pos[0], this.pos[1], this.pos[2]);
  }

  /** World place of a point given in model space on a part. */
  point(name: string, offset: V3 = [0, 0, 0]): V3 {
    const i = this.names.get(name) ?? 0;
    const pv = model(this, i);
    const p: V3 = [pv[0] + offset[0], pv[1] + offset[1], pv[2] + offset[2]];
    const b = this.bones;
    const o = i * 16;
    return [b[o] * p[0] + b[o + 4] * p[1] + b[o + 8] * p[2] + b[o + 12], b[o + 1] * p[0] + b[o + 5] * p[1] + b[o + 9] * p[2] + b[o + 13], b[o + 2] * p[0] + b[o + 6] * p[1] + b[o + 10] * p[2] + b[o + 14]];
  }

  relight(grid: LightGrid, dt: number, height = 1) {
    this.lightAge -= dt;
    if (this.lightAge > 0) return;
    this.lightAge = 0.12;
    grid.sample([this.pos[0], this.pos[1] + height, this.pos[2]], this.light);
    // Next to a fire a machine keeps its colours.
    const top = Math.max(...this.light.key);
    if (top > 1) this.light.key = this.light.key.map((v) => v / top) as V3;
  }

  apply(viewProjection: Matrix) {
    const m = this.material;
    const { amb, key, dir } = this.light;
    m.setMatrix("u_vp", viewProjection);
    v4(m, "u_amb", amb[0] * 1.15, amb[1] * 1.15, amb[2] * 1.15, 0);
    v4(m, "u_low", amb[0] * 0.55, amb[1] * 0.5, amb[2] * 0.5, 0);
    v4(m, "u_key", key[0], key[1], key[2], 0);
    v4(m, "u_keyDir", dir[0], dir[1], dir[2], 0);
    v4(m, "u_flash", this.flashColor[0], this.flashColor[1], this.flashColor[2], this.flash);
    v4(m, "u_extra", this.glow * 2.2, this.rim, this.heat, this.fogScale);
  }

  dispose() {
    Actor.all.delete(this);
    this.material.dispose();
    this.mesh.dispose(true);
  }
}
const model = (a: Actor, i: number) => a.model.parts[i].pivot;
const LOCAL = new Float32Array(16);
const TEMP = new Float32Array(16);

/** Row-vector matrix: move pivot to the origin, scale, roll, pitch, yaw, then to `to`. */
function write(m: Float32Array, o: number, yaw: number, pitch: number, roll: number, s: number, sy: number, to: V3 | readonly number[], pivot: readonly number[]) {
  const a = Math.sin(yaw), b = Math.cos(yaw), c = Math.sin(pitch), d = Math.cos(pitch), e = Math.sin(roll), f = Math.cos(roll);
  m[o] = (f * b + e * c * a) * s; m[o + 1] = e * d * s; m[o + 2] = (-f * a + e * c * b) * s; m[o + 3] = 0;
  m[o + 4] = (-e * b + f * c * a) * sy; m[o + 5] = f * d * sy; m[o + 6] = (e * a + f * c * b) * sy; m[o + 7] = 0;
  m[o + 8] = d * a * s; m[o + 9] = -c * s; m[o + 10] = d * b * s; m[o + 11] = 0;
  const [x, y, z] = pivot;
  m[o + 12] = to[0] - (x * m[o] + y * m[o + 4] + z * m[o + 8]);
  m[o + 13] = to[1] - (x * m[o + 1] + y * m[o + 5] + z * m[o + 9]);
  m[o + 14] = to[2] - (x * m[o + 2] + y * m[o + 6] + z * m[o + 10]);
  m[o + 15] = 1;
}
function multiply(out: Float32Array, o: number, a: Float32Array, i: number, b: Float32Array, j: number) {
  for (let r = 0; r < 4; r++) {
    const x = a[i + r * 4], y = a[i + r * 4 + 1], z = a[i + r * 4 + 2], w = a[i + r * 4 + 3];
    for (let c = 0; c < 4; c++) out[o + r * 4 + c] = x * b[j + c] + y * b[j + 4 + c] + z * b[j + 8 + c] + w * b[j + 12 + c];
  }
}
