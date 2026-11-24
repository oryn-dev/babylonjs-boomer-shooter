import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { worldMaterial } from "../gfx/materials";
import { loadData, plainTexture, type Surfaces } from "../gfx/textures";
import { apply, LM_DENSITY, LevelBuilder, numberProps, propMatrix, turn } from "./build";
import type { Model } from "./kit";
import { type V3, cross, dot, norm, sub } from "./vec";

const CHUNK = 18;
const decode = (v: number) => (v / 255) * (v / 255) * 8;

class Chunk {
  pos: number[] = []; nor: number[] = []; tan: number[] = []; uv: number[] = []; layer: number[] = []; lm: number[] = []; baked: number[] = []; dir: number[] = []; index: number[] = [];
  mesh(name: string, scene: Scene, material: ShaderMaterial) {
    const mesh = new Mesh(name, scene);
    mesh.setVerticesData(VertexBuffer.PositionKind, new Float32Array(this.pos), false, 3);
    mesh.setVerticesData(VertexBuffer.NormalKind, new Float32Array(this.nor), false, 3);
    mesh.setVerticesData("tangent3", new Float32Array(this.tan), false, 3);
    mesh.setVerticesData(VertexBuffer.UVKind, new Float32Array(this.uv), false, 2);
    mesh.setVerticesData("layer", new Float32Array(this.layer), false, 1);
    mesh.setVerticesData("lm", new Float32Array(this.lm), false, 2);
    mesh.setVerticesData("baked", new Float32Array(this.baked), false, 4);
    mesh.setVerticesData("bakedDir", new Float32Array(this.dir), false, 3);
    mesh.setIndices(new Uint32Array(this.index));
    mesh.material = material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    return mesh;
  }
}

/** Light for things that move, from the baked grid. */
export class LightGrid {
  constructor(private info: { o: V3; s: number; n: V3 } | null, private data: Uint8Array, private ambient: V3) {}
  sample(p: V3, out: { amb: V3; key: V3; dir: V3 }) {
    const g = this.info;
    out.amb = [0, 0, 0]; out.key = [0, 0, 0]; out.dir = [0, 0.01, 0];
    if (!g) {
      out.amb = [0.35, 0.33, 0.33]; out.key = [0.5, 0.42, 0.34]; out.dir = [0.3, 0.85, 0.4];
      return out;
    }
    const f = [0, 1, 2].map((a) => (p[a] - g.o[a]) / g.s);
    let total = 0;
    for (let c = 0; c < 8; c++) {
      let w = 1;
      const at = [0, 0, 0];
      for (let a = 0; a < 3; a++) {
        const i = Math.floor(f[a]);
        const k = f[a] - i;
        const up = (c >> a) & 1;
        w *= up ? k : 1 - k;
        at[a] = i + up;
        if (at[a] < 0 || at[a] >= g.n[a]) w = 0;
      }
      if (w <= 0) continue;
      const o = (at[0] + g.n[0] * (at[1] + g.n[1] * at[2])) * 9;
      const d = this.data;
      if (!d[o] && !d[o + 1] && !d[o + 2] && !d[o + 3]) continue;
      total += w;
      for (let a = 0; a < 3; a++) {
        out.amb[a] += decode(d[o + a]) * w;
        out.key[a] += decode(d[o + 3 + a]) * w;
        out.dir[a] += ((d[o + 6 + a] - 128) / 127) * w;
      }
    }
    const k = total > 0.001 ? 1 / total : 0;
    for (let a = 0; a < 3; a++) ((out.amb[a] = out.amb[a] * k + this.ambient[a]), (out.key[a] *= k));
    out.dir = norm(out.dir);
    return out;
  }
}

export class World {
  meshes: Mesh[] = [];
  material!: ShaderMaterial;
  grid!: LightGrid;
  private maps: BaseTexture[] = [];

  constructor(readonly level: LevelBuilder, private scene: Scene) {}

