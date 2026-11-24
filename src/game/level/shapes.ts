import { layerOf, TILE } from "./build";
import type { Model } from "./kit";
import type { V3 } from "./vec";

export interface Slab { lo: V3; hi: V3; tex: string; color?: V3; glow?: number }

/** A model from boxes, for doors, lifts and whatever a level builds that moves. */
export function slabModel(name: string, slabs: Slab[]): Model {
  const pos: number[] = [], nor: number[] = [], tan: number[] = [], uv: number[] = [], layer: number[] = [], glow: number[] = [], color: number[] = [], index: number[] = [];
  for (const s of slabs) {
    for (let a = 0; a < 3; a++)
      for (const side of [-1, 1]) {
        const n: V3 = [0, 0, 0];
        n[a] = side;
        const u = a === 0 ? 2 : 0;
        const v = a === 1 ? 2 : 1;
        const base = pos.length / 3;
        for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const p: V3 = [0, 0, 0];
          p[a] = side > 0 ? s.hi[a] : s.lo[a];
          p[u] = i ? s.hi[u] : s.lo[u];
          p[v] = j ? s.hi[v] : s.lo[v];
          pos.push(...p); nor.push(...n);
          const t: V3 = [0, 0, 0];
          t[u] = 1;
          tan.push(...t);
          uv.push((p[u] - s.lo[u]) / TILE, -(p[v] - s.lo[v]) / TILE);
          layer.push(layerOf(s.tex)); glow.push(s.glow ?? 0); color.push(...(s.color ?? [1, 1, 1]));
        }
        // Winding as in the files: counter-clockwise from outside, turned by the actor.
        const e1: V3 = [0, 0, 0], e2: V3 = [0, 0, 0];
        for (let k = 0; k < 3; k++) ((e1[k] = pos[(base + 1) * 3 + k] - pos[base * 3 + k]), (e2[k] = pos[(base + 2) * 3 + k] - pos[base * 3 + k]));
        const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] > 0) index.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else index.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
  }
  const count = layer.length;
  const lo: V3 = [1e9, 1e9, 1e9];
  const hi: V3 = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i++) ((lo[i % 3] = Math.min(lo[i % 3], pos[i])), (hi[i % 3] = Math.max(hi[i % 3], pos[i])));
  return { name, count, pos: new Float32Array(pos), nor: new Float32Array(nor), tan: new Float32Array(tan), uv: new Float32Array(uv), layer: new Float32Array(layer), part: new Float32Array(count), glow: new Float32Array(glow), color: new Float32Array(color), index: new Uint32Array(index), parts: [{ name: "root", pivot: [0, 0, 0], parent: -1 }], lo, hi };
}
