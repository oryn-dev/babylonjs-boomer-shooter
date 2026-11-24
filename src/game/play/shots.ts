import type { Actor } from "../gfx/actor";
import { SPRITE } from "../gfx/particles";
import type { Foe } from "../foes/foe";
import { add, dist, dot, mad, mul, norm, rand, sub, type V3 } from "../level/vec";
import { num } from "../tune";
import type { Run } from "./run";

type Type = "nail" | "blade" | "slag" | "orb" | "ember" | "bolt" | "toll" | "note" | "saw" | "hook";
export interface Shot {
  type: Type;
  pos: V3;
  vel: V3;
  mine: boolean;
  from: Foe | null;
  damage: number;
  radius: number;
  life: number;
  gravity: number;
  actor: Actor | null;
  bounces: number;
  white: boolean;
  age: number;
  hit: Set<number>;
  /** Blades resting in a wall or flying home. */
  state: "fly" | "stuck" | "home";
  extra: number;
  dead: boolean;
}
interface Wave { pos: V3; r: number; to: number; speed: number; damage: number; from: Foe | null; done: boolean; mine: boolean; stun: number; hit: Set<number> }
interface Puddle { pos: V3; r: number; life: number; tick: number; mine: boolean }
export interface Pillar { pos: V3; delay: number; life: number; r: number; hit: boolean }

const ENEMY: Partial<Record<Type, { speed: number; damage: number; radius: number; life: number; model?: string; scale?: number }>> = {
  ember: { speed: 16, damage: 9, radius: 0.22, life: 5 },
  bolt: { speed: 30, damage: 14, radius: 0.16, life: 4 },
  toll: { speed: 13, damage: 18, radius: 0.55, life: 6, model: "toll", scale: 0.8 },
  note: { speed: 8, damage: 11, radius: 0.25, life: 7 },
  saw: { speed: 17, damage: 16, radius: 0.3, life: 6, model: "sawblade", scale: 1.7 },
  hook: { speed: 30, damage: 6, radius: 0.22, life: 1, model: "wirehook" },
};
const COLOR: Partial<Record<Type, V3>> = { ember: [2, 0.75, 0.15], bolt: [2.2, 1.1, 0.35], toll: [1.8, 1.2, 0.4], note: [0.4, 1.8, 1], saw: [1.6, 0.8, 0.3] };

export class Shots {
  list: Shot[] = [];
  private waves: Wave[] = [];
  private puddles: Puddle[] = [];
  pillars: Pillar[] = [];

  constructor(private r: Run) {}

