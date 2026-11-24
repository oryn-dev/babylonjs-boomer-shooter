import { Actor } from "../gfx/actor";
import { SPRITE } from "../gfx/particles";
import { add, clamp, dist, ease, lerp, mul, norm, rand, sub, type V3, wrapAngle } from "../level/vec";
import { Body } from "../play/body";
import type { Run } from "../play/run";
import type { Hit } from "../play/types";
import { num } from "../tune";

export interface Kind {
  id: string;
  name: string;
  model?: string;
  hp: number;
  radius: number;
  height: number;
  speed: number;
  score: number;
  scale?: number;
  fly?: boolean;
  /** Share of a shove it takes. */
  mass: number;
  boss?: boolean;
  /** Parts lost on the way down, in order. */
  sheds: string[];
  /** From this height up a shot counts more. */
  head?: number;
  voice: string;
  think(e: Foe, r: Run, dt: number): void;
  pose(e: Foe, r: Run, dt: number): void;
  /** Share of a blow that gets through. */
  guard?(e: Foe, hit: Hit, r: Run): number;
  onDeath?(e: Foe, hit: Hit, r: Run): void;
  start?(e: Foe, r: Run): void;
}
export type Mood = "idle" | "hunt" | "windup" | "act" | "recover" | "stun" | "dead";
const GRAVITY = 24;
let count = 0;

export class Foe {
  readonly uid = ++count;
  readonly body: Body;
  readonly actor: Actor;
  hp: number;
  mood: Mood = "idle";
  /** Seconds in this mood. */
  t = 0;
  move = "";
  yaw: number;
  cool = rand(0.4, 1.4);
  stun = 0;
  buff = 0;
  burn = 0;
  pinned = 0;
  sees = false;
  seenFor = 0;
  /** Free numbers for a kind's own use. */
  mem: Record<string, number> = {};
  aim: V3 = [0, 0, 1];
  age = rand(0, 10);
  stride = rand(0, 6);
  flinch = 0;
  alive = true;
  private look = 0;
  private way: V3 | null = null;
  private wayAge = 0;
  private lost = 0;
  private stuck = 0;

  constructor(readonly kind: Kind, pos: V3, yaw: number, readonly r: Run, readonly index: number, readonly group?: string) {
    this.hp = kind.hp * r.rules.hp * num(`hp_${kind.id}`, 1);
    this.yaw = yaw;
    this.body = new Body([...pos], kind.radius, kind.height, r.level.collision);
    this.actor = r.stage.actor(kind.model ?? kind.id);
    this.actor.scale = kind.scale ?? 1;
    this.actor.yaw = yaw;
    this.actor.rim = 0.8;
    kind.start?.(this, r);
  }
  get pos() {
    return this.body.pos;
  }
  get centre(): V3 {
    return [this.pos[0], this.pos[1] + this.kind.height * 0.55, this.pos[2]];
  }
  set(mood: Mood, move = "") {
    this.mood = mood;
    this.t = 0;
    this.move = move;
  }
  get pace() {
    return this.r.rules.pace * (this.buff > 0 ? 1.25 : 1);
  }
  get toPlayer(): V3 {
    return sub(this.r.player.centre, this.centre);
  }
  get range() {
    return dist(this.r.player.centre, this.centre);
  }

  alert() {
    if (this.mood !== "idle" || !this.alive) return;
    this.set("hunt");
    this.cool = rand(0.3, 1);
    this.r.sfx.play(`${this.kind.voice}_wake`, { pos: this.centre, vol: 0.8, rate: rand(0.94, 1.06) });
  }

  face(target: V3, dt: number, rate = 7) {
    const want = Math.atan2(target[0] - this.pos[0], target[2] - this.pos[2]);
    this.yaw = wrapAngle(this.yaw + wrapAngle(want - this.yaw) * ease(rate, dt));
  }

