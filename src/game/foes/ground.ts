import { SPRITE } from "../gfx/particles";
import { add, clamp, ease, lerp, mul, norm, rand, type V3 } from "../level/vec";
import type { Foe, Kind } from "./foe";

const up = (f: Foe): V3 => [Math.sin(f.yaw), 0, Math.cos(f.yaw)];
/** Legs of a two-legged machine. */
function march(e: Foe, rate: number, swing: number, dt: number) {
  const s = Math.hypot(e.body.vel[0], e.body.vel[2]);
  const k = clamp(s / 3, 0, 1);
  const a = e.actor;
  const w = Math.sin(e.stride * rate);
  const [ll, lr, sl, sr] = ["legL", "legR", "shinL", "shinR"].map((n) => a.part(n)!);
  ll.rx = w * swing * k;
  lr.rx = -w * swing * k;
  sl.rx = Math.max(0, -Math.cos(e.stride * rate)) * swing * 1.1 * k;
  sr.rx = Math.max(0, Math.cos(e.stride * rate)) * swing * 1.1 * k;
  if (!e.body.grounded) ((ll.rx = -0.5), (lr.rx = 0.4), (sl.rx = 0.7), (sr.rx = 0.5));
  a.poses[0].y = Math.abs(Math.cos(e.stride * rate)) * 0.06 * k;
  const before = e.mem.foot ?? 0;
  e.mem.foot = Math.sign(w);
  void dt;
  return before !== e.mem.foot && k > 0.4 && e.body.grounded;
}