  async load(id: string, kit: Map<string, Model>, surfaces: Surfaces, url: (path: string) => string) {
    const { level, scene } = this;
    const vertices = numberProps(level, kit);
    let raw: Uint8Array | null = null;
    let head: { vertices: number; faces: number; grid: { o: V3; s: number; n: V3 } } | null = null;
    try {
      const res = await fetch(url(`levels/${id}.bin`));
      if (res.ok && !(res.headers.get("content-type") ?? "").includes("html")) {
        const all = new Uint8Array(await res.arrayBuffer());
        head = JSON.parse(new TextDecoder().decode(all.subarray(0, 512)));
        raw = all.subarray(512);
      }
    } catch {
      // Unbaked levels show in flat light.
    }
    const fits = Boolean(head && head.vertices === vertices && head.faces === level.faces.length);
    if (!fits) console.warn(`level ${id} has no matching light, run tools/bake.mjs`);
    const [lm, dm] = fits ? await Promise.all([loadData(scene, url(`levels/${id}.png`)), loadData(scene, url(`levels/${id}-dir.png`))]) : [plainTexture(scene, [80, 78, 80, 255]), plainTexture(scene, [150, 220, 160, 255])];
    this.maps = [lm, dm];
    this.material = worldMaterial(scene, surfaces, lm, dm, level.atlas, LM_DENSITY);
    this.grid = new LightGrid(fits ? head!.grid : null, fits ? raw!.subarray(vertices * 6) : new Uint8Array(0), [0.015, 0.014, 0.016]);

    const chunks = new Map<string, Chunk>();
    const chunkAt = (x: number, z: number) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let c = chunks.get(key);
      if (!c) chunks.set(key, (c = new Chunk()));
      return c;
    };
    for (const f of level.faces) {
      const c = chunkAt(f.poly.reduce((s, p) => s + p[0], 0) / f.poly.length, f.poly.reduce((s, p) => s + p[2], 0) / f.poly.length);
      const base = c.pos.length / 3;
      f.poly.forEach((p, i) => {
        c.pos.push(...p); c.nor.push(...f.n); c.tan.push(...f.t); c.uv.push(...f.uv[i]); c.layer.push(f.layer);
        if (f.liquid) c.lm.push(0, 0);
        else c.lm.push(f.x + 0.5 + (dot(p, f.t) - f.minT) * LM_DENSITY, f.y + 0.5 + (dot(p, f.b) - f.minB) * LM_DENSITY);
        c.baked.push(0.02, 0.01, 0.01, f.liquid ? 1 : 0); c.dir.push(0, 0, 0);
      });
      const g = cross(sub(f.poly[1], f.poly[0]), sub(f.poly[2], f.poly[0]));
      const out = dot(g, f.n) > 0;
      for (let i = 1; i < f.poly.length - 1; i++) c.index.push(base, base + (out ? i + 1 : i), base + (out ? i : i + 1));
    }
    for (const p of level.props) {
      if (p.first < 0) continue;
      const m = kit.get(p.model)!;
      const mat = propMatrix(p);
      const c = chunkAt(p.pos[0], p.pos[2]);
      const base = c.pos.length / 3;
      for (let i = 0; i < m.count; i++) {
        c.pos.push(...apply(mat, [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]));
        c.nor.push(...turn(mat, [m.nor[i * 3], m.nor[i * 3 + 1], m.nor[i * 3 + 2]], p.scale));
        c.tan.push(...turn(mat, [m.tan[i * 3], m.tan[i * 3 + 1], m.tan[i * 3 + 2]]));
        c.uv.push(m.uv[i * 2], m.uv[i * 2 + 1]); c.layer.push(m.layer[i]); c.lm.push(0, 0);
        if (fits) {
          const o = (p.first + i) * 6;
          c.baked.push(decode(raw![o]), decode(raw![o + 1]), decode(raw![o + 2]), 1);
          c.dir.push((raw![o + 3] / 255) * 2 - 1, (raw![o + 4] / 255) * 2 - 1, (raw![o + 5] / 255) * 2 - 1);
        } else {
          c.baked.push(0.5, 0.48, 0.5, 1); c.dir.push(0.2, 0.6, 0.3);
        }
      }
      for (let i = 0; i < m.index.length; i += 3) c.index.push(base + m.index[i], base + m.index[i + 2], base + m.index[i + 1]);
    }
    for (const [key, c] of chunks) this.meshes.push(c.mesh(`world ${key}`, scene, this.material));
  }

  dispose() {
    this.meshes.forEach((m) => m.dispose());
    this.material?.dispose();
    this.maps.forEach((t) => t.dispose());
  }
}
