import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { type V3, cross, norm, rand, seeded, sub } from "../level/vec";
import { makeShader } from "./shader";

/** Cells of the sprite sheet: 16 px squares, 8 across. */
export const SPRITE = { dot: 0, spark: 1, ring: 2, star: 3, glow: 4, ember: 5, drop: 6, beam: 7, smoke: 8, flame: 12, hole: 16, scorch: 17, splat: 18, splat2: 19, shadow: 20, crack: 21, muzzle: 22, muzzle2: 23, chip: 24, bolt: 25, wave: 26, soft: 27 } as const;
const COLS = 8;
const CELL = 16;

function sheet(scene: Scene) {
  const size = COLS * CELL;
  const data = new Uint8Array(size * size * 4);
  const r = seeded(42);
  const noise = Array.from({ length: 4096 }, () => r());
  const n = (x: number, y: number, s: number) => {
    const at = (i: number, j: number) => noise[((i & 63) * 64 + (j & 63)) & 4095];
    const u = x / s, v = y / s, i = Math.floor(u), j = Math.floor(v), f = u - i, g = v - j;
    return (at(i, j) * (1 - f) + at(i + 1, j) * f) * (1 - g) + (at(i, j + 1) * (1 - f) + at(i + 1, j + 1) * f) * g;
  };
  const draw = (cell: number, fn: (x: number, y: number, rad: number, ang: number, i: number, j: number) => [number, number]) => {
    const ox = (cell % COLS) * CELL;
    const oy = Math.floor(cell / COLS) * CELL;
    for (let j = 0; j < CELL; j++)
      for (let i = 0; i < CELL; i++) {
        const x = (i + 0.5) / 8 - 1;
        const y = (j + 0.5) / 8 - 1;
        const [value, alpha] = fn(x, y, Math.hypot(x, y), Math.atan2(y, x), i, j);
        const o = ((oy + j) * size + ox + i) * 4;
        // Few steps of brightness keep the sprites in the texture style.
        const q = (v: number) => Math.round((Math.round(Math.max(0, Math.min(1, v)) * 6) / 6) * 255);
        data[o] = data[o + 1] = data[o + 2] = q(value);
        data[o + 3] = q(alpha);
      }
  };
  const fall = (v: number) => Math.max(0, 1 - v);
  draw(0, (_x, _y, d) => [d < 0.8 ? 1 : 0, d < 0.8 ? 1 : 0]);
  draw(1, (x, y) => { const v = fall(Math.abs(y) * 3.2 + Math.pow(Math.abs(x), 3)); return [v, v]; });
  draw(2, (_x, _y, d) => { const v = fall(Math.abs(d - 0.78) * 6); return [v, v]; });
  draw(3, (x, y, d) => { const v = Math.max(fall(Math.abs(x) * 5 + Math.abs(y)), fall(Math.abs(y) * 5 + Math.abs(x)), fall(d * 2.4)); return [v, v]; });
  draw(4, (_x, _y, d) => { const v = Math.pow(fall(d), 1.8); return [v, v]; });
  draw(5, (x, y) => [Math.abs(x) < 0.4 && Math.abs(y) < 0.4 ? 1 : 0, Math.abs(x) < 0.4 && Math.abs(y) < 0.4 ? 1 : 0]);
  draw(6, (_x, y, d) => [d < 0.7 ? 1 - y * 0.4 : 0, d < 0.7 ? 1 : 0]);
  draw(7, (_x, y) => { const v = fall(Math.abs(y)); return [v, v]; });
  for (let k = 0; k < 4; k++) draw(8 + k, (_x, _y, d, _a, i, j) => { const v = fall(d * 1.05) * 1.5 * (0.35 + n(i + k * 40, j + k * 23, 3.2)) - k * 0.13; return [0.6 + n(i + k * 9, j, 2.5) * 0.4, v > 0.22 ? Math.min(1, v * 1.3) : 0]; });
  for (let k = 0; k < 4; k++) draw(12 + k, (x, y, _d, _a, i, j) => { const w = 0.75 - (1 - (y + 1) / 2) * 0.6; const v = fall(Math.abs(x + (n(0, j + k * 11, 3) - 0.5) * 0.5) / Math.max(0.08, w)) * (0.4 + n(i + k * 17, j + k * 31, 2.4)) * (y > 0.86 ? 0.6 : 1); return [v, v > 0.2 ? v : 0]; });
  draw(16, (_x, _y, d) => [d < 0.4 ? 0 : 0.35, d < 0.4 ? 1 : d < 0.62 ? 0.7 : 0]);
  draw(17, (_x, _y, d, a, i, j) => { const v = fall(d * (0.95 + Math.sin(a * 7) * 0.12)) * 1.6 * (0.5 + n(i, j, 2)); return [0, Math.min(0.85, v)]; });
  for (const c of [18, 19]) draw(c, (_x, _y, d, a, i, j) => { const e = 0.5 + 0.28 * Math.sin(a * 5 + c * 2) + 0.2 * Math.sin(a * 9 + c) + (n(i + c, j, 2) - 0.5) * 0.3; return [d < e ? 1 - d * 0.5 : 0, d < e ? 1 : 0]; });
  draw(20, (_x, _y, d) => [0, Math.min(1, fall(d) * 1.5)]);
  draw(21, (_x, _y, d, a, i, j) => { const v = Math.abs(Math.sin(a * 3.5 + n(i, j, 3) * 3)) < 0.22 && d < 0.95 ? 1 : 0; return [0, v]; });
  for (const c of [22, 23]) draw(c, (_x, _y, d, a) => { const v = fall(d / (0.45 + 0.5 * Math.pow(Math.abs(Math.sin(a * (c === 22 ? 2.5 : 3) + c)), 3))); return [Math.min(1, v * 1.8), Math.min(1, v * 1.8)]; });
  draw(24, (x, y) => [0.8 - y * 0.2, Math.abs(x) + Math.abs(y) < 0.9 ? 1 : 0]);
  draw(25, (x, y, _d, _a, i) => { const v = fall(Math.abs(y - (noise[i * 7] - 0.5) * 0.9) * 2.6); void x; return [v, v]; });
  draw(26, (_x, _y, d) => { const v = d < 1 ? Math.pow(d, 5) * fall(Math.max(0, d - 0.9) * 10) : 0; return [v, v]; });
  draw(27, (_x, _y, d) => { const v = fall(d); return [v, v]; });
  const t = RawTexture.CreateRGBATexture(data, size, size, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

/** Growing buffer of quads, sent to the graphics card once a frame. */
class Quads {
  readonly mesh: Mesh;
  count = 0;
  private pos: Float32Array;
  private uv: Float32Array;
  private col: Float32Array;
  private shown = -1;

  constructor(private scene: Scene, name: string, private max: number, shader: ReturnType<typeof makeShader>, group = 0) {
    this.pos = new Float32Array(max * 12);
    this.uv = new Float32Array(max * 8);
    this.col = new Float32Array(max * 16);
    const mesh = new Mesh(name, scene);
    const index = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    mesh.setVerticesData(VertexBuffer.PositionKind, this.pos, true, 3);
    mesh.setVerticesData(VertexBuffer.UVKind, this.uv, true, 2);
    mesh.setVerticesData("shade", this.col, true, 4);
    mesh.setIndices(index);
    mesh.material = shader;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = group;
    mesh.setBoundingInfo(new BoundingInfo(new Vector3(-500, -500, -500), new Vector3(500, 500, 500)));
    mesh.doNotSyncBoundingInfo = true;
    this.mesh = mesh;
  }
  begin() {
    this.count = 0;
  }
  quad(a: V3, b: V3, c: V3, d: V3, cell: number, r: number, g: number, bl: number, alpha: number, flip = false) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set(a, i * 12); this.pos.set(b, i * 12 + 3); this.pos.set(c, i * 12 + 6); this.pos.set(d, i * 12 + 9);
    const u = (cell % COLS) / COLS, v = Math.floor(cell / COLS) / COLS, s = 1 / COLS - 0.0005;
    const v0 = flip ? v + s : v + 0.0005, v1 = flip ? v + 0.0005 : v + s;
    this.uv.set([u + 0.0005, v1, u + s, v1, u + s, v0, u + 0.0005, v0], i * 8);
    for (let k = 0; k < 4; k++) this.col.set([r, g, bl, alpha], i * 16 + k * 4);
  }
  end() {
    this.mesh.setEnabled(this.count > 0);
    if (!this.count) return;
    // Quads of the last frame that are not used now collapse to nothing.
    if (this.shown > this.count) this.pos.fill(0, this.count * 12, this.shown * 12);
    this.shown = this.count;
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.pos);
    this.mesh.updateVerticesData(VertexBuffer.UVKind, this.uv);
    this.mesh.updateVerticesData("shade", this.col);
    const sub = this.mesh.subMeshes[0];
    sub.setBoundingInfo(this.mesh.getBoundingInfo());
    sub.indexCount = this.count * 6;
    sub.verticesCount = this.count * 4;
    void this.scene;
  }
}