export const stoker: Kind = {
  id: "stoker", name: "Stoker", hp: 60, radius: 0.42, height: 1.85, speed: 7, score: 100, mass: 1, sheds: ["stack", "armL"], head: 1.5, voice: "stoker",
  think(e, r, dt) {
    const p = r.player;
    const d = e.range;
    if (e.mood === "hunt") {
      const weave = Math.sin(e.age * 2.3 + e.uid) * (d > 6 ? 0.35 : 0);
      e.walk(dt, this.speed * (d > 5 ? 1.05 : 0.95));
      if (weave) ((e.body.vel[0] += Math.cos(e.yaw) * weave * dt * 14), (e.body.vel[2] -= Math.sin(e.yaw) * weave * dt * 14));
      if (e.sees && d < 2.5 && e.cool < 0) (e.set("windup", "chop"), r.sfx.play("stoker_swing", { pos: e.centre, vol: 0.7, rate: rand(0.95, 1.1) }));
      else if (e.sees && d > 4.5 && d < 9 && e.cool < 0 && e.body.grounded && Math.abs(p.pos[1] - e.pos[1]) < 3 && Math.random() < dt * 1.4) (e.set("windup", "leap"), r.sfx.play("stoker_wake", { pos: e.centre, vol: 0.8, rate: 1.25 }));
    } else if (e.mood === "windup") {
      e.face(p.pos, dt, 10);
      if (e.move === "leap" && e.t > 0.34 / e.pace) {
        const v = norm([p.pos[0] - e.pos[0], 0, p.pos[2] - e.pos[2]]);
        const s = clamp(d * 1.7, 8, 13);
        e.body.vel = [v[0] * s, clamp(5.4 + (p.pos[1] - e.pos[1]) * 1.4, 4, 9), v[2] * s];
        e.body.grounded = false;
        e.set("act", "leap");
      } else if (e.move === "chop" && e.t > 0.27 / e.pace) {
        const f = up(e);
        e.body.vel[0] += f[0] * 5;
        e.body.vel[2] += f[2] * 5;
        e.set("act", "chop");
        e.mem.done = 0;
      }
    } else if (e.mood === "act") {
      if (e.move === "leap") {
        if (!e.mem.done && e.strike(1.7, 15, 7, 0)) e.mem.done = 1;
        if (e.body.grounded && e.t > 0.15) ((e.mem.done = 0), e.set("recover"));
      } else {
        if (!e.mem.done && e.t > 0.06 && e.strike(2.3, 13, 5)) ((e.mem.done = 1), r.sfx.play("slash", { pos: e.centre, vol: 0.8 }));
        if (e.t > 0.28) e.set("recover");
      }
    } else if (e.mood === "recover" && e.t > 0.35 / e.pace) (e.set("hunt"), (e.cool = rand(0.2, 0.7)));
  },
  pose(e, r, dt) {
    const a = e.actor;
    const step = march(e, 2.1, 0.85, dt);
    if (step && e.range < 22) r.sfx.play("step_iron", { pos: e.pos, vol: 0.25, rate: rand(0.9, 1.15) });
    const t = a.part("torso")!;
    const [ar, fr, al, h] = ["armR", "foreR", "armL", "head"].map((n) => a.part(n)!);
    const run = e.mood === "hunt" ? 1 : 0;
    t.rx = 0.18 + run * 0.16 + Math.sin(e.stride * 4.2) * 0.04 - e.flinch * 0.5;
    t.ry = Math.sin(e.stride * 2.1) * 0.18 * run;
    ar.rx = -0.1 - Math.sin(e.stride * 2.1) * 0.25 * run;
    al.rx = -0.4 + Math.sin(e.stride * 2.1) * 0.3 * run;
    h.rx = -0.2 - run * 0.1;
    h.rz = Math.sin(e.age * 3) * 0.08;
    if (e.mood === "windup") {
      const k = ease(16, e.t);
      if (e.move === "chop") ((ar.rx = lerp(-0.2, -2.6, k)), (fr.rx = -0.4 * k), (t.ry = 0.5 * k), (t.rx = -0.15 * k));
      else ((t.rx = 0.7 * k), (a.poses[0].y = -0.22 * k), (al.rx = 0.8 * k), (ar.rx = 0.7 * k));
    } else if (e.mood === "act") {
      if (e.move === "chop") { const k = ease(26, e.t); ar.rx = lerp(-2.6, 0.55, k); t.ry = lerp(0.5, -0.5, k); t.rx = 0.45 * k; } else ((ar.rx = -2.4), (al.rx = -2.1), (t.rx = 0.35));
    }
    a.glow = 1 + Math.sin(e.age * 9) * 0.15 + (e.mood === "windup" ? 1.2 : 0);
    if (Math.random() < dt * 5 && a.part("stack")!.s && e.range < 30) r.fx.smoke(a.point("stack", [0.15, 0.5, -0.1]), 0.14, [0, 1.2, 0], 0.07);
  },
};