  private add(s: Partial<Shot> & { type: Type; pos: V3; vel: V3 }, model?: string, scale = 1) {
    const actor = model ? this.r.stage.actor(model) : null;
    if (actor) ((actor.scale = scale), (actor.rim = 1), (actor.pos = [...s.pos]));
    const shot: Shot = { mine: true, from: null, damage: 10, radius: 0.1, life: 5, gravity: 0, bounces: 0, white: false, age: 0, hit: new Set(), state: "fly", extra: 0, dead: false, ...s, actor };
    shot.pos = [...s.pos];
    this.list.push(shot);
    return shot;
  }
  // The player's
  nail(pos: V3, dir: V3, damage: number, white: boolean) {
    this.add({ type: "nail", pos, vel: mul(dir, 75), damage, radius: 0.06, life: 2, white }, "rivetshot", 1.5);
  }
  blade(pos: V3, dir: V3, damage: number, white: boolean) {
    this.add({ type: "blade", pos, vel: mul(dir, num("blade_speed", 36)), damage, radius: 0.16, life: 14, bounces: 3, white }, "sawblade");
  }
  slag(pos: V3, vel: V3, damage: number, white: boolean, small = false) {
    this.add({ type: "slag", pos, vel, damage, radius: 0.12, life: 4, gravity: 16, white, extra: small ? 1 : 0, bounces: small ? 0 : 0 }, "slagball", small ? 0.6 : 1);
  }
  orb(pos: V3, dir: V3, damage: number, white: boolean) {
    this.add({ type: "orb", pos, vel: mul(dir, 9), damage, radius: 0.25, life: 4.5, white });
  }
  get flyingBlades() {
    return this.list.filter((s) => s.type === "blade" && !s.dead);
  }
  recall() {
    let n = 0;
    for (const s of this.flyingBlades) if (s.state !== "home") ((s.state = "home"), s.hit.clear(), (s.life = 6), n++);
    return n;
  }
  // The machines'
  enemy(type: Type, pos: V3, dir: V3, from: Foe) {
    const e = ENEMY[type]!;
    return this.add({ type, pos, vel: mul(norm(dir), e.speed * (0.8 + this.r.rules.pace * 0.2)), mine: false, from, damage: e.damage, radius: e.radius, life: e.life, bounces: type === "saw" ? 3 : 0 }, e.model, e.scale);
  }
  hook(pos: V3, dir: V3, from: Foe) {
    this.enemy("hook", pos, dir, from);
  }
  wave(pos: V3, to: number, speed: number, damage: number, from: Foe | null, mine = false, stun = 0) {
    this.waves.push({ pos: [...pos], r: 0.5, to, speed, damage, from, done: false, mine, stun, hit: new Set() });
  }
  puddle(pos: V3, r: number, life: number, mine: boolean) {
    this.puddles.push({ pos: [...pos], r, life, tick: 0, mine });
  }
  pillar(pos: V3, delay: number, r = 1.3) {
    this.pillars.push({ pos: [...pos], delay, life: 0.9, r, hit: false });
  }

  /** A gust throws what flies in front back at its owner. */
  reflect(eye: V3, dir: V3, reach: number) {
    let n = 0;
    for (const s of this.list) {
      if (s.mine || s.dead || s.type === "hook") continue;
      const d = sub(s.pos, eye);
      const l = Math.hypot(...d);
      if (l > reach || dot(d, dir) / (l || 1) < 0.6) continue;
      const back = s.from?.alive ? norm(sub(s.from.centre, s.pos)) : dir;
      s.vel = mul(back, Math.max(26, Math.hypot(...s.vel) * 1.7));
      s.mine = true;
      s.damage *= 4;
      s.life = 4;
      n++;
    }
    return n;
  }

  private burstSlag(s: Shot) {
    const r = this.r;
    const small = s.extra === 1;
    r.blast(s.pos, small ? 2.6 : 4.2, s.damage, "foes", s.damage, s.white);
    const floor = r.level.collision.trace(s.pos, add(s.pos, [0, -2.5, 0]), 0, 0, 0, true);
    if (floor.fraction < 1) this.puddle(floor.end, small ? 1.2 : 2, small ? 2.2 : 4, true);
    s.dead = true;
  }