interface Particle {
  pos: V3; vel: V3; life: number; total: number; size: number; grow: number;
  color: V3; end: V3; add: number; alpha: number; cell: number; frames: number; gravity: number; drag: number; stretch: number; spin: number; angle: number; bounce: boolean;
}
export interface Spawn {
  vel?: V3; life?: number; size?: number; grow?: number; color?: V3; end?: V3;
  /** 1 adds light, 0 covers. */
  add?: number; alpha?: number; cell?: number; frames?: number; gravity?: number; drag?: number; stretch?: number; spin?: number; bounce?: boolean;
}
interface Decal { q: [V3, V3, V3, V3]; cell: number; age: number; hot: number; color: V3; alpha: number }
const MAX_PARTICLES = 900;
const MAX_DECALS = 170;

export class Particles {
  private live: Particle[] = [];
  private decals: Decal[] = [];
  private nextDecal = 0;
  private quads: Quads;
  private flat: Quads;
  private near: Quads;
  readonly materials: ReturnType<typeof makeShader>[];
  right: V3 = [1, 0, 0];
  up: V3 = [0, 1, 0];
  eye: V3 = [0, 0, 0];
  amount = 1;
  /** Floor height under a falling particle that bounces. */
  floorAt: (p: V3, v: V3) => { y: number } | null = () => null;

