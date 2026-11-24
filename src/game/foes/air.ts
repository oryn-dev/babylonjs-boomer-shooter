import { SPRITE } from "../gfx/particles";
import { add, clamp, ease, lerp, mul, norm, rand, sub, type V3 } from "../level/vec";
import type { Kind } from "./foe";

export const censer: Kind = {
  id: "censer", name: "Censer", hp: 52, radius: 0.5, height: 1.5, speed: 6.5, score: 130, mass: 1.4, fly: true, sheds: ["ring", "lid"], voice: "censer",
  start(e) { e.mem.side = Math.random() < 0.5 ? -1 : 1; e.mem.orbit = rand(8, 13); e.body.pos[1] += 1.2; },
  think(e, r, dt) {
    const p = r.player;
    const d = e.range;
    if (e.mood === "hunt" || e.mood === "recover") {
      const flat = sub(e.centre, p.centre);
      const l = Math.hypot(flat[0], flat[2]) || 1;
      const a = Math.atan2(flat[0], flat[2]) + e.mem.side * 0.5;
      const to: V3 = e.sees ? [p.centre[0] + Math.sin(a) * e.mem.orbit, p.centre[1] + 1.6 + Math.sin(e.age * 1.3 + e.uid) * 0.9, p.centre[2] + Math.cos(a) * e.mem.orbit] : p.centre;
      void l;
      e.glide(dt, to, this.speed * (d > 18 ? 1.3 : 1));
      e.face(p.pos, dt, 6);
      if (Math.random() < dt * 0.4) e.mem.side *= -1;
      if (e.mood === "recover" && e.t > 0.4) e.set("hunt");
      if (e.mood === "hunt" && e.sees && e.seenFor > 0.4 && d < 30 && e.cool < 0) (e.set("windup"), r.sfx.play("censer_charge", { pos: e.centre, vol: 0.7 }));
    } else if (e.mood === "windup") {
      e.glide(dt, e.centre, 1, 5);
      e.face(p.pos, dt, 9);
      if (e.t > 0.5 / e.pace) (e.set("act"), (e.mem.n = 0));
    } else if (e.mood === "act") {
      e.face(p.pos, dt, 6);
      const n = r.difficulty === 2 ? 4 : 3;
      if (e.mem.n < n && e.t > e.mem.n * 0.16) {
        e.mem.n++;
        const from = add(e.centre, mul(norm(e.toPlayer), 0.5));
        const aim = e.lead(from, 16, 0.5);
        r.shots.enemy("ember", from, norm(add(aim, [rand(-0.05, 0.05), rand(-0.02, 0.04), rand(-0.05, 0.05)])), e);
        r.sfx.play("ember", { pos: from, vol: 0.6, rate: rand(0.9, 1.1) });
        e.body.vel = add(e.body.vel, mul(aim, -2.2));
      }
      if (e.t > n * 0.16 + 0.2) (e.set("recover"), (e.cool = rand(1.5, 2.6)));
    }
  },
  pose(e, r, dt) {
    const a = e.actor;
    const c = e.mood === "windup" ? ease(6, e.t) : 0;
    const v = e.body.vel;
    const side = v[0] * Math.cos(e.yaw) - v[2] * Math.sin(e.yaw);
    const fwd = v[0] * Math.sin(e.yaw) + v[2] * Math.cos(e.yaw);
    a.pos = [e.pos[0], e.pos[1] + 0.75 + Math.sin(e.age * 2.4) * 0.08, e.pos[2]];
    const b = a.part("body")!;
    b.rx = clamp(fwd * 0.04, -0.4, 0.4) - e.flinch * 0.6; b.rz = clamp(-side * 0.05, -0.4, 0.4);
    a.part("ring")!.ry = e.age * (2 + c * 10);
    a.part("ring")!.rx = Math.sin(e.age * 1.7) * 0.12;
    a.part("lid")!.y = 0.04 + c * 0.22 + (e.mood === "act" ? 0.15 : 0);
    for (let i = 0; i < 3; i++) { const p = a.part(`chain${i}`)!; p.rx = Math.sin(e.age * 3 + i * 2) * 0.25 - fwd * 0.06; p.rz = Math.cos(e.age * 2.6 + i) * 0.25 + side * 0.06; }
    a.glow = 1 + c * 2.5;
    if (Math.random() < dt * 9 && e.range < 35) r.fx.smoke(add(a.pos, [0, 0.4, 0]), 0.12, [0, 0.8, 0], 0.16);
    if (c) r.stage.particles.sprite(add(a.pos, mul(norm(e.toPlayer), 0.55)), c * 0.4, SPRITE.glow, [1.8, 0.6, 0.12]);
    r.stage.lights.put(a.pos, [0.7 + c, 0.28 + c * 0.3, 0.06], 4);
  },
};