export const usher: Kind = {
  id: "usher", name: "Usher", hp: 150, radius: 0.55, height: 2.5, speed: 3.2, score: 250, mass: 0.45, sheds: ["armR"], head: 2.1, voice: "usher",
  start(e) { e.mem.shield = 150; },
  guard(e, hit, r) {
    if (e.mem.shield <= 0 || e.stun > 0 || e.mood === "act" || hit.kind === "burn") return 1;
    const f = up(e);
    if (hit.dir[0] * f[0] + hit.dir[2] * f[2] > -0.35) return 1;
    e.mem.shield -= hit.amount * (hit.kind === "hammer" || hit.kind === "blast" || hit.kind === "slag" ? 1.6 : hit.kind === "blade" ? 1.3 : 1);
    r.fx.spark(hit.point, mul(hit.dir, -1), 8);
    r.sfx.play("shield", { pos: e.centre, vol: 0.8, rate: rand(0.9, 1.1), gap: 0.05 });
    e.actor.flash = Math.max(e.actor.flash, 0.12);
    if (e.mem.shield <= 0) {
      r.fx.shed(e.actor, "shield", add(mul(hit.dir, 4), [0, 5, 0]));
      r.sfx.play("break", { pos: e.centre, vol: 1 });
      e.daze(1.3);
    }
    return 0;
  },
  think(e, r, dt) {
    const p = r.player;
    const d = e.range;
    if (e.mood === "hunt") {
      if (d > 9 || !e.sees) e.walk(dt, this.speed * (d > 20 ? 1.4 : 1), null, 5);
      else {
        e.face(p.pos, dt, 4);
        if (d > 4) e.body.accelerate(Math.cos(e.yaw) * Math.sign(Math.sin(e.age * 0.7 + e.uid)), -Math.sin(e.yaw) * Math.sign(Math.sin(e.age * 0.7 + e.uid)), 1.6, 8, dt);
        else e.walk(dt, this.speed * 1.4);
      }
      if (e.sees && d < 2.6 && e.cool < 0.6) e.set("windup", "bash");
      else if (e.sees && d < 34 && e.cool < 0) (e.set("windup", "bolt"), r.sfx.play("usher_charge", { pos: e.centre, vol: 0.8 }));
    } else if (e.mood === "windup") {
      e.face(p.pos, dt, e.move === "bolt" ? 6 : 8);
      if (e.move === "bolt") {
        const tip = e.actor.point("foreR", [-0.14, -0.22, 1.2]);
        r.stage.particles.sprite(tip, 0.15 + e.t * 0.4, SPRITE.glow, [1.6, 0.6, 0.12]);
        r.stage.lights.put(tip, [1.4 * e.t, 0.5 * e.t, 0.1], 4);
      }
      if (e.t > (e.move === "bolt" ? 0.62 : 0.34) / e.pace) (e.set("act", e.move), (e.mem.shots = 0));
    } else if (e.mood === "act") {
      if (e.move === "bash") {
        if (!e.mem.shots && e.strike(2.8, 14, 13, 0.2)) ((e.mem.shots = 1), r.fx.kick(0.4));
        if (e.t < 0.1) ((e.body.vel[0] += up(e)[0] * dt * 60), (e.body.vel[2] += up(e)[2] * dt * 60));
        if (e.t > 0.4) (e.set("recover"), (e.cool = 0.8));
      } else {
        const n = r.difficulty === 2 ? 3 : 2;
        if (e.mem.shots < n && e.t > e.mem.shots * 0.2) {
          e.mem.shots++;
          const from = e.actor.point("foreR", [-0.14, -0.22, 1.2]);
          r.shots.enemy("bolt", from, e.lead(from, 30, 0.45), e);
          r.sfx.play("usher_fire", { pos: from, vol: 0.9 });
        }
        if (e.t > n * 0.2 + 0.35) (e.set("recover"), (e.cool = rand(1.6, 2.6)));
      }
    } else if (e.mood === "recover" && e.t > 0.3) e.set("hunt");
  },
  pose(e, r, dt) {
    const a = e.actor;
    if (march(e, 1.6, 0.5, dt) && e.range < 26) r.sfx.play("step_heavy", { pos: e.pos, vol: 0.35, rate: rand(1, 1.15) });
    const t = a.part("torso")!;
    const [ar, fr, al, sh] = ["armR", "foreR", "armL", "shield"].map((n) => a.part(n)!);
    t.ry = -0.15; t.rx = 0.06 - e.flinch * 0.3;
    ar.rx = 0.15;
    const open = e.mood === "act" && e.move === "bolt" ? 1 : e.mood === "windup" && e.move === "bolt" ? clamp(e.t * 2.4, 0, 1) : 0;
    e.mem.open = lerp(e.mem.open ?? 0, open, ease(10, dt));
    sh.ry = -0.75 * e.mem.open; sh.x = -0.18 * e.mem.open; al.ry = -0.5 * e.mem.open;
    ar.rx -= 0.2 * e.mem.open; fr.rx = -0.05 * e.mem.open;
    if (e.move === "bash") {
      const k = e.mood === "windup" ? -ease(12, e.t) * 0.3 : e.mood === "act" ? Math.sin(clamp(e.t * 6, 0, 3.14)) * 0.7 : 0;
      sh.z = k; t.rx += k * 0.4;
    }
    if (e.mood === "act" && e.move === "bolt") ar.z = -0.12 * Math.max(0, 1 - ((e.t % 0.2) * 12));
    a.glow = 1 + e.mem.open;
  },
};