  update(dt: number) {
    const { r } = this;
    const { particles: p, lights } = r.stage;
    const world = r.level.collision;
    for (const s of this.list) {
      s.age += dt;
      s.life -= dt;
      if (s.life <= 0) { if (s.type === "slag") this.burstSlag(s); s.dead = true; continue; }
      const before: V3 = [...s.pos];
      s.vel[1] -= s.gravity * dt;
      if (s.state === "stuck") {
        if (s.age > 5) (s.state = "home");
      } else {
        if (s.state === "home") {
          const d = sub(r.player.centre, s.pos);
          const l = Math.hypot(...d);
          if (l < 1.2) { s.dead = true; r.player.give("blades", 1, true); r.sfx.play("blade_back", { vol: 0.6 }); continue; }
          s.vel = mul(d, 42 / l);
        }
        if (s.type === "note" && s.from?.alive !== undefined && !s.mine && s.age > 0.5) {
          const want = mul(norm(sub(r.player.centre, s.pos)), 8.5);
          for (let i = 0; i < 3; i++) s.vel[i] += (want[i] - s.vel[i]) * Math.min(1, dt * 2.4);
        }
        const to = mad(s.pos, s.vel, dt);
        let end = to;
        let stop = false;
        let normal: V3 = [0, 1, 0];
        if (s.state !== "home") {
          const t = world.trace(before, to, s.radius * 0.5, s.radius * 0.5, s.radius * 0.5, true);
          if (t.fraction < 1 && !t.startSolid) ((stop = true), (end = t.end), (normal = t.normal));
          else if (t.startSolid) s.dead = true;
        }
        if (s.mine) this.hitFoes(s, before, end);
        else if (this.hitPlayer(s, before, end)) continue;
        if (s.dead) continue;
        s.pos = end;
        if (stop) this.land(s, normal);
      }
      this.draw(s, dt, p, lights, before);
    }
    this.list = this.list.filter((s) => {
      if (s.dead) s.actor?.dispose();
      return !s.dead;
    });

    for (const w of this.waves) {
      const was = w.r;
      w.r += w.speed * dt;
      if (w.r > w.to) w.done = true;
      const fade = 1 - w.r / w.to;
      const n = Math.round(10 + w.r * 2.2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + w.r;
        const q: V3 = [w.pos[0] + Math.cos(a) * w.r, w.pos[1] + 0.12, w.pos[2] + Math.sin(a) * w.r];
        p.sprite([q[0], q[1] + 0.12, q[2]], 0.22 + fade * 0.2, SPRITE.flame + (i & 3), w.mine ? mul([1.6, 1.3, 0.8], fade + 0.2) : mul([2, 0.7, 0.14], fade + 0.25));
      }
      p.ground(add(w.pos, [0, 0.05, 0]), w.r, SPRITE.wave, w.mine ? [1, 0.8, 0.4] : [1.4, 0.4, 0.06], 1, 1);
      if (w.mine) {
        for (const f of r.foes) {
          if (!f.alive || w.hit.has(f.uid)) continue;
          const d = Math.hypot(f.pos[0] - w.pos[0], f.pos[2] - w.pos[2]);
          if (d < w.r && Math.abs(f.pos[1] - w.pos[1]) < 5) {
            w.hit.add(f.uid);
            f.hurt({ amount: w.damage, kind: "bell", dir: norm([f.pos[0] - w.pos[0], 0, f.pos[2] - w.pos[2]]), point: f.centre, knock: 7, lift: 4, stun: w.stun });
          }
        }
      } else if (!w.hit.has(-1)) {
        const pl = r.player;
        const d = Math.hypot(pl.pos[0] - w.pos[0], pl.pos[2] - w.pos[2]);
        if (d < w.r + 0.3 && d > was - 0.9 && pl.pos[1] - w.pos[1] < 0.7 && pl.pos[1] - w.pos[1] > -1.2) {
          w.hit.add(-1);
          pl.hurt(w.damage, w.pos, [((pl.pos[0] - w.pos[0]) / (d || 1)) * 8, 6, ((pl.pos[2] - w.pos[2]) / (d || 1)) * 8]);
        }
      }
    }
    this.waves = this.waves.filter((w) => !w.done);

    for (const u of this.puddles) {
      u.life -= dt;
      u.tick -= dt;
      const k = Math.min(1, u.life);
      p.ground(add(u.pos, [0, 0.01, 0]), u.r, SPRITE.splat, [1.9 * k, 0.6 * k, 0.1 * k], 0.4, k);
      if (Math.random() < dt * 16) r.fx.flame(add(u.pos, [rand(-u.r, u.r) * 0.7, 0.15, rand(-u.r, u.r) * 0.7]), 0.2);
      lights.put(add(u.pos, [0, 0.4, 0]), [1.2 * k, 0.42 * k, 0.07], u.r * 2.2);
      if (u.tick > 0) continue;
      u.tick = 0.25;
      if (u.mine) {
        for (const f of r.foes) if (f.alive && !f.kind.fly && Math.hypot(f.pos[0] - u.pos[0], f.pos[2] - u.pos[2]) < u.r + f.kind.radius && Math.abs(f.pos[1] - u.pos[1]) < 1) (f.hurt({ amount: 8, kind: "burn", dir: [0, 0, 0], point: f.centre, knock: 0 }), (f.burn = Math.max(f.burn, 1.2)));
      } else if (Math.hypot(r.player.pos[0] - u.pos[0], r.player.pos[2] - u.pos[2]) < u.r && Math.abs(r.player.pos[1] - u.pos[1]) < 0.7) r.player.hurt(6, u.pos, [0, 0, 0]);
    }
    this.puddles = this.puddles.filter((u) => u.life > 0);

    for (const q of this.pillars) {
      q.delay -= dt;
      const low = add(q.pos, [0, 0.04, 0]);
      if (q.delay > 0) {
        p.ground(low, q.r, SPRITE.wave, [1.2 + Math.sin(q.delay * 30) * 0.5, 0.35, 0.05], 1, 1);
        p.ground(low, q.r * Math.max(0.1, 1 - q.delay), SPRITE.soft, [0.7, 0.16, 0.02], 1, 1);
        continue;
      }
      if (q.life === 0.9) (r.sfx.play("flame", { pos: q.pos, vol: 0.7, rate: rand(0.9, 1.1), gap: 0.04 }), r.fx.kick(0.2, q.pos));
      q.life -= dt;
      lights.put(add(q.pos, [0, 1.5, 0]), [3, 1, 0.2], 7);
      for (let i = 0; i < 3; i++) p.spawn(add(q.pos, [rand(-0.6, 0.6) * q.r, rand(0, 0.5), rand(-0.6, 0.6) * q.r]), { vel: [0, rand(8, 16), 0], color: [2.4, 1.2, 0.35], end: [0.7, 0.06, 0.01], life: 0.4, size: 0.45, cell: SPRITE.flame, frames: 4 });
      const pl = r.player;
      if (!q.hit && Math.hypot(pl.pos[0] - q.pos[0], pl.pos[2] - q.pos[2]) < q.r + 0.2 && pl.pos[1] - q.pos[1] < 5 && pl.pos[1] - q.pos[1] > -1) ((q.hit = true), pl.hurt(18, q.pos, [0, 7, 0]));
    }
    this.pillars = this.pillars.filter((q) => q.life > 0);
  }