  constructor(scene: Scene) {
    const texture = sheet(scene);
    const make = (name: string, bias: boolean) => {
      const m = makeShader(scene, name, {
        attributes: { a_position: "vec3", a_uv: "vec2", a_shade: "vec4" },
        varyings: { v_uv: "vec2", v_shade: "vec4", v_dist: "float" },
        uniforms: { u_eye: "vec4", u_fog: "vec4" },
        samplers: { sheet: "2d" },
        vertex: `v_uv = a_uv; v_shade = a_shade; v_dist = distance(a_position, u_eye.xyz); vec4 c = u_viewProjection * vec4(a_position, 1.0); ${bias ? "c = vec4(c.x, c.y, c.z - 0.0006 * c.w, c.w);" : ""} POSITION = c;`,
        fragment: `vec4 t = TEX(sheet, v_uv); float f = exp(-v_dist * u_fog.w); COLOR = vec4(v_shade.xyz * t.x * t.w * f, t.w * v_shade.w * f);`,
        blend: "pre",
      });
      m.setTexture("sheet", texture);
      return m;
    };
    const a = make("fcParticles", false);
    const b = make("fcDecals", true);
    this.materials = [a, b];
    this.flat = new Quads(scene, "decals", MAX_DECALS + 80, b);
    this.quads = new Quads(scene, "particles", MAX_PARTICLES + 260, a);
    this.near = new Quads(scene, "nearparticles", 40, a, 1);
    this.flat.mesh.alphaIndex = 1;
    this.quads.mesh.alphaIndex = 5;
  }

  spawn(pos: V3, s: Spawn) {
    if (this.live.length >= MAX_PARTICLES) this.live.shift();
    const life = s.life ?? 0.5;
    this.live.push({
      pos: [...pos], vel: s.vel ? [...s.vel] : [0, 0, 0], life, total: life, size: s.size ?? 0.1, grow: s.grow ?? 0, color: s.color ?? [1, 1, 1], end: s.end ?? s.color ?? [1, 1, 1], add: s.add ?? 1, alpha: s.alpha ?? 1,
      cell: s.cell ?? SPRITE.ember, frames: s.frames ?? 1, gravity: s.gravity ?? 0, drag: s.drag ?? 0, stretch: s.stretch ?? 0, spin: s.spin ?? 0, angle: s.spin ? rand(0, 6.28) : 0, bounce: s.bounce ?? false,
    });
  }
  burst(pos: V3, count: number, speed: [number, number], s: Spawn, dir: V3 = [0, 0, 0], spread = 1) {
    const n = Math.max(1, Math.round(count * this.amount));
    for (let i = 0; i < n; i++) {
      const d = norm([rand(-1, 1) * spread + dir[0], rand(-1, 1) * spread + dir[1], rand(-1, 1) * spread + dir[2]]);
      const v = rand(speed[0], speed[1]);
      this.spawn(pos, { ...s, vel: [d[0] * v, d[1] * v, d[2] * v], life: (s.life ?? 0.5) * rand(0.6, 1.2), size: (s.size ?? 0.1) * rand(0.7, 1.25) });
    }
  }
  decal(pos: V3, n: V3, size: number, cell: number, color: V3, alpha = 0.9, hot = 0) {
    const t = norm(Math.abs(n[1]) > 0.8 ? cross(n, [rand(-1, 1), 0, rand(-1, 1)]) : cross(n, [rand(-0.6, 0.6), 1, rand(-0.6, 0.6)]));
    const b = cross(n, t);
    const p: V3 = [pos[0] + n[0] * 0.012, pos[1] + n[1] * 0.012, pos[2] + n[2] * 0.012];
    const at = (u: number, v: number): V3 => [p[0] + t[0] * u * size + b[0] * v * size, p[1] + t[1] * u * size + b[1] * v * size, p[2] + t[2] * u * size + b[2] * v * size];
    this.decals[this.nextDecal] = { q: [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], cell, age: 0, hot, color, alpha };
    this.nextDecal = (this.nextDecal + 1) % MAX_DECALS;
  }
  clear() {
    this.live.length = 0;
    this.decals.length = 0;
    this.nextDecal = 0;
  }