export const crucible: Kind = {
  id: "crucible", name: "Crucible", hp: 38, radius: 0.5, height: 1.1, speed: 10, score: 120, mass: 1.3, sheds: [], voice: "crucible",
  think(e, r, dt) {
    const d = e.range;
    if (e.mood === "hunt") {
      e.walk(dt, this.speed * clamp(0.5 + e.t * 0.35, 0.5, 1.1), null, 4);
      if (d < 2.5 && e.sees) (e.set("windup", "fuse"), r.sfx.play("fuse", { pos: e.centre, vol: 1 }));
    } else if (e.mood === "windup") {
      if (e.t > 0.5 / e.pace) e.die({ amount: 60, kind: "blast", dir: [0, 1, 0], point: e.centre, knock: 3 });
    } else if (e.mood === "recover") e.set("hunt");
  },
  onDeath(e, hit, r) {
    r.blast(e.centre, 4.6, hit.kind === "burn" ? 0 : 42, hit.kind === "blast" || hit.kind === "burn" ? null : "player", 150);
  },
  pose(e, r, dt) {
    const a = e.actor;
    const b = a.part("ball")!;
    const s = Math.hypot(e.body.vel[0], e.body.vel[2]);
    e.mem.roll = (e.mem.roll ?? 0) + (s * dt) / 0.5;
    b.rx = e.mem.roll;
    a.poses[0].y = e.body.grounded ? Math.abs(Math.sin(e.mem.roll * 2)) * 0.05 : 0;
    const f = e.mood === "windup" ? e.t * 2 : 0;
    a.scale = 1 + f * 0.28 + Math.sin(e.age * 40) * 0.03 * f;
    a.glow = 1.2 + f * 5 + Math.sin(e.age * 12) * 0.3;
    if (Math.random() < dt * (10 + f * 40)) r.fx.flame(add(e.centre, [rand(-0.3, 0.3), 0.3, rand(-0.3, 0.3)]), 0.16);
    if (s > 3) r.sfx.loop(`roll${e.uid}`, "roll", e.centre, 0.5, 0.7 + s * 0.05);
    r.stage.lights.put(e.centre, [0.9 + f * 2, 0.35, 0.06], 4);
  },
};