  /** Walks the way to the player, or straight to a point. */
  walk(dt: number, speed: number, to?: V3 | null, turn = 8) {
    this.wayAge -= dt;
    if (to) this.way = to;
    else if (this.wayAge <= 0) {
      this.wayAge = rand(0.14, 0.24);
      this.way = this.sees && this.range < 7 && Math.abs(this.r.player.pos[1] - this.pos[1]) < 0.8 && this.straight() ? this.r.player.pos : this.r.nav.step(this.pos);
    }
    if (!this.way) return false;
    const d: V3 = [this.way[0] - this.pos[0], 0, this.way[2] - this.pos[2]];
    const l = Math.hypot(d[0], d[2]);
    if (l < 0.12) return true;
    const v = speed * this.pace;
    const pos = this.pos;
    this.body.accelerate(d[0] / l, d[2] / l, v, this.body.grounded ? 9 : 2, dt);
    this.face(add(pos, d), dt, turn);
    // Caught on a corner: step aside for a moment.
    const s = Math.hypot(this.body.vel[0], this.body.vel[2]);
    this.stuck = s < v * 0.25 ? this.stuck + dt : 0;
    if (this.stuck > 0.5) {
      this.stuck = 0;
      const n = this.r.nav.near(pos, 1, 2.5, 8);
      if (n) ((this.way = n), (this.wayAge = 0.5));
    }
    return true;
  }
  private straight() {
    const a = this.pos;
    const b = this.r.player.pos;
    const y = Math.max(a[1], b[1]) + 0.9;
    return this.r.level.collision.trace([a[0], y, a[2]], [b[0], y, b[2]], 0.4, 0.4, 0.4).fraction >= 1 && this.r.nav.node([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.4, (a[2] + b[2]) / 2], 0) >= 0;
  }
  /** Flies towards a point, round walls by the floor's ways when the straight line is blocked. */
  glide(dt: number, to: V3, speed: number, accel = 3) {
    const w = this.r.level.collision;
    let target = to;
    this.wayAge -= dt;
    if (this.wayAge <= 0) {
      this.wayAge = rand(0.25, 0.4);
      const p = this.centre;
      const t = w.trace(p, to, this.kind.radius * 0.8, this.kind.radius * 0.8, this.kind.radius * 0.8);
      this.way = t.fraction >= 0.98 ? null : this.sees ? t.end : (() => { const n = this.r.nav.step([p[0], p[1], p[2]]); return n ? [n[0], n[1] + 1.9, n[2]] as V3 : null; })();
    }
    if (this.way) target = this.way;
    const d = sub(target, this.centre);
    const l = Math.hypot(...d);
    const want = mul(d, (Math.min(1, l / 1.5) * speed * this.pace) / Math.max(l, 0.01));
    for (let i = 0; i < 3; i++) this.body.vel[i] = lerp(this.body.vel[i], want[i], ease(accel, dt));
  }

  /** A shot or shove. Returns the damage that got through. */
  hurt(hit: Hit): number {
    if (!this.alive) return 0;
    const { r, kind } = this;
    let amount = hit.amount;
    if (kind.head !== undefined && hit.point[1] - this.pos[1] > kind.head && ["rivet", "nail", "shot"].includes(hit.kind)) amount *= 1.4;
    const through = kind.guard ? kind.guard(this, hit, r) : 1;
    if (this.mood === "idle") this.alert();
    const push = (hit.knock * kind.mass * (through > 0 ? 1 : 0.4)) / (kind.boss ? 4 : 1);
    this.body.vel[0] += hit.dir[0] * push;
    this.body.vel[2] += hit.dir[2] * push;
    if (push > 2 && !kind.fly) ((this.body.vel[1] = Math.max(this.body.vel[1], Math.min(6, push * 0.35 + (hit.lift ?? 0) * kind.mass))), (this.body.grounded = false));
    if (kind.fly) this.body.vel[1] += hit.dir[1] * push * 0.6;
    if (hit.stun && kind.mass > 0.1) this.daze(hit.stun * (kind.boss ? 0.3 : 1));
    if (through <= 0) return 0;
    amount *= through * (this.buff > 0 ? 0.6 : 1);
    this.actor.flash = Math.min(0.85, this.actor.flash + 0.25 + amount * 0.012);
    this.actor.flashColor = hit.white ? [1.6, 1.8, 2] : [2, 1.3, 0.6];
    this.flinch = Math.min(1, this.flinch + amount / (kind.hp * 0.35));
    const before = this.hp;
    this.hp -= amount;
    r.hitMark(this, amount);
    const share = Math.max(0, this.hp) / (kind.hp * r.rules.hp);
    kind.sheds.forEach((part, i) => {
      if (share < 1 - (i + 1) / (kind.sheds.length + 1) && this.actor.part(part)?.s) {
        r.fx.shed(this.actor, part, add(mul(hit.dir, 3 + hit.knock * 0.5), [rand(-2, 2), rand(3, 6), rand(-2, 2)]));
        r.sfx.play("break", { pos: this.centre, vol: 0.5, rate: rand(0.9, 1.2) });
      }
    });
    if (this.hp <= 0) this.die(hit, before);
    else {
      r.sfx.play(`${kind.voice}_hit`, { pos: this.centre, vol: 0.75, rate: rand(0.92, 1.1), gap: 0.05 });
      // A heavy blow breaks a windup.
      if (!kind.boss && amount > kind.hp * 0.3 && (this.mood === "windup" || this.mood === "hunt") && this.flinch > 0.6) (this.set("recover"), (this.cool = Math.max(this.cool, 0.35)));
    }
    return amount;
  }
  daze(seconds: number) {
    if (!this.alive) return;
    this.stun = Math.max(this.stun, seconds);
    if (this.mood !== "stun") this.set("stun");
  }

