import data from "../gfx/layers.json" with { type: "json" };
import type { Model } from "./kit";
import { PROPS } from "./props";
import { type Brush, boxBrush, centroid, Collision, convexBrush, faceNormal } from "./trace";
import { type V3, add, cross, dot, norm } from "./vec";

/** Level geometry: rooms carved out of solid ground on a 1 m grid, solids and kit pieces on top. Shared with the light baker. */
export const LAYERS: string[] = data.layers;
export const layerOf = (tex: string) => {
  const i = LAYERS.indexOf(tex);
  if (i < 0) throw new Error(`no texture ${tex}`);
  return i;
};
export const LM_DENSITY = 4;
export const TILE = 4;

export interface Style {
  wall: string;
  /** Lowest metre and topmost metre of the walls. */
  base?: string;
  top?: string;
  floor: string;
  ceil: string;
  plinth?: number;
  cornice?: number;
}
export interface Face {
  poly: V3[];
  n: V3;
  t: V3;
  b: V3;
  layer: number;
  /** Texture coordinates per vertex. */
  uv: [number, number][];
  minT: number;
  minB: number;
  w: number;
  h: number;
  /** Place in the light map, in texels. */
  x: number;
  y: number;
  liquid?: boolean;
}
export interface Prop {
  model: string;
  pos: V3;
  yaw: number;
  pitch: number;
  roll: number;
  scale: V3;
  /** Turns about its own z axis, radians per second; drawn as a moving thing. */
  spin: number;
  swing: number;
  /** Set by the mesher: where its vertices start in the vertex light file. */
  first: number;
}
export interface Light { pos: V3; color: V3; power: number; range: number; size: number; dir?: V3; cone?: number }
export interface Beam { pos: V3; half: V3; dir: V3; color: V3; power: number; length: number }
export interface Liquid { lo: V3; hi: V3; kind: "molten" | "oil" }
export interface DoorDef { id: string; lo: V3; hi: V3; move: V3; key?: KeyName; auto: boolean; tex: string; open?: string; close?: string; time: number; sigil?: "x" | "z" }
export interface LiftDef { id: string; lo: V3; hi: V3; rise: number; tex: string; mode: "step" | "loop" | "signal"; signal?: string; speed: number; wait: number }
export interface EnemyDef { kind: string; pos: V3; yaw: number; spawn?: string; group?: string; min: number; wait: number }
export interface ItemDef { kind: string; pos: V3; secret?: boolean }
export interface TriggerDef { lo: V3; hi: V3; fire: string[]; text?: string; once: boolean }
export interface SwitchDef { pos: V3; yaw: number; fire: string[]; text: string }
export interface SecretDef { lo: V3; hi: V3; name: string }
export interface JumpPad { lo: V3; hi: V3; velocity: V3 }
export type KeyName = "cobalt" | "rose" | "white";

export interface Room { lo: V3; hi: V3; style: Style }
const STEP = 0.5;

export class LevelBuilder {
  name = "";
  par = 300;
  fog: { color: V3; density: number; floor?: number; height?: number } = { color: [0.1, 0.07, 0.06], density: 0.02 };
  ambient: V3 = [0.28, 0.34, 0.37];
  music = "main";
  start: { pos: V3; yaw: number; velocity?: V3 } = { pos: [0, 1, 0], yaw: 0 };
  weapons: string[] = [];
  rooms: Room[] = [];
  faces: Face[] = [];
  brushes: Brush[] = [];
  props: Prop[] = [];
  lights: Light[] = [];
  beams: Beam[] = [];
  liquids: Liquid[] = [];
  doors: DoorDef[] = [];
  lifts: LiftDef[] = [];
  enemies: EnemyDef[] = [];
  items: ItemDef[] = [];
  triggers: TriggerDef[] = [];
  switches: SwitchDef[] = [];
  secrets: SecretDef[] = [];
  pads: JumpPad[] = [];
  checkpoints: { lo: V3; hi: V3; pos: V3; yaw: number }[] = [];
  exit: { lo: V3; hi: V3 } | null = null;
  /** Group name to what is fired once all its enemies are dead. */
  cleared: Record<string, string[]> = {};
  /** Moments where the level speaks: signal to text. */
  lines: Record<string, string> = {};
  atlas = { w: 512, h: 512 };
  collision = new Collision();
  private size: V3 = [0, 0, 0];
  private origin: V3 = [0, 0, 0];
  private cells = new Int16Array(0);
  private detail: { lo: V3; hi: V3 }[] = [];

