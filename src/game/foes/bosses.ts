import { SPRITE } from "../gfx/particles";
import { add, clamp, ease, lerp, mul, norm, pick, rand, sub, type V3 } from "../level/vec";
import type { Foe, Kind } from "./foe";

const front = (e: Foe): V3 => [Math.sin(e.yaw), 0, Math.cos(e.yaw)];

/** Four legs, a saw tail and a furnace heart on its back. */
export const mainspring: Kind = {
  id: "mainspring", name: "The Mainspring", hp: 1900, radius: 1.5, height: 3.4, speed: 5, score: 4000, mass: 0, boss: true, sheds: [], voice: "boss",
  guard(e, hit) {
    if (e.stun > 0) return 1.5;
    if (hit.point[1] - e.pos[1] > 2.9) return 1.7;
    return 0.75;
  },
  start(e) { e.mem.phase = 0; },
  think(e, r, dt) {
    const p = r.player;
    const d = e.range;
    const share = e.hp / (this.hp * r.rules.hp);
    const phase = share < 0.34 ? 2 : share < 0.67 ? 1 : 0;
    if (phase > e.mem.phase && e.mood === "hunt") {
      e.mem.phase = phase;
      e.set("windup", "roar");
      r.sfx.play("boss_roar", { pos: e.centre, vol: 1.2 });
      r.live.fire(`phase${phase}`);
    }
    const rate = e.pace * (1 + phase * 0.18);
    if (e.mood === "hunt") {
      e.walk(dt, this.speed * (1 + phase * 0.15) * (d < 5 ? 0.4 : 1), null, 3);
      if (e.cool > 0 || !e.sees) return;
      const near = d < 6.5;
      const move = near ? pick(["stomp", "stomp", "spin"]) : d > 12 ? pick(["leap", "saws", "saws"]) : pick(["saws", "leap", "spin", "stomp"]);
      e.set("windup", move);
      r.sfx.play("boss_wind", { pos: e.centre, vol: 1, rate: move === "saws" ? 1.3 : 1 });
    } else if (e.mood === "windup") {
      e.face(p.pos, dt, 3);
      const time = e.move === "roar" ? 1 : e.move === "leap" ? 0.75 : 0.62;
      if (e.move === "roar") r.fx.kick(0.3, e.pos);
      if (e.t > time / rate) {
        e.set(e.move === "roar" ? "recover" : "act", e.move);
        e.mem.n = 0;
        if (e.move === "leap") {
          const f = norm([p.pos[0] - e.pos[0], 0, p.pos[2] - e.pos[2]]);
          const s = clamp(d * 0.9, 6, 17);
          e.body.vel = [f[0] * s, 11.5, f[2] * s];
          e.body.grounded = false;
        }
      }
    } else if (e.mood === "act") {
      if (e.move === "stomp") {
        const times = 1 + phase;
        if (e.mem.n < times && e.t > e.mem.n * 0.55 + 0.1) {
          e.mem.n++;
          const at = add(e.pos, mul(front(e), 2));
          r.shots.wave(at, 18, 12, 22, e);
          r.fx.blast(at, 1.8, [1.6, 0.7, 0.2]);
          r.fx.kick(1, at);
          r.sfx.play("slam", { pos: at, vol: 1.2 });
          e.strike(4.6, 24, 12, -0.2);
        }
        if (e.t > times * 0.55 + 0.35) e.set("recover");
      } else if (e.move === "saws") {
        const n = 3 + phase * 2;
        if (e.mem.n < n && e.t > e.mem.n * 0.17) {
          const from = add(e.pos, [0, 2.4, 0]);
          const aim = e.lead(from, 17, 0.5);
          const a = (e.mem.n - (n - 1) / 2) * 0.16;
          const c = Math.cos(a), s = Math.sin(a);
          r.shots.enemy("saw", add(from, mul(aim, 1.6)), [aim[0] * c + aim[2] * s, aim[1] * 0.9, aim[2] * c - aim[0] * s], e);
          r.sfx.play("blade", { pos: from, vol: 0.9, rate: 0.8 });
          e.mem.n++;
        }
        if (e.t > n * 0.17 + 0.4) e.set("recover");
      } else if (e.move === "spin") {
        e.yaw += dt * 9 * rate;
        const f = norm(sub(p.pos, e.pos));
        e.body.accelerate(f[0], f[2], 7.5 * rate, 5, dt);
        e.mem.n -= dt;
        if (e.mem.n <= 0 && e.strike(4, 16, 10, -1.1)) e.mem.n = 0.6;
        r.sfx.loop("bossspin", "roll", e.centre, 0.9, 0.6);
        if (e.t > 1.7) e.set("recover");
      } else if (e.move === "leap" && e.body.grounded && e.t > 0.3) {
        r.shots.wave(e.pos, 16, 12, 24, e);
        r.fx.blast(e.pos, 2.4, [1.6, 0.7, 0.2]);
        r.fx.scrap(e.pos, [0, 1, 0], 4, 6);
        r.fx.kick(1.2, e.pos);
        r.sfx.play("slam", { pos: e.pos, vol: 1.3, rate: 0.85 });
        e.strike(4, 26, 13, -1.1);
        e.set("recover");
      }
    } else if (e.mood === "recover" && e.t > 0.7 / rate) (e.set("hunt"), (e.cool = rand(0.7, 1.3) / rate));
  },
  onDeath(e, _h, r) {
    for (let i = 0; i < 5; i++) r.later(i * 0.25, () => (r.fx.blast(add(e.centre, [rand(-2, 2), rand(-1, 1.5), rand(-2, 2)]), 3), r.sfx.play("explode", { pos: e.centre, vol: 1 })));
  },
  pose(e, r, dt) {
    const a = e.actor;
    const s = Math.hypot(e.body.vel[0], e.body.vel[2]);
    const k = clamp(s / 3, 0, 1);
    for (let i = 0; i < 4; i++) {
      const ph = e.stride * 1.3 + (i % 2) * 3.14;
      const l = a.part(`leg${i}`)!;
      const sh = a.part(`shin${i}`)!;
      l.y = Math.max(0, Math.sin(ph)) * 0.45 * k; l.ry = Math.cos(ph) * 0.3 * k;
      sh.rx = Math.cos(ph) * 0.2 * k;
      if (!e.body.grounded) ((l.y = 0.2), (sh.rx = 0.3));
      const was = e.mem[`f${i}`] ?? 0;
      e.mem[`f${i}`] = Math.sign(Math.sin(ph));
      if (was > 0 && e.mem[`f${i}`] < 0 && k > 0.4) (r.sfx.play("step_heavy", { pos: e.pos, vol: 0.6, rate: 0.9 }), r.fx.kick(0.15, e.pos));
    }
    const b = a.part("body")!;
    b.y = Math.sin(e.stride * 2.6) * 0.08 * k;
    const w = e.mood === "windup" ? ease(6, e.t) : 0;
    if (e.move === "stomp") ((b.rx = e.mood === "windup" ? -0.4 * w : e.mood === "act" ? 0.3 * Math.max(0, 1 - (e.t % 0.55) * 4) : 0), (b.y += w * 0.4));
    if (e.move === "leap") b.y += e.mood === "windup" ? -0.6 * w : 0;
    if (e.move === "roar" && e.mood === "windup") ((b.rx = -0.3), (b.rz = Math.sin(e.t * 40) * 0.06));
    a.part("saw")!.rz = Math.sin(e.age * 1.5) * 0.2;
    a.part("saw")!.rx = e.mood === "act" && e.move === "saws" ? Math.sin(e.t * 18) * 0.5 : -0.2;
    a.part("core")!.ry = e.age * 2; a.part("core")!.s = 1 + Math.sin(e.age * 6) * 0.06 + (e.stun > 0 ? 0.25 : 0);
    const h = a.part("head")!;
    h.rx = Math.sin(e.age * 2) * 0.08; h.ry = Math.sin(e.age * 1.1) * 0.15;
    a.glow = 1.1 + e.mem.phase * 0.5 + w * 1.5;
    r.stage.lights.put(add(e.pos, [0, 3.6, 0]), [2.2, 0.9, 0.2], 8);
    if (Math.random() < dt * (6 + e.mem.phase * 12)) r.fx.flame(add(e.pos, [rand(-0.6, 0.6), 3.5, rand(-0.6, 0.6)]), 0.35);
  },
};

