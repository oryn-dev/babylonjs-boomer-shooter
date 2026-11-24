import { Actor } from "../gfx/actor";
import { SPRITE } from "../gfx/particles";
import type { Stage } from "../gfx/stage";
import { add, mul, norm, rand, type V3 } from "../level/vec";

const ORANGE: V3 = [2.4, 0.9, 0.18];
const HOT: V3 = [2.6, 1.7, 0.7];
const RED: V3 = [0.9, 0.12, 0.02];
export const CYAN: V3 = [0.3, 1.1, 1.3];

interface Debris { actor: Actor; vel: V3; spin: V3; life: number; bounce: boolean; small: boolean; trail: number }
const MAX_DEBRIS = 30;

/** Sparks, gore of slag, blasts, broken-off parts. */
export class Fx {
  private debris: Debris[] = [];
  shake = 0;
  /** Seconds the world stands still for a heavy blow. */
  freeze = 0;

  constructor(private stage: Stage) {}

  kick(amount: number, at?: V3) {
    const d = at ? Math.hypot(at[0] - this.stage.eye[0], at[1] - this.stage.eye[1], at[2] - this.stage.eye[2]) : 0;
    this.shake = Math.max(this.shake, amount * Math.max(0, 1 - d / 26));
  }

  spark(p: V3, n: V3, count = 6, color: V3 = HOT) {
    this.stage.particles.burst(p, count, [2, 7], { color, end: RED, life: 0.35, size: 0.018, cell: SPRITE.spark, stretch: 0.03, gravity: 12, drag: 1.5, bounce: true }, n, 0.8);
  }
  /** A shot on a wall. */
  wall(p: V3, n: V3, size = 0.07, white = false) {
    const q = add(p, mul(n, 0.03));
    this.spark(q, n, white ? 10 : 6, white ? [2, 2.4, 3] : HOT);
    this.stage.particles.burst(q, 3, [0.3, 1.2], { color: [0.2, 0.18, 0.17], end: [0.1, 0.09, 0.09], add: 0, alpha: 0.6, life: 0.6, size: 0.1, grow: 0.25, cell: SPRITE.smoke, frames: 4, drag: 2 }, n, 0.5);
    this.stage.particles.sprite(q, 0.16, SPRITE.star, HOT);
    this.stage.particles.decal(p, n, size, SPRITE.hole, [0.08, 0.07, 0.06], 0.9, 1.6);
    this.stage.lights.flash(q, [1.6, 0.8, 0.25], 2.5, 0.09);
  }
  /** Slag bleeding from a machine. */
  bleed(p: V3, dir: V3, amount: number, white = false) {
    const c: V3 = white ? [2.2, 2.4, 2.6] : ORANGE;
    this.stage.particles.burst(p, 3 + amount * 0.18, [1.5, 6], { color: c, end: RED, life: 0.6, size: 0.05, cell: SPRITE.drop, gravity: 13, drag: 0.6, bounce: true }, mul(dir, -0.5), 0.9);
    this.stage.particles.burst(p, 3, [3, 8], { color: HOT, end: ORANGE, life: 0.25, size: 0.02, cell: SPRITE.spark, stretch: 0.03, gravity: 8 }, dir, 0.8);
  }
  splat(p: V3, n: V3, size: number) {
    this.stage.particles.decal(p, n, size, Math.random() < 0.5 ? SPRITE.splat : SPRITE.splat2, [0.06, 0.02, 0.01], 0.95, 5);
  }
  flame(p: V3, size: number, vel: V3 = [0, 1, 0]) {
    this.stage.particles.spawn(p, { vel: [vel[0] + rand(-0.3, 0.3), vel[1], vel[2] + rand(-0.3, 0.3)], color: [1.6, 0.7, 0.2], end: [0.6, 0.06, 0.01], life: rand(0.3, 0.55), size, grow: -size * 0.6, cell: SPRITE.flame, frames: 4 });
  }
  smoke(p: V3, size = 0.3, vel: V3 = [0, 0.8, 0], dark = 0.1) {
    this.stage.particles.spawn(p, { vel: [vel[0] + rand(-0.3, 0.3), vel[1], vel[2] + rand(-0.3, 0.3)], color: [dark, dark * 0.9, dark * 0.85], end: [dark * 0.5, dark * 0.45, dark * 0.45], add: 0, alpha: 0.55, life: rand(0.8, 1.5), size, grow: size * 1.8, cell: SPRITE.smoke, frames: 4, spin: rand(-1, 1), drag: 1 });
  }
  steam(p: V3, dir: V3, count = 6, size = 0.2) {
    this.stage.particles.burst(p, count, [1, 4], { color: [0.55, 0.52, 0.5], end: [0.2, 0.2, 0.2], add: 0.3, alpha: 0.5, life: 0.6, size, grow: size * 2, cell: SPRITE.smoke, frames: 4, drag: 3 }, mul(dir, 2), 0.7);
  }
  /** Muzzle of a gun in the hands, drawn over the world. */
  muzzle(p: V3, size: number, color: V3) {
    this.stage.particles.sprite(p, size, Math.random() < 0.5 ? SPRITE.muzzle : SPRITE.muzzle2, color, 1, 1, true, rand(0, 6.28));
  }
  blast(p: V3, radius: number, color: V3 = ORANGE) {
    const { particles, lights } = this.stage;
    particles.spawn(p, { color: [3, 2.2, 1.2], end: color, life: 0.14, size: radius * 0.35, grow: radius * 0.5, cell: SPRITE.glow });
    particles.spawn(p, { color, end: [0.3, 0.04, 0.01], life: 0.35, size: radius * 0.2, grow: radius * 0.9, cell: SPRITE.wave });
    particles.burst(p, 16, [1, radius * 1.6], { color: [2, 0.9, 0.25], end: [0.3, 0.03, 0.01], life: 0.5, size: radius * 0.17, grow: radius * 0.1, cell: SPRITE.flame, frames: 4, drag: 3, spin: 3 });
    particles.burst(p, 22, [4, radius * 4], { color: HOT, end: RED, life: 0.8, size: 0.03, cell: SPRITE.spark, stretch: 0.03, gravity: 12, bounce: true }, [0, 0.5, 0]);
    particles.burst(p, 8, [0.6, 2.2], { color: [0.12, 0.1, 0.09], end: [0.04, 0.035, 0.03], add: 0, alpha: 0.6, life: 1.4, size: radius * 0.16, grow: radius * 0.35, cell: SPRITE.smoke, frames: 4, drag: 2 }, [0, 0.8, 0]);
    lights.flash(p, mul(color, 3.2), radius * 3, 0.4);
    this.kick(0.6, p);
  }
  ring(p: V3, radius: number, color: V3, life = 0.4) {
    this.stage.particles.spawn(p, { color, end: mul(color, 0.1), life, size: 0.2, grow: radius, cell: SPRITE.wave });
  }
  /** Lightning between two points. */
  arc(a: V3, b: V3, width = 0.07, color: V3 = [0.5, 1.7, 1.5]) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    const n = Math.max(2, Math.min(9, Math.round(l / 1.1)));
    let last = a;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const j = i === n ? 0 : 0.16 + l * 0.012;
      const p: V3 = [a[0] + d[0] * k + rand(-j, j), a[1] + d[1] * k + rand(-j, j), a[2] + d[2] * k + rand(-j, j)];
      this.stage.particles.beam(last, p, width, SPRITE.beam, color);
      this.stage.particles.beam(last, p, width * 0.35, SPRITE.beam, [2.2, 2.6, 2.6]);
      last = p;
    }
  }
  /** Something arrives out of the heat. */
  arrive(p: V3, height: number) {
    const { particles, lights } = this.stage;
    lights.flash(add(p, [0, 1, 0]), [3, 1.1, 0.3], 8, 0.6);
    for (let i = 0; i < 12; i++) particles.spawn([p[0] + rand(-0.5, 0.5), p[1] + rand(0, height), p[2] + rand(-0.5, 0.5)], { vel: [0, rand(1, 4), 0], color: [2, 0.9, 0.25], end: RED, life: rand(0.3, 0.7), size: 0.28, cell: SPRITE.flame, frames: 4 });
    particles.burst(add(p, [0, 0.2, 0]), 16, [2, 6], { color: HOT, end: RED, life: 0.5, size: 0.03, cell: SPRITE.spark, stretch: 0.03, gravity: 8 }, [0, 1, 0]);
    this.smoke(add(p, [0, 0.4, 0]), 0.6);
    particles.decal(add(p, [0, 0.01, 0]), [0, 1, 0], 0.9, SPRITE.scorch, [0, 0, 0], 0.8, 3);
  }

  /** Throws one part of a machine; the actor's own copy of it disappears. */
  shed(from: Actor, part: string, vel: V3) {
    const i = from.model.parts.findIndex((p) => p.name === part);
    if (i < 0 || from.poses[i].s === 0) return;
    const pos = from.point(part);
    from.poses[i].s = 0;
    const a = this.stage.actor(from.model.name);
    a.solo = i;
    a.scale = from.scale;
    a.pos = pos;
    a.yaw = from.yaw;
    a.heat = 0.25;
    this.push(a, vel, true, false);
  }
  scrap(p: V3, dir: V3, count: number, speed = 5) {
    for (let i = 0; i < count; i++) {
      const a = this.stage.actor(`scrap${Math.floor(rand(0, 3))}`);
      a.pos = [...p];
      a.yaw = rand(0, 6);
      a.heat = rand(0.2, 0.7);
      this.push(a, add(mul(dir, speed * 0.6), mul(norm([rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)]), rand(0.4, 1) * speed)), true, true);
    }
  }
  private push(actor: Actor, vel: V3, bounce: boolean, small: boolean) {
    while (this.debris.length >= MAX_DEBRIS) this.debris.shift()!.actor.dispose();
    this.debris.push({ actor, vel, spin: [rand(-8, 8), rand(-8, 8), rand(-8, 8)], life: small ? rand(2, 3.5) : rand(4.5, 7), bounce, small, trail: small ? 0.5 : 1.4 });
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * (1.2 + this.shake * 3.5));
    const { world, particles } = this.stage;
    this.debris = this.debris.filter((d) => {
      d.life -= dt;
      const a = d.actor;
      if (d.life <= 0) return a.dispose(), false;
      d.vel[1] -= 20 * dt;
      const to = add(a.pos, mul(d.vel, dt));
      const t = world?.level.collision.trace(a.pos, to, 0.1, 0.1, 0.1);
      if (t && t.fraction < 1 && !t.startSolid) {
        a.pos = t.end;
        const into = d.vel[0] * t.normal[0] + d.vel[1] * t.normal[1] + d.vel[2] * t.normal[2];
        if (!d.small && into < -4 && d.trail > 0.4) this.splat(t.end, t.normal, rand(0.18, 0.4));
        for (let k = 0; k < 3; k++) ((d.vel[k] -= t.normal[k] * into * 1.35), (d.vel[k] *= 0.62), (d.spin[k] *= 0.5));
      } else a.pos = to;
      a.pitch += d.spin[0] * dt;
      a.yaw += d.spin[1] * dt;
      a.roll += d.spin[2] * dt;
      a.heat = Math.max(0, a.heat - dt * 0.12);
      if (d.trail > 0) {
        d.trail -= dt;
        if (Math.random() < dt * 40) particles.spawn(a.pos, { vel: [rand(-0.4, 0.4), rand(0, 0.6), rand(-0.4, 0.4)], color: ORANGE, end: RED, life: 0.35, size: 0.06, grow: -0.04, cell: SPRITE.drop, gravity: 5 });
      }
      if (d.life < 0.4) a.scale *= 1 - dt * 5;
      if (world) a.relight(world.grid, dt, 0.2);
      return true;
    });
  }
  clear() {
    for (const d of this.debris) d.actor.dispose();
    this.debris = [];
    this.shake = this.freeze = 0;
  }
}