  die(hit: Hit, _before = 0) {
    if (!this.alive) return;
    this.alive = false;
    this.mood = "dead";
    const { r, kind } = this;
    const c = this.centre;
    this.actor.pose();
    const force = clamp(hit.knock * 0.6 + hit.amount * 0.03, 2, 9);
    for (const p of this.actor.model.parts.slice(1)) {
      if (kind.boss || Math.random() < 0.75) r.fx.shed(this.actor, p.name, [hit.dir[0] * force + rand(-3, 3), rand(2, 6) + (hit.lift ?? 0) * 0.4, hit.dir[2] * force + rand(-3, 3)]);
    }
    r.fx.scrap(c, hit.dir, kind.boss ? 8 : Math.random() < 0.5 ? 2 : 3, 3 + force);
    r.fx.bleed(c, hit.dir, 60, hit.white);
    r.stage.particles.burst(c, 14, [1, 5], { color: [2, 0.8, 0.2], end: [0.4, 0.04, 0.01], life: 0.45, size: 0.22, cell: SPRITE.flame, frames: 4, drag: 2 });
    r.stage.lights.flash(c, [3, 1.2, 0.3], 6, 0.3);
    for (const d of [[0, -1, 0], [hit.dir[0], 0, hit.dir[2]]] as V3[]) {
      const t = r.level.collision.trace(c, add(c, mul(d, 3)), 0, 0, 0, true);
      if (t.fraction < 1) r.fx.splat(t.end, t.normal, rand(0.6, 1.1));
    }
    r.sfx.play(`${kind.voice}_die`, { pos: c, vol: 1, rate: rand(0.94, 1.06) });
    r.sfx.play("clank", { pos: c, vol: 0.5, rate: rand(0.8, 1.1), gap: 0.08 });
    kind.onDeath?.(this, hit, r);
    r.killed(this, hit);
  }