  private land(s: Shot, n: V3) {
    const { r } = this;
    switch (s.type) {
      case "nail":
        r.fx.wall(s.pos, n, 0.1, s.white);
        r.sfx.play("ricochet", { pos: s.pos, vol: 0.5 });
        s.dead = true;
        break;
      case "blade":
      case "saw": {
        r.fx.spark(s.pos, n, 10);
        r.sfx.play("blade_wall", { pos: s.pos, vol: 0.6, rate: rand(0.95, 1.1), gap: 0.04 });
        if (s.bounces-- > 0) {
          const into = dot(s.vel, n);
          s.vel = mad(s.vel, n, -2 * into);
          s.hit.clear();
          s.pos = mad(s.pos, n, 0.05);
        } else if (s.type === "blade") ((s.state = "stuck"), (s.vel = [0, 0, 0]), (s.age = 0));
        else s.dead = true;
        break;
      }
      case "slag":
        this.burstSlag(s);
        break;
      case "orb":
        s.vel = [0, 0, 0];
        s.life = Math.min(s.life, 1.2);
        break;
      default:
        if (s.type === "hook") { s.dead = true; r.fx.spark(s.pos, n, 5); break; }
        r.fx.spark(s.pos, n, 6, COLOR[s.type]);
        r.stage.lights.flash(s.pos, mul(COLOR[s.type] ?? [1, 1, 1], 0.8), 3, 0.15);
        r.stage.particles.decal(s.pos, n, 0.18, SPRITE.scorch, [0, 0, 0], 0.7, 1);
        r.sfx.play("fizz", { pos: s.pos, vol: 0.35, gap: 0.05 });
        s.dead = true;
    }
  }

