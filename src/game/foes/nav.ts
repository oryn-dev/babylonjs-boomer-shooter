import type { LevelBuilder } from "../level/build";
import type { Collision } from "../level/trace";
import type { V3 } from "../level/vec";

const R = 0.42;
const H = 1.7;
const CLIMB = 0.75;
const DROP = 7;

/** Walkable floors on a 1 m grid with their links, and the way to the player as one flow field. */
export class Nav {
  /** Node positions: x, y, z. */
  at: V3[] = [];
  private columns = new Map<number, number[]>();
  private into: number[][] = [];
  private links: number[][] = [];
  private dist = new Float32Array(0);
  private next = new Int32Array(0);
  private goal = -1;
  /** Nodes inside shut locked doors. */
  closed: (node: number) => boolean = () => false;

  constructor(level: LevelBuilder, private world: Collision) {
    const [lo, hi] = level.bounds();
    const w = world;
    const fits = (x: number, y: number, z: number) => !w.trace([x, y + H / 2, z], [x, y + H / 2, z], R, H / 2 - 0.02, R).startSolid;
    for (let x = Math.floor(lo[0]); x < hi[0]; x++)
      for (let z = Math.floor(lo[2]); z < hi[2]; z++) {
        const cx = x + 0.5;
        const cz = z + 0.5;
        let y = hi[1] + 1;
        while (y > lo[1]) {
          // Down through solid ground to the next free space, then to its floor.
          let guard = 0;
          while (y > lo[1] && !fits(cx, y, cz) && guard++ < 400) y -= 0.25;
          if (y <= lo[1]) break;
          if (!level.airAt([cx, y + 0.3, cz])) { y -= 0.5; continue; }
          const t = w.trace([cx, y + H / 2, cz], [cx, lo[1] - 2, cz], R, H / 2 - 0.02, R);
          const floor = t.end[1] - H / 2 + 0.02;
          if (t.fraction < 1 && t.normal[1] > 0.65 && !level.liquids.some((l) => l.kind === "molten" && cx > l.lo[0] && cx < l.hi[0] && cz > l.lo[2] && cz < l.hi[2] && floor < l.hi[1] - 0.05 && floor > l.lo[1] - 4)) this.add(x, z, [cx, floor, cz]);
          y = floor - 0.5;
        }
      }
    this.links = this.at.map(() => []);
    this.into = this.at.map(() => []);
    const link = (a: number, b: number) => {
      const p = this.at[a];
      const q = this.at[b];
      const top = Math.max(p[1], q[1]);
      const lift = top + 0.12;
      const go = w.trace([p[0], lift + H / 2, p[2]], [q[0], lift + H / 2, q[2]], R - 0.04, H / 2 - 0.1, R - 0.04);
      return !go.startSolid && go.fraction >= 1;
    };
    for (let a = 0; a < this.at.length; a++) {
      const p = this.at[a];
      const x = Math.floor(p[0]);
      const z = Math.floor(p[2]);
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])
        for (const b of this.columns.get(key(x + dx, z + dz)) ?? []) {
          const dy = this.at[b][1] - p[1];
          if (dy > CLIMB * (dx && dz ? 1.2 : 1) || dy < -DROP || (dy < -1.2 && dx && dz)) continue;
          if (!link(a, b)) continue;
          this.links[a].push(b);
          this.into[b].push(a);
        }
    }
    this.dist = new Float32Array(this.at.length).fill(1e9);
    this.next = new Int32Array(this.at.length).fill(-1);
  }
  private add(x: number, z: number, p: V3) {
    const k = key(x, z);
    const list = this.columns.get(k);
    if (list) list.push(this.at.length);
    else this.columns.set(k, [this.at.length]);
    this.at.push(p);
  }

  /** Node under a point, or the nearest around it. */
  node(p: V3, reach = 2, up = 1.1): number {
    let best = -1;
    let score = 1e9;
    const x = Math.floor(p[0]);
    const z = Math.floor(p[2]);
    for (let r = 0; r <= reach && best < 0; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const n of this.columns.get(key(x + dx, z + dz)) ?? []) {
            const q = this.at[n];
            const dy = p[1] - q[1];
            if (dy < -up) continue;
            const s = Math.abs(dy) * 1.5 + Math.hypot(q[0] - p[0], q[2] - p[2]);
            if (s < score) ((score = s), (best = n));
          }
        }
    return best;
  }

  /** Fills the field of ways to a point. */
  update(p: V3) {
    const goal = this.node(p, 3);
    if (goal < 0) return;
    this.goal = goal;
    const { dist, next, into, at } = this;
    dist.fill(1e9);
    next.fill(-1);
    dist[goal] = 0;
    // Buckets of half a metre: fast and near enough to true distance.
    const buckets: number[][] = [[goal]];
    for (let b = 0; b < buckets.length && b < 600; b++) {
      const list = buckets[b];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (Math.floor(dist[n] * 2) < b) continue;
        const q = at[n];
        for (const m of into[n]) {
          const o = at[m];
          const d = dist[n] + Math.hypot(q[0] - o[0], q[2] - o[2]) + Math.max(0, o[1] - q[1] - 1) * 0.5;
          if (d >= dist[m] - 1e-4 || this.closed(m)) continue;
          dist[m] = d;
          next[m] = n;
          (buckets[Math.floor(d * 2)] ??= []).push(m);
        }
      }
    }
  }

  distance(p: V3) {
    const n = this.node(p);
    return n < 0 ? 1e9 : this.dist[n];
  }
  /** Where to walk next from a point; looks a few nodes ahead while the way is straight. */
  step(p: V3): V3 | null {
    let n = this.node(p);
    if (n < 0 || this.dist[n] > 1e8) return null;
    if (n === this.goal) return this.at[n];
    let target = this.next[n];
    if (target < 0) return null;
    const first = this.at[target];
    for (let i = 0; i < 3; i++) {
      const m = this.next[target];
      if (m < 0 || Math.abs(this.at[m][1] - p[1]) > 0.4) break;
      const a = p;
      const b = this.at[m];
      const y = Math.max(a[1], b[1]) + 0.35 + H / 2;
      const t = this.world.trace([a[0], y, a[2]], [b[0], y, b[2]], R, H / 2 - 0.1, R);
      if (t.startSolid || t.fraction < 1 || !this.floored(a, b)) break;
      target = m;
    }
    n = target;
    return this.at[n] ?? first;
  }
  private floored(a: V3, b: V3) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const p: V3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      const m = this.node(p, 0);
      if (m < 0 || Math.abs(this.at[m][1] - p[1]) > 0.9) return false;
    }
    return true;
  }
  /** A walkable place some way off, for dodging and for arena spawns. */
  near(p: V3, lo: number, hi: number, tries = 24): V3 | null {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * 6.283;
      const r = lo + Math.random() * (hi - lo);
      const n = this.node([p[0] + Math.cos(a) * r, p[1] + 0.5, p[2] + Math.sin(a) * r], 1);
      if (n >= 0 && this.dist[n] < 1e8) return this.at[n];
    }
    return null;
  }
  /** Path from one point to another, for the level tests; links may be filtered. */
  path(from: V3, to: V3): V3[] | null {
    this.update(to);
    let n = this.node(from, 3);
    if (n < 0 || this.dist[n] > 1e8) return null;
    const out: V3[] = [this.at[n]];
    while (n !== this.goal && this.next[n] >= 0 && out.length < 3000) ((n = this.next[n]), out.push(this.at[n]));
    return out;
  }
}
const key = (x: number, z: number) => (x + 2048) * 8192 + z + 2048;