export const ringer: Kind = {
  id: "ringer", name: "Bellringer", hp: 560, radius: 1, height: 3.6, speed: 3, score: 800, mass: 0.12, sheds: ["armL"], head: 2.7, voice: "ringer",
  think(e, r, dt) {
    const p = r.player;
    const d = e.range;
    if (e.mood === "hunt") {
      e.walk(dt, this.speed * (d > 16 ? 1.5 : 1), null, 4);
      if (!e.sees) return;
      if (d < 4.4 && e.cool < 0.4) (e.set("windup", "smash"), r.sfx.play("ringer_wind", { pos: e.centre, vol: 1 }));
      else if (d < 17 && e.cool < 0 && Math.abs(p.pos[1] - e.pos[1]) < 2.5) (e.set("windup", Math.random() < 0.55 ? "smash" : "charge"), r.sfx.play("ringer_wind", { pos: e.centre, vol: 1 }));
      else if (d < 45 && e.cool < -0.5) (e.set("windup", "toll"), r.sfx.play("ringer_wind", { pos: e.centre, vol: 1, rate: 0.8 }));
    } else if (e.mood === "windup") {
      e.face(p.pos, dt, e.move === "charge" ? 5 : 3);
      if (e.t > (e.move === "charge" ? 0.7 : 0.78) / e.pace) {
        e.set("act", e.move);
        e.mem.done = 0;
        if (e.move === "smash") {
          const at = add(e.pos, mul(up(e), 2.2));
          r.shots.wave(at, 15, 11, 22, e);
          r.fx.blast(at, 1.6, [1.6, 0.7, 0.2]);
          r.fx.scrap(at, [0, 1, 0], 2, 5);
          r.fx.kick(1, at);
          r.sfx.play("slam", { pos: at, vol: 1.2 });
          e.strike(4.2, 30, 12, 0.3);
        } else if (e.move === "toll") {
          r.sfx.play("bell_big", { pos: e.centre, vol: 1 });
          for (let i = -1; i <= 1; i++) {
            const from = add(e.pos, [0, 3.2, 0]);
            const dir = e.lead(from, 13, 0.4);
            const c = Math.cos(i * 0.2), s = Math.sin(i * 0.2);
            r.shots.enemy("toll", from, [dir[0] * c + dir[2] * s, dir[1], dir[2] * c - dir[0] * s], e);
          }
        }
      }
    } else if (e.mood === "act") {
      if (e.move === "charge") {
        const f = up(e);
        e.face(p.pos, dt, 1.2);
        e.body.accelerate(f[0], f[2], 13 * e.pace, 6, dt);
        r.fx.kick(0.25, e.pos);
        if (!e.mem.done && e.strike(2.2, 26, 15, 0)) e.mem.done = 1;
        if (e.t > 1.2 || (e.t > 0.3 && e.body.bump > 5)) {
          if (e.body.bump > 5) (r.fx.kick(0.8, e.pos), r.sfx.play("slam", { pos: e.centre, vol: 1 }), e.daze(1.2));
          else e.set("recover");
          e.cool = rand(1.2, 2);
        }
      } else if (e.t > 0.5) (e.set("recover"), (e.cool = rand(1.1, 2)));
    } else if (e.mood === "recover" && e.t > 0.5 / e.pace) e.set("hunt");
  },
  pose(e, r, dt) {
    const a = e.actor;
    if (march(e, 1.15, 0.5, dt) && e.range < 40) (r.sfx.play("step_heavy", { pos: e.pos, vol: 0.8, rate: 0.8 }), r.fx.kick(0.18, e.pos));
    const t = a.part("torso")!;
    const [ar, fr, al, b] = ["armR", "foreR", "armL", "bell"].map((n) => a.part(n)!);
    e.mem.swing = (e.mem.swing ?? 0) + (Math.sin(e.age * 2.2) * 0.1 - (e.mem.swing ?? 0)) * ease(4, dt);
    b.rz = e.mem.swing + e.flinch * 0.2 * Math.sin(e.age * 30);
    t.rx = 0.08; ar.rx = 0.1 + Math.sin(e.stride * 1.15) * 0.15; al.rx = 0.1 - Math.sin(e.stride * 1.15) * 0.2;
    if (e.mood === "windup") {
      const k = ease(7, e.t);
      if (e.move === "smash") ((ar.rx = -2.7 * k), (al.rx = -2.2 * k), (t.rx = -0.25 * k), (fr.rx = -0.3 * k));
      if (e.move === "charge") ((t.rx = 0.5 * k), (ar.rx = 0.9 * k), (al.rx = 0.9 * k), (a.poses[0].y = -0.15 * k));
      if (e.move === "toll") ((b.rz = Math.sin(e.t * 9) * 0.6 * k), (ar.rx = -2.1 * k), (al.rx = -2.1 * k));
    } else if (e.mood === "act") {
      if (e.move === "smash") { const k = ease(22, e.t); ar.rx = lerp(-2.7, 0.35, k); al.rx = lerp(-2.2, 0.2, k); t.rx = 0.5 * k; }
      if (e.move === "charge") ((t.rx = 0.55), (ar.rx = 0.9), (al.rx = 0.9));
      if (e.move === "toll") ((ar.rx = -2.1), (al.rx = -2.1), (b.rz = Math.sin(e.t * 20) * 0.4 * (1 - e.t)));
    }
    a.glow = 1 + (e.mood === "windup" ? e.t * 3 : 0);
  },
};