export const deacon: Kind = {
  id: "deacon", name: "Wire Deacon", hp: 110, radius: 0.5, height: 2.4, speed: 4.6, score: 220, mass: 0.7, sheds: ["armL", "spool"], head: 2, voice: "deacon",
  think(e, r, dt) {
    const p = r.player;
    const d = e.range;
    if (e.mood === "hunt") {
      if (!e.sees || d > 15) e.walk(dt, this.speed);
      else {
        e.face(p.pos, dt, 6);
        const s = Math.sign(Math.sin(e.age * 0.9 + e.uid * 1.7));
        const back = d < 7 ? -1 : 0;
        e.body.accelerate(Math.cos(e.yaw) * s * 0.8 + Math.sin(e.yaw) * back, -Math.sin(e.yaw) * s * 0.8 + Math.cos(e.yaw) * back, this.speed * e.pace, 6, dt);
      }
      if (e.sees && d < 2.6 && e.cool < 0.8) e.set("windup", "slash");
      else if (e.sees && e.seenFor > 0.5 && d > 4 && d < 26 && e.cool < 0) (e.set("windup", "hook"), r.sfx.play("deacon_wind", { pos: e.centre, vol: 0.9 }));
    } else if (e.mood === "windup") {
      e.face(p.pos, dt, 9);
      if (e.t > (e.move === "hook" ? 0.62 : 0.26) / e.pace) {
        e.set("act", e.move);
        e.mem.done = 0;
        if (e.move === "hook") {
          const from = e.actor.point("hookR");
          r.shots.hook(from, e.lead(from, 30, 0.6), e);
          r.sfx.play("wire", { pos: from, vol: 1 });
        }
      }
    } else if (e.mood === "act") {
      if (e.move === "hook") {
        e.face(p.pos, dt, 6);
        if (e.mem.reel) {
          if (d < 2.6) (e.set("windup", "slash"), (e.mem.reel = 0));
          else if (e.t > 2) (e.set("recover"), (e.mem.reel = 0));
        } else if (e.t > 1.3) (e.set("recover"), (e.cool = rand(1.8, 2.8)));
      } else {
        if (!e.mem.done && e.t > 0.05 && e.strike(2.7, 18, 8)) ((e.mem.done = 1), r.sfx.play("slash", { pos: e.centre, vol: 0.9 }));
        if (e.t > 0.35) (e.set("recover"), (e.cool = rand(1.4, 2.2)));
      }
    } else if (e.mood === "recover" && e.t > 0.4) e.set("hunt");
  },
  pose(e, r, dt) {
    const a = e.actor;
    const bob = Math.sin(e.age * 2) * 0.06;
    a.poses[0].y = 0.12 + bob;
    const v = e.body.vel;
    const fwd = v[0] * Math.sin(e.yaw) + v[2] * Math.cos(e.yaw);
    a.poses[0].rx = clamp(fwd * 0.035, -0.2, 0.25);
    const t = a.part("torso")!;
    const [al, ar, fr, hr, s, h] = ["armL", "armR", "foreR", "hookR", "spool", "head"].map((n) => a.part(n)!);
    s.rx = e.mem.spin = (e.mem.spin ?? 0) + dt * (e.mood === "windup" ? 22 : e.mood === "act" ? -30 : 2);
    h.ry = Math.sin(e.age * 1.4) * 0.3; h.rz = Math.sin(e.age * 0.9) * 0.15;
    al.rx = Math.sin(e.age * 1.6) * 0.15; ar.rx = -Math.sin(e.age * 1.6) * 0.15;
    t.rx = -e.flinch * 0.5;
    if (e.mood === "windup") { const k = ease(9, e.t); ar.rx = lerp(0, e.move === "hook" ? -2.4 : -1.6, k); al.rx = e.move === "slash" ? -1.6 * k : 0.3 * k; t.ry = 0.5 * k; hr.rz = Math.sin(e.age * 30) * 0.3 * k; a.glow = 1 + k * 2; }
    else if (e.mood === "act") { const k = ease(20, e.t); ar.rx = lerp(-2.4, e.move === "hook" ? -1.4 : 0.4, k); al.rx = e.move === "slash" ? lerp(-1.6, 0.5, k) : 0; t.ry = lerp(0.5, -0.4, k); fr.rx = -0.2; a.glow = 1; hr.s = e.move === "hook" && !e.mem.reel && e.t < 0.9 ? 0.001 : 1; }
    else a.glow = 1;
    if (Math.random() < dt * 3) r.stage.particles.spawn(add(e.centre, [rand(-0.3, 0.3), -0.8, rand(-0.3, 0.3)]), { vel: [0, 0.5, 0], color: [0.2, 0.7, 0.4], life: 0.6, size: 0.03 });
  },
};

