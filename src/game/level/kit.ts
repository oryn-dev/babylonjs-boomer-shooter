/** Reads the models written by art/modlib.py. */
export interface Part {
  name: string;
  pivot: [number, number, number];
  parent: number;
}
export interface Model {
  name: string;
  count: number;
  pos: Float32Array;
  nor: Float32Array;
  tan: Float32Array;
  uv: Float32Array;
  layer: Float32Array;
  part: Float32Array;
  glow: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  parts: Part[];
  lo: [number, number, number];
  hi: [number, number, number];
}
interface Head {
  vertices: number;
  models: Record<string, { v: [number, number]; i: [number, number]; parts: Part[]; lo: [number, number, number]; hi: [number, number, number] }>;
}
const STRIDE = 28;

export function parseModels(head: Head, blob: ArrayBuffer): Map<string, Model> {
  const view = new DataView(blob);
  const indexAt = head.vertices * STRIDE;
  const out = new Map<string, Model>();
  for (const [name, m] of Object.entries(head.models)) {
    const [start, count] = m.v;
    const model: Model = {
      name, count, parts: m.parts, lo: m.lo, hi: m.hi,
      pos: new Float32Array(count * 3), nor: new Float32Array(count * 3), tan: new Float32Array(count * 3), uv: new Float32Array(count * 2),
      layer: new Float32Array(count), part: new Float32Array(count), glow: new Float32Array(count), color: new Float32Array(count * 3),
      index: new Uint32Array(m.i[1]),
    };
    for (let i = 0; i < count; i++) {
      const o = (start + i) * STRIDE;
      for (let a = 0; a < 3; a++) {
        model.pos[i * 3 + a] = view.getInt16(o + a * 2, true) / 1000;
        model.nor[i * 3 + a] = view.getInt8(o + 8 + a) / 127;
        model.tan[i * 3 + a] = view.getInt8(o + 12 + a) / 127;
        model.color[i * 3 + a] = view.getUint8(o + 24 + a) / 255;
      }
      model.uv[i * 2] = view.getInt16(o + 16, true) / 2048;
      model.uv[i * 2 + 1] = view.getInt16(o + 18, true) / 2048;
      model.layer[i] = view.getUint8(o + 20);
      model.part[i] = view.getUint8(o + 21);
      model.glow[i] = view.getUint8(o + 22) / 255;
    }
    for (let i = 0; i < m.i[1]; i++) model.index[i] = view.getUint32(indexAt + (m.i[0] + i) * 4, true);
    out.set(name, model);
  }
  return out;
}