/** Grown into the Great Organ: stays in place, strikes the floor, opens its chest when spent. */
export const cantor: Kind = {
  id: "cantor", name: "The Cantor", hp: 4200, radius: 3, height: 11, speed: 0, score: 12000, mass: 0, boss: true, sheds: [], voice: "boss",
  guard(e) {
    return (e.mem.open ?? 0) > 0.5 ? 1.8 : 0.35;
  },
  start(e) { e.mem.phase = 0; e.mem.beats = 0; e.cool = 2.5; e.mem.baseY = e.body.pos[1]; },
  think(e, r, dt) {
    const p = r.player;
    const share = e.hp / (this.hp * r.rules.hp);
    const phase = share < 0.34 ? 2 : share < 0.67 ? 1 : 0;
    const rate = e.pace * (1 + phase * 0.16);
    e.mem.openT = (e.mem.openT ?? 0) - dt;
    e.mem.open = lerp(e.mem.open ?? 0, e.mem.openT > 0 ? 1 : 0, ease(5, dt));
    const want = Math.atan2(p.pos[0] - e.pos[0], p.pos[2] - e.pos[2]);
    e.mem.home ??= e.yaw;
    e.yaw += clamp(Math.atan2(Math.sin(want - e.yaw), Math.cos(want - e.yaw)), -0.5, 0.5) * ease(1.2, dt);
    e.yaw = clamp(e.yaw, e.mem.home - 0.45, e.mem.home + 0.45);
    if (e.mood === "hunt") {
      if (phase > e.mem.phase) {
        e.mem.phase = phase;
        e.set("windup", "roar");
        r.sfx.play("boss_roar", { pos: e.centre, vol: 1.3, rate: 0.75 });
        r.live.fire(`phase${phase}`);
        return;
      }
      if (e.cool > 0) return;
      if (e.mem.beats >= 4) {
        e.mem.beats = 0;
        e.mem.openT = 6.5;
        e.cool = 4.6;
        r.sfx.play("boss_open", { pos: e.centre, vol: 1.2 });
        r.say("The heart is open", 2.5);
        return;
      }
      e.mem.beats++;
      const list = ["slamL", "slamR", "pillars", "fan", "pillars", "both"];
      let m = pick(list);
      if (m === e.move) m = pick(list);
      if (phase === 0 && m === "both") m = "fan";
      e.set("windup", m);
      e.mem.ax = p.pos[0];
      e.mem.az = p.pos[2];
      r.sfx.play(m.startsWith("slam") || m === "both" ? "boss_wind" : "organ_stab", { pos: e.centre, vol: 1.1, rate: m === "fan" ? 1.2 : 0.9 });
      if (m === "pillars") this.mem_pillars(e, r, phase);
    } else if (e.mood === "windup") {
      const time = e.move === "roar" ? 1.6 : e.move === "pillars" ? 0.7 : e.move === "fan" ? 0.7 : 0.95;
      if (e.move === "roar") r.fx.kick(0.5);
      if (e.move !== "pillars" && e.move !== "fan" && e.move !== "roar") for (const at of this.marks(e)) {
        r.stage.particles.ground(add(at, [0, 0.06, 0]), 3.2, SPRITE.wave, [1.4, 0.4, 0.06], 1, 1);
        r.stage.particles.ground(add(at, [0, 0.05, 0]), 3.2 * clamp(e.t / time, 0, 1), SPRITE.soft, [0.8, 0.2, 0.03], 1, 1);
      }
      if (e.t > time / rate) {
        e.set(e.move === "roar" ? "recover" : "act", e.move);
        e.mem.n = 0;
      }
    } else if (e.mood === "act") {
      if (e.move.startsWith("slam") || e.move === "both") {
        if (!e.mem.n && e.t > 0.12) {
          e.mem.n = 1;
          for (const at of this.marks(e)) {
            r.shots.wave(at, 22, 13, 20, e);
            r.fx.blast(at, 3, [1.8, 0.7, 0.15]);
            r.fx.scrap(at, [0, 1, 0], 3, 7);
            r.sfx.play("slam", { pos: at, vol: 1.3, rate: 0.75 });
            r.fx.kick(1.2, at);
            const q = p.pos;
            if (Math.hypot(q[0] - at[0], q[2] - at[2]) < 3.2 && q[1] - at[1] < 2.5) p.hurt(32, at, mul(norm([q[0] - at[0], 1.2, q[2] - at[2]]), 11));
          }
        }
        if (e.t > 0.9) e.set("recover");
      } else if (e.move === "fan") {
        const volleys = 2 + phase;
        if (e.mem.n < volleys && e.t > e.mem.n * 0.42) {
          const from = add(e.pos, [front(e)[0] * 3.4, 7.2, front(e)[2] * 3.4]);
          const aim = e.lead(from, 16, 0.4);
          const n = 9;
          for (let i = 0; i < n; i++) {
            const a = (i - (n - 1) / 2) * 0.15 + (e.mem.n % 2) * 0.075;
            const c = Math.cos(a), s = Math.sin(a);
            r.shots.enemy("ember", from, [aim[0] * c + aim[2] * s, aim[1], aim[2] * c - aim[0] * s], e);
          }
          r.sfx.play("ember", { pos: from, vol: 1, rate: 0.7 });
          e.mem.n++;
        }
        if (e.t > volleys * 0.42 + 0.3) e.set("recover");
      } else if (e.t > 1) e.set("recover");
    } else if (e.mood === "recover" && e.t > 0.4) (e.set("hunt"), (e.cool = rand(0.5, 1) / rate));
  },
  onDeath(e, _h, r) {
    for (let i = 0; i < 12; i++) r.later(i * 0.22, () => (r.fx.blast(add(e.pos, [rand(-4, 4), rand(1, 10), rand(0, 3) * front(e)[2]]), 4), r.sfx.play("explode", { pos: e.centre, vol: 1, rate: rand(0.7, 1) }), r.fx.kick(0.8)));
  },
  pose(e, r, dt) {
    const a = e.actor;
    a.yaw = e.yaw;
    const t = a.part("torso")!;
    const open = e.mem.open ?? 0;
    const breathe = Math.sin(e.age * 1.6);
    t.y = breathe * 0.12; t.rx = open * 0.12;
    a.part("head")!.rx = -0.08 + breathe * 0.03 + open * 0.25;
    a.part("jaw")!.rx = e.mood === "windup" || e.move === "fan" ? 0.35 : 0.08 + Math.abs(breathe) * 0.08;
    a.part("gateL")!.ry = open * 1.9; a.part("gateR")!.ry = -open * 1.9;
    a.part("core")!.s = 0.8 + open * 0.35 + Math.sin(e.age * 8) * 0.06;
    for (const [n, s] of [["L", -1], ["R", 1]] as const) {
      const arm = a.part(`arm${n}`)!;
      const fore = a.part(`fore${n}`)!;
      const mine = e.move === `slam${n}` || e.move === "both";
      let up = 0;
      if (mine && e.mood === "windup") up = ease(5, e.t);
      if (mine && e.mood === "act") up = e.t < 0.12 ? 1 - e.t / 0.12 * 1.35 : -0.35 * Math.max(0, 1 - (e.t - 0.3) * 1.6);
      arm.rx = -up * 1.5 + breathe * 0.05 + (e.move === "roar" && e.mood === "windup" ? -0.8 : 0);
      arm.ry = mine && e.mood !== "recover" ? s * 0.0 : 0;
      fore.rx = -up * 0.5;
      arm.rz = s * (0.06 + breathe * 0.02 + open * 0.2);
    }
    a.glow = 1 + (e.mem.phase ?? 0) * 0.4 + (e.mood === "windup" ? 0.8 : 0) + open;
    r.stage.lights.put(add(e.pos, [front(e)[0] * 4.5, 4, front(e)[2] * 4.5]), mul([2.6, 1.1, 0.3], 0.5 + open * 1.4), 9 + open * 4);
    if (open > 0.5) for (let i = 0; i < 2; i++) r.fx.flame(add(e.pos, [front(e)[0] * 3.6 + rand(-0.8, 0.8), 4 + rand(-0.8, 0.8), front(e)[2] * 3.6]), 0.4, mul(front(e), 2));
    void dt;
  },
  marks(e: Foe): V3[] {
    const f = front(e);
    const side: V3 = [f[2], 0, -f[0]];
    const y = e.mem.floor ?? e.pos[1];
    const reach = clamp(Math.hypot(e.mem.ax - e.pos[0], e.mem.az - e.pos[2]), 6, 13);
    const at = (s: number): V3 => {
      const base = add(e.pos, add(mul(f, reach), mul(side, s * 3.4)));
      return [base[0], y, base[2]];
    };
    if (e.move === "both") return [at(-1), at(1)];
    return [[e.mem.ax, y, e.mem.az]];
  },
  mem_pillars(e: Foe, r: Foe["r"], phase: number) {
    const p = r.player;
    const y = e.mem.floor ?? p.pos[1];
    const mode = Math.random();
    if (mode < 0.5) for (let i = 0; i < 5 + phase * 2; i++) r.shots.pillar([p.pos[0] + p.body.vel[0] * i * 0.18 + (i ? rand(-1.5, 1.5) : 0), y, p.pos[2] + p.body.vel[2] * i * 0.18 + (i ? rand(-1.5, 1.5) : 0)], 0.75 + i * 0.22);
    else for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283 + rand(0, 0.5); r.shots.pillar([p.pos[0] + Math.sin(a) * 5, y, p.pos[2] + Math.cos(a) * 5], 0.9 + i * 0.06); }
  },
} as Kind & { marks(e: Foe): V3[]; mem_pillars(e: Foe, r: Foe["r"], phase: number): void };
