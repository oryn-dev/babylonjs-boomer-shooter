import { type V3, cross, dot, norm, sub } from "./vec";

/** A convex solid: planes point outwards, points with dot(n, p) - d < 0 for all are inside. */
export interface Brush {
  planes: Float64Array;
  lo: V3;
  hi: V3;
  /** Moves as one piece with a door or lift. */
  offset?: V3;
  owner?: unknown;
  enabled: boolean;
  /** Stops bodies, not shots. */
  clip?: boolean;
  mark: number;
}

export interface Trace {
  fraction: number;
  end: V3;
  normal: V3;
  startSolid: boolean;
  brush: Brush | null;
}

const EPS = 0.004;
const CELL = 4;

export function boxBrush(lo: V3, hi: V3): Brush {
  return { planes: new Float64Array([1, 0, 0, hi[0], -1, 0, 0, -lo[0], 0, 1, 0, hi[1], 0, -1, 0, -lo[1], 0, 0, 1, hi[2], 0, 0, -1, -lo[2]]), lo: [...lo], hi: [...hi], enabled: true, mark: 0 };
}

/** Outward normal of a polygon on a convex solid with centre `c`. */
export function faceNormal(poly: V3[], c: V3): V3 {
  let n: V3 = [0, 0, 0];
  for (let i = 0; i < poly.length; i++) {
    const k = cross(sub(poly[i], poly[0]), sub(poly[(i + 1) % poly.length], poly[0]));
    n = [n[0] + k[0], n[1] + k[1], n[2] + k[2]];
  }
  n = norm(n);
  return dot(n, sub(poly[0], c)) < 0 ? [-n[0], -n[1], -n[2]] : n;
}

export function centroid(polys: V3[][]): V3 {
  let count = 0;
  const c: V3 = [0, 0, 0];
  for (const p of polys) for (const v of p) (count++, (c[0] += v[0]), (c[1] += v[1]), (c[2] += v[2]));
  return [c[0] / count, c[1] / count, c[2] / count];
}

export function convexBrush(polys: V3[][]): Brush {
  const c = centroid(polys);
  const lo: V3 = [1e9, 1e9, 1e9];
  const hi: V3 = [-1e9, -1e9, -1e9];
  for (const p of polys) for (const v of p) for (let a = 0; a < 3; a++) ((lo[a] = Math.min(lo[a], v[a])), (hi[a] = Math.max(hi[a], v[a])));
  const planes: number[] = [];
  for (const p of polys) {
    const n = faceNormal(p, c);
    planes.push(n[0], n[1], n[2], dot(n, p[0]));
  }
  // Axis planes keep swept boxes from catching on sharp edges.
  for (let a = 0; a < 3; a++) {
    const n = [0, 0, 0];
    n[a] = 1;
    planes.push(n[0], n[1], n[2], hi[a], -n[0], -n[1], -n[2], -lo[a]);
  }
  return { planes: new Float64Array(planes), lo, hi, enabled: true, mark: 0 };
}

export class Collision {
  brushes: Brush[] = [];
  movers: Brush[] = [];
  private cells = new Map<number, Brush[]>();
  private stamp = 1;

  add(brush: Brush) {
    this.brushes.push(brush);
    for (let x = Math.floor(brush.lo[0] / CELL); x <= Math.floor(brush.hi[0] / CELL); x++)
      for (let z = Math.floor(brush.lo[2] / CELL); z <= Math.floor(brush.hi[2] / CELL); z++) {
        const key = (x + 512) * 1024 + z + 512;
        const list = this.cells.get(key);
        if (list) list.push(brush);
        else this.cells.set(key, [brush]);
      }
  }

  addMover(brush: Brush) {
    brush.offset ??= [0, 0, 0];
    this.movers.push(brush);
  }

  /** Sweeps a box of half size `h`; a zero size is a ray. Shots pass clip brushes. */
  trace(a: V3, b: V3, hx = 0, hy = 0, hz = 0, shot = false): Trace {
    const out: Trace = { fraction: 1, end: [b[0], b[1], b[2]], normal: [0, 0, 0], startSolid: false, brush: null };
    const mark = ++this.stamp;
    const loX = Math.min(a[0], b[0]) - hx - 0.1;
    const hiX = Math.max(a[0], b[0]) + hx + 0.1;
    const loY = Math.min(a[1], b[1]) - hy - 0.1;
    const hiY = Math.max(a[1], b[1]) + hy + 0.1;
    const loZ = Math.min(a[2], b[2]) - hz - 0.1;
    const hiZ = Math.max(a[2], b[2]) + hz + 0.1;
    const test = (brush: Brush) => {
      if (!brush.enabled || (shot && brush.clip)) return;
      const ox = brush.offset ? brush.offset[0] : 0;
      const oy = brush.offset ? brush.offset[1] : 0;
      const oz = brush.offset ? brush.offset[2] : 0;
      if (brush.lo[0] + ox > hiX || brush.hi[0] + ox < loX || brush.lo[1] + oy > hiY || brush.hi[1] + oy < loY || brush.lo[2] + oz > hiZ || brush.hi[2] + oz < loZ) return;
      const p = brush.planes;
      let enter = -1;
      let leave = 1;
      let hit = -1;
      let startOut = false;
      for (let i = 0; i < p.length; i += 4) {
        const nx = p[i];
        const ny = p[i + 1];
        const nz = p[i + 2];
        const d = p[i + 3] + nx * ox + ny * oy + nz * oz + Math.abs(nx) * hx + Math.abs(ny) * hy + Math.abs(nz) * hz;
        const d1 = nx * a[0] + ny * a[1] + nz * a[2] - d;
        const d2 = nx * b[0] + ny * b[1] + nz * b[2] - d;
        if (d1 > 0) startOut = true;
        if (d1 > 0 && (d2 >= EPS || d2 >= d1)) return;
        if (d1 <= 0 && d2 <= 0) continue;
        if (d1 > d2) {
          const f = Math.max(0, (d1 - EPS) / (d1 - d2));
          if (f > enter) ((enter = f), (hit = i));
        } else leave = Math.min(leave, (d1 + EPS) / (d1 - d2));
      }
      if (!startOut) {
        out.startSolid = true;
        if (!out.brush) out.brush = brush;
        return;
      }
      if (hit >= 0 && enter < leave && enter < out.fraction) {
        out.fraction = enter;
        out.normal = [p[hit], p[hit + 1], p[hit + 2]];
        out.brush = brush;
      }
    };
    const x1 = Math.floor(hiX / CELL);
    const z1 = Math.floor(hiZ / CELL);
    for (let x = Math.floor(loX / CELL); x <= x1; x++)
      for (let z = Math.floor(loZ / CELL); z <= z1; z++) {
        const list = this.cells.get((x + 512) * 1024 + z + 512);
        if (!list) continue;
        for (const brush of list) {
          if (brush.mark === mark) continue;
          brush.mark = mark;
          test(brush);
        }
      }
    for (const brush of this.movers) test(brush);
    if (out.fraction < 1) for (let i = 0; i < 3; i++) out.end[i] = a[i] + (b[i] - a[i]) * out.fraction;
    return out;
  }

  /** True when nothing solid lies between two points. */
  clear(a: V3, b: V3) {
    return this.trace(a, b, 0, 0, 0, true).fraction >= 0.999;
  }

  solidAt(p: V3, h = 0) {
    return this.trace(p, p, h, h, h).startSolid;
  }
}