  // Space
  room(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, style: Style) {
    this.rooms.push({ lo: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], hi: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], style });
  }
  /** Puts solid ground back, as walls between or pillars inside rooms. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.rooms.push({ lo: [x0, y0, z0], hi: [x1, y1, z1], style: null as unknown as Style });
  }

  // Solids
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tex: string, side = tex, opts: { collide?: boolean; clip?: boolean; band?: number } = {}) {
    const lo: V3 = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)];
    const hi: V3 = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    if (opts.collide !== false) this.addBrush(boxBrush(lo, hi), opts.clip);
    this.detail.push({ lo, hi });
    const p = (i: number): V3 => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
    const quads: [number[], string][] = [[[1, 3, 7, 5], side], [[0, 4, 6, 2], side], [[2, 6, 7, 3], tex], [[0, 1, 5, 4], tex], [[4, 5, 7, 6], side], [[0, 2, 3, 1], side]];
    const c = centroid(quads.map(([ids]) => ids.map(p)));
    for (const [ids, t] of quads) this.face(ids.map(p), c, t, opts.band, [lo, hi]);
  }
  /** Any convex solid from its polygons. */
  solid(polys: V3[][], tex: string | ((n: V3) => string), opts: { collide?: boolean; hidden?: boolean; clip?: boolean } = {}) {
    if (opts.collide !== false) this.addBrush(convexBrush(polys), opts.clip);
    if (opts.hidden) return;
    const c = centroid(polys);
    for (const poly of polys) this.face(poly, c, typeof tex === "string" ? tex : tex(faceNormal(poly, c)));
  }
  clip(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.addBrush(boxBrush([x0, y0, z0], [x1, y1, z1]), true);
  }
  block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.addBrush(boxBrush([x0, y0, z0], [x1, y1, z1]));
  }
  /** Slope rising from y0 to y1 towards `dir`. */
  ramp(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, dir: "x+" | "x-" | "z+" | "z-", tex: string, side: string, bottom = y0, opts: { hidden?: boolean } = {}) {
    const h = (x: number, z: number) => {
      const k = dir === "x+" ? (x - x0) / (x1 - x0) : dir === "x-" ? (x1 - x) / (x1 - x0) : dir === "z+" ? (z - z0) / (z1 - z0) : (z1 - z) / (z1 - z0);
      return y0 + (y1 - y0) * k;
    };
    const corner: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const top = corner.map(([x, z]): V3 => [x, h(x, z), z]);
    const low = corner.map(([x, z]): V3 => [x, bottom, z]);
    const polys: V3[][] = [top, low];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const q: V3[] = [];
      for (const v of [low[i], low[j], top[j], top[i]]) if (!q.some((o) => o[0] === v[0] && o[1] === v[1] && o[2] === v[2])) q.push(v);
      if (q.length > 2) polys.push(q);
    }
    this.solid(polys, (n) => (n[1] > 0.3 ? tex : side), opts);
  }
  /** Steps to see, a slope to walk on. */
  stairs(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, dir: "x+" | "x-" | "z+" | "z-", tex: string, side: string, bottom = y0) {
    const steps = Math.max(1, Math.round((y1 - y0) / STEP));
    for (let i = 0; i < steps; i++) {
      const a = i / steps;
      const top = y0 + ((i + 1) * (y1 - y0)) / steps;
      const [xa, xb] = dir === "x+" ? [x0 + (x1 - x0) * a, x1] : dir === "x-" ? [x0, x1 - (x1 - x0) * a] : [x0, x1];
      const [za, zb] = dir === "z+" ? [z0 + (z1 - z0) * a, z1] : dir === "z-" ? [z0, z1 - (z1 - z0) * a] : [z0, z1];
      const run = (dir[0] === "x" ? x1 - x0 : z1 - z0) / steps;
      const lastLen = run + 0.02;
      const lo: V3 = [xa, i ? y0 + (i * (y1 - y0)) / steps - 0.02 : bottom, za];
      const hi: V3 = [xb, top, zb];
      if (i === 0) lo[1] = bottom;
      void lastLen;
      this.box(...lo, ...hi, tex, side, { collide: false });
    }
    this.ramp(x0, z0, x1, z1, y0, y1, dir, tex, side, bottom, { hidden: true });
  }
  /** Upright prism from a convex outline. */
  prism(points: [number, number][], y0: number, y1: number, tex: string, side: string, opts: { collide?: boolean } = {}) {
    const low = points.map(([x, z]): V3 => [x, y0, z]);
    const top = points.map(([x, z]): V3 => [x, y1, z]);
    const polys: V3[][] = [low, top];
    points.forEach((_, i) => {
      const j = (i + 1) % points.length;
      polys.push([low[i], low[j], top[j], top[i]]);
    });
    this.solid(polys, (n) => (Math.abs(n[1]) > 0.5 ? tex : side), opts);
  }
  disc(x: number, z: number, r: number, y0: number, y1: number, tex: string, side: string, n = 12, turn = 0) {
    this.prism(Array.from({ length: n }, (_, i): [number, number] => [x + Math.sin(turn + (i / n) * 2 * Math.PI) * r, z + Math.cos(turn + (i / n) * 2 * Math.PI) * r]), y0, y1, tex, side);
  }
  /** Round wall of `n` straight pieces inside a room; `skip` pieces stay open up to `lintel`. */
  ringWall(x: number, z: number, r: number, thick: number, y0: number, y1: number, n: number, tex: string, skip: number[] = [], lintel = y0) {
    const at = (i: number, rad: number): [number, number] => [x + Math.sin(((i - 0.5) / n) * 2 * Math.PI) * rad, z + Math.cos(((i - 0.5) / n) * 2 * Math.PI) * rad];
    for (let i = 0; i < n; i++) {
      const low = skip.includes(i) ? lintel : y0;
      if (low >= y1) continue;
      this.prism([at(i, r), at(i + 1, r), at(i + 1, r + thick), at(i, r + thick)], low, y1, tex, tex);
    }
  }
  /** Pointed barrel vault under a flat ceiling, running along an axis. */
  vault(x0: number, z0: number, x1: number, z1: number, spring: number, peak: number, axis: "x" | "z", tex: string, segments = 6) {
    const [a0, a1] = axis === "z" ? [x0, x1] : [z0, z1];
    const half = (a1 - a0) / 2;
    const mid = (a0 + a1) / 2;
    const rise = peak - spring;
    const curve = (k: number): [number, number] => {
      const ang = (k * Math.PI) / 2;
      return [half * Math.pow(Math.cos(ang), 0.85), spring + rise * Math.pow(Math.sin(ang), 0.92)];
    };
    for (const side of [-1, 1])
      for (let i = 0; i < segments; i++) {
        const [p0, q0] = curve(i / segments);
        const [p1, q1] = curve((i + 1) / segments);
        const inner: [number, number][] = [[mid + side * p0, q0], [mid + side * p1, q1]];
        const outer: [number, number][] = [[mid + side * p1, q1 + 0.5], [mid + side * (p0 + 0.4), q0 + 0.5]];
        const ring = [...inner, ...outer];
        const put = ([a, y]: [number, number], c: number): V3 => (axis === "z" ? [a, y, c] : [c, y, a]);
        const [c0, c1] = axis === "z" ? [z0, z1] : [x0, x1];
        const A = ring.map((r) => put(r, c0));
        const B = ring.map((r) => put(r, c1));
        this.addBrush(convexBrush([A, B, ...ring.map((_, k): V3[] => [A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k]])]));
        this.face([A[0], A[1], B[1], B[0]], centroid([A, B]), tex);
      }
  }
  liquid(x0: number, z0: number, x1: number, z1: number, y: number, kind: Liquid["kind"], depth = 2) {
    this.liquids.push({ lo: [x0, y - depth, z0], hi: [x1, y, z1], kind });
    this.face([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [(x0 + x1) / 2, y - 1, (z0 + z1) / 2], kind === "molten" ? "molten" : "oil");
    this.faces[this.faces.length - 1].liquid = true;
  }

  // Things
  prop(model: string, x: number, y: number, z: number, yaw = 0, scale: number | V3 = 1, opts: { pitch?: number; roll?: number; spin?: number; swing?: number; solid?: boolean } = {}) {
    const s: V3 = typeof scale === "number" ? [scale, scale, scale] : scale;
    const prop: Prop = { model, pos: [x, y, z], yaw: (yaw * Math.PI) / 180, pitch: ((opts.pitch ?? 0) * Math.PI) / 180, roll: ((opts.roll ?? 0) * Math.PI) / 180, scale: s, spin: opts.spin ?? 0, swing: opts.swing ?? 0, first: -1 };
    this.props.push(prop);
    const info = PROPS[model];
    const m = propMatrix(prop);
    if (info?.solid && opts.solid !== false)
      for (const [lo, hi] of info.solid) {
        const c = Array.from({ length: 8 }, (_, i) => apply(m, [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]]));
        this.addBrush(convexBrush([[1, 3, 7, 5], [0, 2, 6, 4], [2, 3, 7, 6], [0, 1, 5, 4], [4, 5, 7, 6], [0, 1, 3, 2]].map((ids) => ids.map((i) => c[i]))));
      }
    for (const l of info?.lights ?? []) this.light(...apply(m, l.at), l.color, l.power * Math.max(...s), l.range ?? 14, l.size ?? 0.25);
    if (info?.beam) {
      const o = apply(m, [0, info.beam.at, 0.2]);
      const f = norm([m[6], m[7], m[8]]);
      this.light(...add(o, [f[0] * 0.8, f[1] * 0.8, f[2] * 0.8]), info.beam.color, info.beam.power, 18, 1.1, f, 0.1);
    }
    return prop;
  }
  light(x: number, y: number, z: number, color: V3, power: number, range = 14, size = 0.3, dir?: V3, cone?: number) {
    this.lights.push({ pos: [x, y, z], color, power, range, size, dir, cone });
  }
  beam(pos: V3, half: V3, dir: V3, color: V3, power: number, length = 40) {
    this.beams.push({ pos, half, dir: norm(dir), color, power, length });
  }
  door(id: string, lo: V3, hi: V3, opts: Partial<DoorDef> = {}) {
    const high = hi[1] - lo[1];
    this.doors.push({ id, lo, hi, move: [0, high - 0.15, 0], auto: !opts.open, tex: "door", time: 0.55, ...opts });
  }
  lift(id: string, lo: V3, hi: V3, rise: number, opts: Partial<LiftDef> = {}) {
    this.lifts.push({ id, lo, hi, rise, tex: "tread", mode: "step", speed: 5, wait: 2.2, ...opts });
  }
  enemy(kind: string, x: number, y: number, z: number, yaw = 0, opts: { spawn?: string; group?: string; min?: number; wait?: number } = {}) {
    this.enemies.push({ kind, pos: [x, y, z], yaw: (yaw * Math.PI) / 180, min: 0, wait: 0, ...opts });
  }
  item(kind: string, x: number, y: number, z: number, secret = false) {
    this.items.push({ kind, pos: [x, y, z], secret });
  }
  trigger(lo: V3, hi: V3, fire: string | string[], text?: string) {
    this.triggers.push({ lo, hi, fire: Array.isArray(fire) ? fire : [fire], text, once: true });
  }
  lever(x: number, y: number, z: number, yaw: number, fire: string | string[], text: string) {
    this.switches.push({ pos: [x, y, z], yaw: (yaw * Math.PI) / 180, fire: Array.isArray(fire) ? fire : [fire], text });
    this.prop("console", x, y, z, yaw);
  }
  secret(lo: V3, hi: V3, name: string) {
    this.secrets.push({ lo, hi, name });
  }
  checkpoint(lo: V3, hi: V3, pos: V3, yaw: number) {
    this.checkpoints.push({ lo, hi, pos, yaw: (yaw * Math.PI) / 180 });
  }

  // Geometry
  private addBrush(brush: Brush, clip = false) {
    brush.clip = clip;
    this.brushes.push(brush);
  }
  private face(poly: V3[], c: V3, tex: string, band?: number, bounds?: [V3, V3]) {
    this.pushFace(poly, faceNormal(poly, c), tex, band, bounds);
  }
  private pushFace(poly: V3[], n: V3, tex: string, band?: number, bounds?: [V3, V3]) {
    const t: V3 = Math.abs(n[1]) > 0.85 ? norm([1 - n[0] * n[0], -n[0] * n[1], -n[0] * n[2]]) : norm(cross(n, [0, 1, 0]));
    const b = cross(n, t);
    const a = poly.map((p) => [dot(p, t), dot(p, b)] as [number, number]);
    const minT = Math.min(...a.map((q) => q[0]));
    const minB = Math.min(...a.map((q) => q[1]));
    const maxT = Math.max(...a.map((q) => q[0]));
    const maxB = Math.max(...a.map((q) => q[1]));
    const uv = a.map(([u, v]): [number, number] => {
      if (band === undefined || !bounds) return [u / TILE, v / TILE];
      // A trim runs along the solid and takes its whole band across.
      return Math.abs(n[1]) > 0.5 ? [(bounds[1][0] - bounds[0][0] > bounds[1][2] - bounds[0][2] ? u : v) / TILE, (band + 0.1) / 4] : [u / TILE, (band + ((v - minB) / Math.max(1e-6, maxB - minB)) * 0.98 + 0.01) / 4];
    });
    this.faces.push({ poly, n, t, b, layer: layerOf(tex), uv, minT, minB, w: Math.ceil((maxT - minT) * LM_DENSITY - 1e-4) + 1, h: Math.ceil((maxB - minB) * LM_DENSITY - 1e-4) + 1, x: 0, y: 0 });
  }

  private at(x: number, y: number, z: number) {
    const [sx, sy, sz] = this.size;
    return x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : this.cells[x + sx * (y + sy * z)];
  }

  /** Carves the rooms, makes walls, trims and collision, and lays out the light map. */
  finish() {
    const lo: V3 = [1e9, 1e9, 1e9];
    const hi: V3 = [-1e9, -1e9, -1e9];
    for (const r of this.rooms) if (r.style) for (let a = 0; a < 3; a++) ((lo[a] = Math.min(lo[a], r.lo[a] - 2)), (hi[a] = Math.max(hi[a], r.hi[a] + 2)));
    this.origin = lo;
    this.size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const [sx, sy, sz] = this.size;
    this.cells = new Int16Array(sx * sy * sz);
    this.rooms.forEach((r, i) => {
      for (let z = r.lo[2] - lo[2]; z < r.hi[2] - lo[2]; z++) for (let y = r.lo[1] - lo[1]; y < r.hi[1] - lo[1]; y++) for (let x = r.lo[0] - lo[0]; x < r.hi[0] - lo[0]; x++) if (this.at(x, y, z) !== -1 && x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) this.cells[x + sx * (y + sy * z)] = r.style ? i + 1 : 0;
    });
    this.walls();
    this.trims();
    this.solids();
    this.hideBuried();
    for (const b of this.brushes) this.collision.add(b);
    this.pack();
    return this;
  }

  private walls() {
    const { size, origin } = this;
    const dirs: [number, number][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
    for (const [axis, sign] of dirs) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      for (let s = 0; s < size[axis]; s++) {
        const mask: string[] = new Array(size[u] * size[v]).fill("");
        for (let j = 0; j < size[v]; j++)
          for (let i = 0; i < size[u]; i++) {
            const c = [0, 0, 0];
            c[axis] = s; c[u] = i; c[v] = j;
            const here = this.at(c[0], c[1], c[2]);
            if (here <= 0) continue;
            c[axis] += sign;
            if (this.at(c[0], c[1], c[2]) > 0) continue;
            c[axis] -= sign;
            const style = this.rooms[here - 1].style;
            let tex = style.wall;
            if (axis === 1) tex = sign < 0 ? style.floor : style.ceil;
            else if (style.base && this.at(c[0], c[1] - 1, c[2]) <= 0) tex = style.base;
            else if (style.top && this.at(c[0], c[1] + 1, c[2]) <= 0) tex = style.top;
            mask[i + j * size[u]] = tex;
          }
        for (let j = 0; j < size[v]; j++)
          for (let i = 0; i < size[u]; i++) {
            const tex = mask[i + j * size[u]];
            if (!tex) continue;
            let w = 1;
            while (w < 14 && i + w < size[u] && mask[i + w + j * size[u]] === tex) w++;
            let h = 1;
            grow: while (h < 14 && j + h < size[v]) {
              for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * size[u]] !== tex) break grow;
              h++;
            }
            for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) mask[i + a + (j + b) * size[u]] = "";
            const n: V3 = [0, 0, 0];
            n[axis] = -sign;
            const put = (a: number, b: number): V3 => {
              const p: V3 = [0, 0, 0];
              p[axis] = origin[axis] + s + (sign > 0 ? 1 : 0); p[u] = origin[u] + a; p[v] = origin[v] + b;
              return p;
            };
            this.pushFace([put(i, j), put(i + w, j), put(i + w, j + h), put(i, j + h)], n, tex);
          }
      }
    }
  }

  /** Plinths at the foot of walls and cornices under the ceiling. */
  private trims() {
    const [sx, sy, sz] = this.size;
    const o = this.origin;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const along = dx ? 2 : 0;
      for (let y = 0; y < sy; y++)
        for (let c = 0; c < (dx ? sx : sz); c++) {
          for (const top of [false, true]) {
            const ok = (a: number) => {
              const x = dx ? c : a;
              const z = dx ? a : c;
              const here = this.at(x, y, z);
              if (here <= 0 || this.at(x + dx, y, z + dz) > 0 || this.at(x, y + (top ? 1 : -1), z) > 0) return 0;
              // Low ledges get no trim: the wall goes on at least one metre.
              if (this.at(x + dx, y + (top ? -1 : 1), z + dz) > 0 || this.at(x, y + (top ? -1 : 1), z) <= 0) return 0;
              const style = this.rooms[here - 1].style;
              return (top ? style.cornice : style.plinth) === undefined ? 0 : here;
            };
            const end = dx ? sz : sx;
            for (let a = 0; a < end; a++) {
              const here = ok(a);
              if (!here) continue;
              const style = this.rooms[here - 1].style;
              const band = (top ? style.cornice : style.plinth)!;
              let b = a;
              while (b + 1 < end && ok(b + 1) && (top ? this.rooms[ok(b + 1) - 1].style.cornice : this.rooms[ok(b + 1) - 1].style.plinth) === band) b++;
              const d = top ? 0.22 : 0.14;
              const open = (q: number) => (dx ? this.at(c, y, q) > 0 && this.at(c + dx, y, q) > 0 : this.at(q, y, c) > 0 && this.at(q, y, c + dz) > 0);
              const s = o[along] + a - (a > 0 && open(a - 1) ? d : 0);
              const e = o[along] + b + 1 + (open(b + 1) ? d : 0);
              const y0 = o[1] + y + (top ? 0.55 : 0);
              const y1 = y0 + (top ? 0.45 : 0.5);
              const face = (dx ? o[0] : o[2]) + c + (dx + dz > 0 ? 1 : 0);
              const inn = face - (dx + dz) * d;
              if (dx) this.box(Math.min(face, inn), y0, s, Math.max(face, inn), y1, e, "trim", "trim", { collide: false, band });
              else this.box(s, y0, Math.min(face, inn), e, y1, Math.max(face, inn), "trim", "trim", { collide: false, band });
              a = b;
            }
          }
        }
    }
  }

  /** Solid ground as few boxes as a greedy merge gives. */
  private solids() {
    const [sx, sy, sz] = this.size;
    const done = new Uint8Array(sx * sy * sz);
    const id = (x: number, y: number, z: number) => x + sx * (y + sy * z);
    const free = (x: number, y: number, z: number) => this.cells[id(x, y, z)] <= 0 && !done[id(x, y, z)];
    for (let z = 0; z < sz; z++)
      for (let y = 0; y < sy; y++)
        for (let x = 0; x < sx; x++) {
          if (!free(x, y, z)) continue;
          let w = 1;
          while (x + w < sx && free(x + w, y, z)) w++;
          let d = 1;
          grow: while (z + d < sz) {
            for (let i = 0; i < w; i++) if (!free(x + i, y, z + d)) break grow;
            d++;
          }
          let h = 1;
          rise: while (y + h < sy) {
            for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (!free(x + i, y + h, z + j)) break rise;
            h++;
          }
          for (let k = 0; k < h; k++) for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) done[id(x + i, y + k, z + j)] = 1;
          const o = this.origin;
          this.brushes.push(boxBrush([o[0] + x, o[1] + y, o[2] + z], [o[0] + x + w, o[1] + y + h, o[2] + z + d]));
        }
  }

  airAt(p: V3) {
    return this.at(Math.floor(p[0] - this.origin[0]), Math.floor(p[1] - this.origin[1]), Math.floor(p[2] - this.origin[2])) > 0;
  }
  bounds(): [V3, V3] {
    return [this.origin, add(this.origin, this.size)];
  }

  /** Drops faces nobody can see: pressed against ground or inside another solid. */
  private hideBuried() {
    this.faces = this.faces.filter((f) => {
      const c: V3 = [0, 0, 0];
      for (const p of f.poly) for (let a = 0; a < 3; a++) c[a] += p[a] / f.poly.length;
      const seen = (p: V3) => {
        const q: V3 = [p[0] + f.n[0] * 0.02, p[1] + f.n[1] * 0.02, p[2] + f.n[2] * 0.02];
        if (!this.airAt(q)) return false;
        return !this.detail.some((d) => q[0] > d.lo[0] && q[0] < d.hi[0] && q[1] > d.lo[1] && q[1] < d.hi[1] && q[2] > d.lo[2] && q[2] < d.hi[2]);
      };
      if (seen(c)) return true;
      const corners = f.poly.map((p): V3 => [p[0] + (c[0] - p[0]) * 0.04, p[1] + (c[1] - p[1]) * 0.04, p[2] + (c[2] - p[2]) * 0.04]);
      return corners.some(seen) || f.poly.some((p, i) => seen([(p[0] + c[0]) / 2, (p[1] + c[1]) / 2, (p[2] + c[2]) / 2]) && i >= 0);
    });
  }

  private pack() {
    const list = this.faces.filter((f) => !f.liquid).sort((a, b) => b.h - a.h || b.w - a.w);
    const area = list.reduce((s, f) => s + (f.w + 1) * (f.h + 1), 0);
    const w = area > 420000 ? 1024 : 512;
    let x = 2;
    let y = 0;
    let shelf = 0;
    for (const f of list) {
      if (f.w > w) throw new Error(`face of ${f.w} texels`);
      if (x + f.w + 1 > w) ((x = 0), (y += shelf), (shelf = 0));
      f.x = x;
      f.y = y;
      x += f.w + 1;
      shelf = Math.max(shelf, f.h + 1);
    }
    this.atlas = { w, h: Math.ceil((y + shelf) / 64) * 64 };
  }
}