  // Things drawn for one frame
  begin() {
    this.quads.begin(); this.flat.begin(); this.near.begin();
  }
  sprite(pos: V3, size: number, cell: number, color: V3, add = 1, alpha = 1, near = false, angle = 0) {
    const c = Math.cos(angle) * size, s = Math.sin(angle) * size;
    const { right: r, up: u } = this;
    const at = (x: number, y: number): V3 => [pos[0] + r[0] * (x * c - y * s) + u[0] * (x * s + y * c), pos[1] + r[1] * (x * c - y * s) + u[1] * (x * s + y * c), pos[2] + r[2] * (x * c - y * s) + u[2] * (x * s + y * c)];
    (near ? this.near : this.quads).quad(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1), cell, color[0], color[1], color[2], alpha * (1 - add));
  }
  beam(a: V3, b: V3, width: number, cell: number, color: V3, add = 1, alpha = 1, near = false) {
    const d = norm(sub(b, a));
    const s = norm(cross(d, sub(this.eye, a)));
    const w: V3 = [s[0] * width, s[1] * width, s[2] * width];
    (near ? this.near : this.quads).quad([a[0] - w[0], a[1] - w[1], a[2] - w[2]], [b[0] - w[0], b[1] - w[1], b[2] - w[2]], [b[0] + w[0], b[1] + w[1], b[2] + w[2]], [a[0] + w[0], a[1] + w[1], a[2] + w[2]], cell, color[0], color[1], color[2], alpha * (1 - add));
  }
  /** Flat on the ground. */
  ground(pos: V3, size: number, cell: number, color: V3, add: number, alpha: number, n: V3 = [0, 1, 0]) {
    const t = norm(Math.abs(n[0]) > 0.9 ? cross(n, [0, 0, 1]) : cross(n, [1, 0, 0]));
    const b = cross(n, t);
    const at = (u: number, v: number): V3 => [pos[0] + (t[0] * u + b[0] * v) * size, pos[1] + 0.02 + (t[1] * u + b[1] * v) * size, pos[2] + (t[2] * u + b[2] * v) * size];
    this.flat.quad(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1), cell, color[0], color[1], color[2], alpha * (1 - add));
  }

  update(dt: number) {
    for (const d of this.decals) {
      if (!d) continue;
      d.age += dt;
      const h = d.hot ? Math.max(0, 1 - d.age / d.hot) : 0;
      const heat = h * h;
      this.flat.quad(d.q[0], d.q[1], d.q[2], d.q[3], d.cell, d.color[0] * (1 - h) + (1.9 * heat + 0.5 * h), d.color[1] * (1 - h) + (0.75 * heat + 0.06 * h), d.color[2] * (1 - h) + 0.12 * heat, d.alpha);
    }
    let w = 0;
    for (const p of this.live) {
      p.life -= dt;
      if (p.life <= 0) continue;
      this.live[w++] = p;
      const k = 1 - p.life / p.total;
      const drag = Math.exp(-p.drag * dt);
      p.vel[1] -= p.gravity * dt;
      for (let a = 0; a < 3; a++) ((p.vel[a] *= drag), (p.pos[a] += p.vel[a] * dt));
      if (p.bounce && p.vel[1] < 0) {
        const f = this.floorAt(p.pos, p.vel);
        if (f && p.pos[1] < f.y + 0.03) {
          p.pos[1] = f.y + 0.03;
          p.vel[1] *= -0.4; p.vel[0] *= 0.6; p.vel[2] *= 0.6;
        }
      }
      p.angle += p.spin * dt;
      const size = Math.max(0.004, p.size + p.grow * k);
      const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      const c: V3 = [(p.color[0] + (p.end[0] - p.color[0]) * k) * fade * p.alpha, (p.color[1] + (p.end[1] - p.color[1]) * k) * fade * p.alpha, (p.color[2] + (p.end[2] - p.color[2]) * k) * fade * p.alpha];
      const cell = p.cell + (p.frames > 1 ? Math.min(p.frames - 1, Math.floor(k * p.frames)) : 0);
      if (p.stretch) {
        const l = p.stretch;
        const b: V3 = [p.pos[0] - p.vel[0] * l, p.pos[1] - p.vel[1] * l, p.pos[2] - p.vel[2] * l];
        this.beam(p.pos, b, size, cell, c, p.add, fade * p.alpha);
      } else this.sprite(p.pos, size, cell, c, p.add, fade * p.alpha, false, p.angle);
    }
    this.live.length = w;
    this.quads.end(); this.flat.end(); this.near.end();
  }
}
