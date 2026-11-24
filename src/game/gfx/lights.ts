import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { V3 } from "../level/vec";

export const MAX_LIGHTS = 8;
interface Live { pos: V3; color: V3; range: number; life: number; total: number }

/** The few moving lights: the nearest and strongest of each frame reach the shaders. */
export class DynamicLights {
  readonly positions = new Array<number>(MAX_LIGHTS * 4).fill(0);
  readonly colors = new Array<number>(MAX_LIGHTS * 4).fill(0);
  private flashes: Live[] = [];
  private frame: { pos: V3; color: V3; range: number }[] = [];

  /** A light that fades out by itself. */
  flash(pos: V3, color: V3, range: number, seconds: number) {
    if (this.flashes.length > 40) this.flashes.shift();
    this.flashes.push({ pos: [...pos], color, range, life: seconds, total: seconds });
  }
  /** A light for this frame only. */
  put(pos: V3, color: V3, range: number) {
    this.frame.push({ pos, color, range });
  }
  clear() {
    this.flashes.length = 0;
    this.frame.length = 0;
  }

  update(dt: number, eye: V3) {
    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    const all = [...this.frame, ...this.flashes.map((f) => {
      const k = f.life / f.total;
      return { pos: f.pos, color: [f.color[0] * k, f.color[1] * k, f.color[2] * k] as V3, range: f.range };
    })];
    this.frame.length = 0;
    const score = (l: { pos: V3; color: V3; range: number }) => ((l.color[0] + l.color[1] + l.color[2]) * l.range) / (4 + Math.hypot(l.pos[0] - eye[0], l.pos[1] - eye[1], l.pos[2] - eye[2]));
    all.sort((a, b) => score(b) - score(a));
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = all[i];
      const o = i * 4;
      this.positions[o] = l?.pos[0] ?? 0;
      this.positions[o + 1] = l?.pos[1] ?? -999;
      this.positions[o + 2] = l?.pos[2] ?? 0;
      this.positions[o + 3] = l?.range ?? 0.001;
      for (let a = 0; a < 3; a++) this.colors[o + a] = l?.color[a] ?? 0;
    }
  }

  apply(material: ShaderMaterial) {
    material.setArray4("u_lightPos", this.positions);
    material.setArray4("u_lightColor", this.colors);
  }
}