  private hitFoes(s: Shot, a: V3, b: V3) {
    const { r } = this;
    for (;;) {
      const h = r.rayFoes(a, b, s.radius, s.hit);
      if (!h) return;
      s.hit.add(h.foe.uid);
      const dir = norm(s.vel);
      const base = { dir, point: h.point, white: s.white };
      if (s.type === "nail") {
        const dealt = h.foe.hurt({ ...base, amount: s.damage, kind: "nail", knock: 3 });
        r.fx.bleed(h.point, dir, s.damage, s.white);
        if (dealt > 0 && h.foe.alive && h.foe.kind.mass > 0.2) (h.foe.daze(1.4), (h.foe.pinned = 1.4), r.sfx.play("pin", { pos: h.point, vol: 0.8 }));
        s.dead = true;
        return;
      }
      if (s.type === "blade") {
        h.foe.hurt({ ...base, amount: s.damage * (s.state === "home" ? 0.7 : 1), kind: "blade", knock: 2.5 });
        r.fx.bleed(h.point, dir, s.damage, s.white);
        r.sfx.play("saw_hit", { pos: h.point, vol: 0.8, rate: rand(0.95, 1.1), gap: 0.04 });
        continue;
      }
      if (s.type === "slag") { s.pos = h.point; h.foe.hurt({ ...base, amount: s.damage * 0.4, kind: "slag", knock: 2 }); this.burstSlag(s); return; }
      if (s.type === "orb") { s.hit.delete(h.foe.uid); s.vel = mul(s.vel, 0.9); return; }
      h.foe.hurt({ ...base, amount: s.damage, kind: "rivet", knock: 6 });
      r.fx.bleed(h.point, dir, 30);
      s.dead = true;
      return;
    }
  }

  private hitPlayer(s: Shot, a: V3, b: V3) {
    const pl = this.r.player;
    if (!pl.alive) return false;
    // Nearest point of the flight to the player's box, shrunk a little in the player's favour.
    const d = sub(b, a);
    const l = dot(d, d);
    const k = l > 0 ? Math.max(0, Math.min(1, dot(sub(pl.centre, a), d) / l)) : 0;
    const q = mad(a, d, k);
    const rad = s.radius * 0.8 + pl.body.radius - 0.05;
    if (Math.abs(q[0] - pl.pos[0]) > rad || Math.abs(q[2] - pl.pos[2]) > rad || q[1] < pl.pos[1] - s.radius || q[1] > pl.pos[1] + pl.body.height + s.radius) return false;
    s.dead = true;
    if (s.type === "hook") {
      pl.hurt(s.damage, s.pos, [0, 0, 0]);
      if (s.from?.alive) ((s.from.mem.reel = 1), (s.from.t = 0), pl.reel(s.from));
      this.r.sfx.play("hooked", { vol: 1 });
      return true;
    }
    pl.hurt(s.damage, sub(s.pos, s.vel), mul(norm(s.vel), 3));
    this.r.fx.spark(q, mul(norm(s.vel), -1), 8, COLOR[s.type]);
    return true;
  }