  update(dt: number) {
    const { r, kind, body } = this;
    this.age += dt;
    this.t += dt;
    this.cool -= dt * r.rules.pace;
    this.buff -= dt;
    this.look -= dt;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    const a = this.actor;
    a.flash = Math.max(0, a.flash - dt * 6);
    if (this.look <= 0) {
      this.look = rand(0.12, 0.22);
      const p = r.player;
      this.sees = p.alive && this.range < 60 && r.level.collision.clear([this.pos[0], this.pos[1] + kind.height * 0.85, this.pos[2]], p.eye);
      if (this.mood === "idle" && this.sees && (this.range < 26 || Math.abs(wrapAngle(Math.atan2(this.toPlayer[0], this.toPlayer[2]) - this.yaw)) < 1.3)) {
        this.lost += 0.18;
        if (this.lost > 0.3) this.alert();
      }
    }
    this.seenFor = this.sees ? this.seenFor + dt : 0;
    if (this.burn > 0) {
      this.burn -= dt;
      if (Math.random() < dt * 18) r.fx.flame(add(this.centre, [rand(-0.3, 0.3), rand(-0.5, 0.5), rand(-0.3, 0.3)]), 0.22);
      this.mem.burnTick = (this.mem.burnTick ?? 0) - dt;
      if (this.mem.burnTick <= 0) ((this.mem.burnTick = 0.4), this.hurt({ amount: 7, kind: "burn", dir: [0, 0, 0], point: this.centre, knock: 0 }));
      if (!this.alive) return;
    }
    this.pinned -= dt;
    if (this.stun > 0) {
      this.stun -= dt;
      if (Math.random() < dt * 14) r.stage.particles.spawn(add(this.centre, [rand(-0.5, 0.5), kind.height * 0.4, rand(-0.5, 0.5)]), { vel: [0, 0.6, 0], color: [1.2, 1.6, 1.9], life: 0.3, size: 0.06, cell: SPRITE.star });
      if (this.stun <= 0) (this.set("hunt"), (this.cool = Math.max(this.cool, 0.4)));
    } else if (this.mood !== "idle") kind.think(this, r, dt);
    if (!this.alive) return;

    if (kind.fly) {
      if (this.stun > 0) body.vel[1] -= 6 * dt;
      body.friction(0.6, 0.2, dt);
      if (this.pinned > 0) body.vel = [0, 0, 0];
      body.move(dt, 0);
    } else if (!kind.boss || kind.speed > 0) {
      if (body.grounded) body.friction(this.mood === "stun" || this.mood === "recover" ? 7 : 5, 2, dt);
      body.vel[1] -= GRAVITY * dt;
      if (this.pinned > 0) ((body.vel[0] = 0), (body.vel[2] = 0));
      const speed = Math.hypot(body.vel[0], body.vel[2]);
      body.move(dt, 0.75);
      this.stride += speed * dt;
    }
    const molten = r.moltenAt(this.pos);
    if (molten !== null && !kind.fly) {
      this.hurt({ amount: 999, kind: "burn", dir: [0, 1, 0], point: this.centre, knock: 0 });
      return;
    }
    if (this.pos[1] < r.floor - 12) return this.die({ amount: 1, kind: "crush", dir: [0, 1, 0], point: this.centre, knock: 0 });
    a.pos = [this.pos[0], this.pos[1], this.pos[2]];
    a.yaw = this.yaw;
    a.reset();
    kind.pose(this, r, dt);
    if (this.stun > 0) a.roll = Math.sin(this.age * 22) * 0.06;
    else a.roll = lerp(a.roll, 0, ease(8, dt));
    if (this.buff > 0) ((a.flash = Math.max(a.flash, 0.16)), (a.flashColor = [0.3, 1.2, 0.7]));
    a.relight(r.stage.world!.grid, dt, kind.height * 0.6);
    a.mesh.setEnabled(this.range < 75);
  }

  /** Where it will hit a moving player, with some error on easier settings. */
  lead(from: V3, speed: number, share = 0.7): V3 {
    const p = this.r.player;
    const t = dist(from, p.centre) / speed;
    const v = p.body.vel;
    return norm(sub([p.centre[0] + v[0] * t * share, p.centre[1] + Math.min(0, v[1] * t * share * 0.3), p.centre[2] + v[2] * t * share], from));
  }
  /** Hits the player in front, within reach. */
  strike(reach: number, amount: number, knock: number, arc = 0.3) {
    const p = this.r.player;
    const d = sub(p.centre, this.centre);
    const l = Math.hypot(d[0], d[2]);
    if (l > reach + p.body.radius || Math.abs(d[1]) > this.kind.height * 0.5 + 1.1) return false;
    const f: V3 = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    if (l > 0.6 && (d[0] * f[0] + d[2] * f[2]) / l < arc) return false;
    p.hurt(amount, this.centre, mul(norm([d[0], 0.25, d[2]]), knock));
    return true;
  }
  dispose() {
    this.actor.dispose();
  }
}