/** Rotation rows then translation: 12 numbers, the first three rows are the world axes of local x, y, z. */
export function propMatrix(p: Prop): number[] {
  const [sy, cy, sp, cp, sr, cr] = [Math.sin(p.yaw), Math.cos(p.yaw), Math.sin(p.pitch), Math.cos(p.pitch), Math.sin(p.roll), Math.cos(p.roll)];
  // Roll about z, then pitch about x, then yaw about y (clockwise from above, as yaw 0 looks along +z).
  const x: V3 = [cr * cy + sr * sp * sy, sr * cp, -cr * sy + sr * sp * cy];
  const y: V3 = [-sr * cy + cr * sp * sy, cr * cp, sr * sy + cr * sp * cy];
  const z: V3 = [cp * sy, -sp, cp * cy];
  const s = p.scale;
  return [...x.map((v) => v * s[0]), ...y.map((v) => v * s[1]), ...z.map((v) => v * s[2]), ...p.pos];
}
export function apply(m: number[], p: V3): V3 {
  return [m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + m[9], m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + m[10], m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + m[11]];
}
export function turn(m: number[], n: V3, inverseScale?: V3): V3 {
  const s = inverseScale ?? [1, 1, 1];
  return norm([m[0] * n[0] / (s[0] * s[0]) + m[3] * n[1] / (s[1] * s[1]) + m[6] * n[2] / (s[2] * s[2]), m[1] * n[0] / (s[0] * s[0]) + m[4] * n[1] / (s[1] * s[1]) + m[7] * n[2] / (s[2] * s[2]), m[2] * n[0] / (s[0] * s[0]) + m[5] * n[1] / (s[1] * s[1]) + m[8] * n[2] / (s[2] * s[2])]);
}

/** Still kit pieces: where each one's vertices start in the level's vertex light. */
export function numberProps(level: LevelBuilder, kit: Map<string, Model>) {
  let first = 0;
  for (const p of level.props) {
    if (p.spin || p.swing) continue;
    const m = kit.get(p.model);
    if (!m) throw new Error(`no kit piece ${p.model}`);
    p.first = first;
    first += m.count;
  }
  return first;
}