  private draw(s: Shot, dt: number, p: Run["stage"]["particles"], lights: Run["stage"]["lights"], before: V3) {
    const { r } = this;
    if (s.actor) {
      const a = s.actor;
      a.pos = [...s.pos];
      const h = Math.hypot(s.vel[0], s.vel[2]);
      if (s.type === "blade" || s.type === "saw") {
        a.yaw += dt * (s.state === "stuck" ? 0 : 26);
        a.heat = s.white ? 0.8 : 0;
        if (s.state !== "stuck") p.beam(s.pos, mad(s.pos, norm(s.vel), -0.9), 0.16, SPRITE.beam, s.white ? [0.7, 0.9, 1.2] : [0.5, 0.28, 0.1]);
        else if (Math.random() < dt * 2) r.fx.spark(s.pos, [0, 1, 0], 1);
      } else if (h > 0.1 || Math.abs(s.vel[1]) > 0.1) ((a.yaw = Math.atan2(s.vel[0], s.vel[2])), (a.pitch = -Math.atan2(s.vel[1], h)));
      a.relight(r.stage.world!.grid, dt, 0);
    }
    switch (s.type) {
      case "nail":
        p.beam(s.pos, before, 0.06, SPRITE.beam, s.white ? [1.6, 2, 2.6] : [2.2, 1.2, 0.4]);
        lights.put(s.pos, [1.2, 0.6, 0.2], 3);
        break;
      case "slag":
        lights.put(s.pos, [1.6, 0.6, 0.1], 5);
        if (Math.random() < dt * 60) p.spawn(s.pos, { vel: [rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)], color: [2, 0.8, 0.15], end: [0.4, 0.04, 0.01], life: 0.4, size: 0.12, grow: -0.08, cell: SPRITE.drop, gravity: 4 });
        break;
      case "orb": {
        p.sprite(s.pos, 0.5 + Math.sin(s.age * 30) * 0.08, SPRITE.glow, [0.7, 2, 1.8]);
        p.sprite(s.pos, 0.22, SPRITE.dot, [2, 2.6, 2.6]);
        lights.put(s.pos, [0.5, 1.8, 1.6], 7);
        s.extra -= dt;
        let n = 0;
        for (const f of r.foes) {
          if (!f.alive || dist(f.centre, s.pos) > 5.5 || n > 3 || !r.level.collision.clear(s.pos, f.centre)) continue;
          n++;
          r.fx.arc(s.pos, f.centre, 0.06);
          if (s.extra <= 0) f.hurt({ amount: s.damage, kind: "arc", dir: norm(sub(f.centre, s.pos)), point: f.centre, knock: 0.6, stun: 0.15, white: s.white });
        }
        if (s.extra <= 0) ((s.extra = 0.15), n && r.sfx.play("zap", { pos: s.pos, vol: 0.5, rate: rand(0.9, 1.2) }));
        break;
      }
      case "ember":
        p.sprite(s.pos, 0.34, SPRITE.glow, [1.6, 0.5, 0.08]);
        p.sprite(s.pos, 0.17, SPRITE.dot, [2.4, 1.6, 0.7]);
        if (Math.random() < dt * 50) r.fx.flame(s.pos, 0.16, [0, 0.4, 0]);
        lights.put(s.pos, [1.2, 0.45, 0.08], 4);
        break;
      case "bolt":
        p.beam(s.pos, mad(s.pos, norm(s.vel), -1.6), 0.13, SPRITE.beam, [2.2, 0.9, 0.2]);
        p.beam(s.pos, mad(s.pos, norm(s.vel), -0.8), 0.06, SPRITE.beam, [2.4, 2, 1.2]);
        lights.put(s.pos, [1.4, 0.6, 0.15], 4);
        break;
      case "note":
        p.sprite(s.pos, 0.42 + Math.sin(s.age * 12) * 0.06, SPRITE.ring, [0.4, 1.8, 1]);
        p.sprite(s.pos, 0.16, SPRITE.dot, [1.4, 2.4, 1.8]);
        lights.put(s.pos, [0.2, 1, 0.6], 4);
        break;
      case "toll":
        p.sprite(s.pos, 1.1 + Math.sin(s.age * 18) * 0.15, SPRITE.ring, [1.2, 0.8, 0.25]);
        lights.put(s.pos, [1.4, 1, 0.4], 6);
        break;
      case "hook":
        if (s.from?.alive) p.beam(s.from.actor.point("hookR"), s.pos, 0.03, SPRITE.beam, [0.5, 0.9, 0.7], 0.6);
        break;
    }
  }
  clear() {
    for (const s of this.list) s.actor?.dispose();
    this.list = [];
    this.waves = [];
    this.puddles = [];
    this.pillars = [];
  }
}
