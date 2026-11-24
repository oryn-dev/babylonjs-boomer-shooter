import { type Brush, type Collision, type Trace } from "../level/trace";
import { clamp, type V3 } from "../level/vec";

/** A box that slides along walls, climbs steps and stands on slopes and lifts. Position is at the feet. */
export class Body {
  vel: V3 = [0, 0, 0];
  grounded = false;
  ground: Brush | null = null;
  groundNormal: V3 = [0, 1, 0];
  /** Speed lost by the last wall, for thuds. */
  bump = 0;

  constructor(public pos: V3, readonly radius: number, public height: number, private world: Collision) {}

  private sweep(from: V3, to: V3): Trace {
    const h = this.height / 2;
    const t = this.world.trace([from[0], from[1] + h, from[2]], [to[0], to[1] + h, to[2]], this.radius, h, this.radius);
    t.end[1] -= h;
    return t;
  }
  free(pos: V3) {
    return !this.sweep(pos, pos).startSolid;
  }

  private slide(pos: V3, vel: V3, dt: number): { pos: V3; vel: V3 } {
    let p: V3 = [...pos];
    let v: V3 = [...vel];
    let left = dt;
    const planes: V3[] = [];
    for (let i = 0; i < 4 && left > 1e-5; i++) {
      const t = this.sweep(p, [p[0] + v[0] * left, p[1] + v[1] * left, p[2] + v[2] * left]);
      p = t.end;
      if (t.fraction >= 1) break;
      left *= 1 - t.fraction;
      planes.push(t.normal);
      for (const n of planes) {
        const into = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
        if (into >= 0) continue;
        this.bump = Math.max(this.bump, -into);
        v = [v[0] - n[0] * into * 1.001, v[1] - n[1] * into * 1.001, v[2] - n[2] * into * 1.001];
      }
      if (planes.length > 1) {
        // Wedged between two planes: run along their crease.
        const [a, b] = planes.slice(-2);
        if (v[0] * a[0] + v[1] * a[1] + v[2] * a[2] < -1e-3 || v[0] * b[0] + v[1] * b[1] + v[2] * b[2] < -1e-3) {
          const c: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          const l = Math.hypot(...c) || 1;
          const s = (v[0] * c[0] + v[1] * c[1] + v[2] * c[2]) / (l * l);
          v = [c[0] * s, c[1] * s, c[2] * s];
        }
      }
    }
    return { pos: p, vel: v };
  }

  /** Moves for one step; `step` is how high it climbs without a jump. */
  move(dt: number, step: number) {
    this.bump = 0;
    this.unstick();
    const was = this.grounded;
    const start: V3 = [...this.pos];
    const flat = this.slide(start, this.vel, dt);
    if (step > 0 && (was || this.vel[1] <= 0.5)) {
      const went = Math.hypot(flat.pos[0] - start[0], flat.pos[2] - start[2]);
      const wanted = Math.hypot(this.vel[0], this.vel[2]) * dt;
      if (went < wanted * 0.98) {
        const up = this.sweep(start, [start[0], start[1] + step, start[2]]);
        const over = this.slide(up.end, [this.vel[0], 0, this.vel[2]], dt);
        const down = this.sweep(over.pos, [over.pos[0], over.pos[1] - (up.end[1] - start[1]) - 0.02, over.pos[2]]);
        const far = Math.hypot(over.pos[0] - start[0], over.pos[2] - start[2]);
        if (far > went + 0.004 && down.fraction < 1 && down.normal[1] > 0.65 && (was || down.end[1] - start[1] < step)) {
          this.pos = down.end;
          this.vel = [over.vel[0], Math.max(0, Math.min(this.vel[1], 0)), over.vel[2]];
          this.settle(step, was);
          return;
        }
      }
    }
    this.pos = flat.pos;
    this.vel = flat.vel;
    this.settle(step, was);
  }

  private settle(step: number, was: boolean) {
    this.grounded = false;
    this.ground = null;
    if (this.vel[1] > 1.5) return;
    // Running down stairs and slopes keeps the feet on them.
    const reach = was && step > 0 ? step * 0.7 : 0.05;
    const t = this.sweep(this.pos, [this.pos[0], this.pos[1] - reach, this.pos[2]]);
    if (t.startSolid || t.fraction >= 1 || t.normal[1] < 0.65) return;
    this.pos = t.end;
    this.grounded = true;
    this.ground = t.brush;
    this.groundNormal = t.normal;
    if (this.vel[1] < 0) this.vel[1] = 0;
  }

  /** Out of a wall or a lift that closed on it. */
  unstick() {
    if (this.free(this.pos)) return true;
    for (const r of [0.03, 0.08, 0.16, 0.3, 0.5, 0.8])
      for (const [x, y, z] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]]) {
        const p: V3 = [this.pos[0] + x * r, this.pos[1] + y * r, this.pos[2] + z * r];
        if (this.free(p)) return ((this.pos = p), true);
      }
    return false;
  }

  /** Ground friction, and speeding up towards a wish as in the old arena shooters. */
  friction(k: number, stop: number, dt: number) {
    const s = Math.hypot(this.vel[0], this.vel[2]);
    if (s < 0.01) return ((this.vel[0] = 0), void (this.vel[2] = 0));
    const n = Math.max(0, s - Math.max(s, stop) * k * dt) / s;
    this.vel[0] *= n;
    this.vel[2] *= n;
  }
  accelerate(x: number, z: number, speed: number, accel: number, dt: number) {
    const add = speed - (this.vel[0] * x + this.vel[2] * z);
    if (add <= 0) return;
    const a = clamp(accel * speed * dt, 0, add);
    this.vel[0] += x * a;
    this.vel[2] += z * a;
  }
}