export const choir: Kind = {
  id: "choir", name: "Choir Tower", hp: 240, radius: 0.85, height: 3, speed: 1.7, score: 350, mass: 0.15, sheds: ["halo"], voice: "choir",
  think(e, r, dt) {
    const d = e.range;
    e.mem.sing = (e.mem.sing ?? 0) - dt;
    if (e.mem.sing <= 0) {
      e.mem.sing = 0.5;
      for (const f of r.foes) if (f !== e && f.alive && !f.kind.boss && f.kind.id !== "choir" && Math.hypot(f.pos[0] - e.pos[0], f.pos[2] - e.pos[2]) < 15 && Math.abs(f.pos[1] - e.pos[1]) < 8) ((f.buff = 0.8), f.alert());
    }
    for (const f of r.foes) if (f.buff > 0 && f.alive && f !== e && Math.hypot(f.pos[0] - e.pos[0], f.pos[2] - e.pos[2]) < 15) r.stage.particles.beam(add(e.pos, [0, 2.3, 0]), f.centre, 0.05, SPRITE.beam, [0.06, 0.35, 0.2]);
    if (e.mood === "hunt") {
      if (d > 14 || !e.sees) e.walk(dt, this.speed, null, 2);
      if (e.sees && d < 32 && e.cool < 0) (e.set("windup"), r.sfx.play("choir_sing", { pos: e.centre, vol: 0.9, rate: rand(0.95, 1.05) }));
    } else if (e.mood === "windup") {
      if (e.t > 0.6 / e.pace) {
        for (let i = 0; i < 3; i++) {
          const a = e.yaw + e.mem.turn! + (i * 2.094);
          const dir: V3 = [Math.sin(a), 0.35, Math.cos(a)];
          r.shots.enemy("note", add(e.pos, [dir[0] * 0.7, 1.4, dir[2] * 0.7]), norm(dir), e);
        }
        e.set("act");
      }
    } else if (e.mood === "act" && e.t > 0.5) (e.set("recover"), (e.cool = rand(2, 3)));
    else if (e.mood === "recover" && e.t > 0.3) e.set("hunt");
  },
  pose(e, r, dt) {
    const a = e.actor;
    e.mem.turn = (e.mem.turn ?? 0) + dt * (e.mood === "windup" ? 4 : 0.7);
    a.part("torso")!.ry = e.mem.turn;
    a.part("halo")!.ry = -e.mem.turn * 2; a.part("halo")!.y = Math.sin(e.age * 2) * 0.12;
    const s = Math.hypot(e.body.vel[0], e.body.vel[2]);
    for (let i = 0; i < 4; i++) { const p = a.part(`leg${i}`)!; p.rx = Math.sin(e.stride * 4 + i * 1.57) * 0.25 * clamp(s, 0, 1); p.rz = Math.cos(e.stride * 4 + i * 1.57) * 0.15 * clamp(s, 0, 1); }
    a.poses[0].y = Math.sin(e.age * 3) * 0.04;
    for (let i = 0; i < 3; i++) a.part(`face${i}`)!.y = e.mood === "windup" ? Math.sin(e.age * 40) * 0.02 : 0;
    a.glow = 1 + (e.mood === "windup" ? e.t * 4 : Math.sin(e.age * 4) * 0.2);
    r.stage.lights.put(add(e.pos, [0, 1.6, 0]), [0.2, 0.8, 0.5], 5);
    r.sfx.loop(`choir${e.uid}`, "choir", e.centre, 0.55, 1);
  },
};
