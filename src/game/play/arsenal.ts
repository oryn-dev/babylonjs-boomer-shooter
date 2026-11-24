import type { Actor } from "../gfx/actor";
import type { Foe } from "../foes/foe";
import { SPRITE } from "../gfx/particles";
import { add, clamp, dist, ease, lerp, mad, mul, norm, rand, sub, type V3 } from "../level/vec";
import { num } from "../tune";
import type { Intent } from "./controls";
import type { Player } from "./player";
import type { Run } from "./run";
import { AMMO_OF, WEAPONS, type WeaponId } from "./types";

interface View { at: V3; tip: V3; kick: number; rise: number }
const VIEW: Record<WeaponId, View> = {
  rivet: { at: [0.25, -0.24, 0.6], tip: [0, 0.045, 0.48], kick: 0.09, rise: 0.16 },
  bellows: { at: [0.22, -0.26, 0.5], tip: [0, 0.05, 0.7], kick: 0.2, rise: 0.3 },
  chainsaw: { at: [0.22, -0.27, 0.5], tip: [0, 0.06, 0.66], kick: 0.13, rise: 0.12 },
  arclance: { at: [0.23, -0.25, 0.48], tip: [0, 0.02, 0.8], kick: 0.02, rise: 0.02 },
  mortar: { at: [0.25, -0.3, 0.5], tip: [0, 0.03, 0.56], kick: 0.2, rise: 0.3 },
  bellgun: { at: [0.26, -0.32, 0.62], tip: [0, 0.07, 0.5], kick: 0.28, rise: 0.4 },
};
export const WHITE = 75;

/** The weapons in hand: heat, firing, the second fire, the hammer, and how all of it looks. */
export class Arsenal {
  heat: Record<WeaponId, number> = { rivet: 0, bellows: 0, chainsaw: 0, arclance: 0, mortar: 0, bellgun: 0 };
  venting = 0;
  ventWeapon: WeaponId | null = null;
  current: WeaponId;
  private next: WeaponId;
  private swap = 1;
  private wait = 0;
  private sinceShot = 9;
  private gun: Actor;
  private hammer: Actor;
  private swing = 0;
  private swung = false;
  private hammerWait = 0;
  private back = 0;
  private backVel = 0;
  private rise = 0;
  private riseVel = 0;
  private spin = 0;
  private spinVel = 0;
  private pump = 0;
  private charge = 0;
  private altHeld = false;
  private fireHeld = false;
  private dry = 0;
  private sink = 0;
  /** Beam end for drawing the lance. */
  private beam: { to: V3; chain: V3[] } | null = null;
  shots = 0;
  hits = 0;

  constructor(private r: Run, private p: Player, weapon: WeaponId) {
    this.current = this.next = weapon;
    this.gun = r.stage.actor(weapon, 1);
    this.hammer = r.stage.actor("hammer", 1);
    this.hammer.mesh.setEnabled(false);
    for (const a of [this.gun, this.hammer]) ((a.fogScale = 0), (a.rim = 0.7));
  }
  get whiteHeat() {
    return (this.p.blessed > 0 || this.heat[this.current] >= WHITE) && this.venting <= 0;
  }
  get heatShown() {
    return this.venting > 0 && this.ventWeapon === this.current ? this.venting / 1.2 : this.heat[this.current] / 100;
  }
  get boost() {
    return this.whiteHeat ? num("white_heat_boost", 1.6) : 1;
  }
  select(w: WeaponId) {
    if (!this.p.owned.includes(w) || (w === this.next && this.swap >= 1)) return;
    if (this.next !== w) this.r.sfx.play("swap", { vol: 0.35 });
    this.next = w;
    this.charge = 0;
  }
  drop() {
    this.gun.mesh.setEnabled(false);
    this.hammer.mesh.setEnabled(false);
  }
  dispose() {
    this.gun.dispose();
    this.hammer.dispose();
  }
  private addHeat(n: number) {
    if (this.p.blessed > 0) return;
    const w = this.current;
    const before = this.heat[w];
    this.heat[w] += n * num("heat_gain", 1);
    if (before < WHITE && this.heat[w] >= WHITE) this.r.sfx.play("white", { vol: 0.8 });
    if (this.heat[w] >= 100) this.vent();
  }
  private vent() {
    const { r, p } = this;
    this.heat[this.current] = 0;
    this.venting = 1.2;
    this.ventWeapon = this.current;
    this.charge = 0;
    r.sfx.play("vent", { vol: 1 });
    r.fx.kick(0.5);
    r.vented++;
    r.stage.lights.flash(p.eye, [3, 1.8, 0.8], 9, 0.5);
    r.fx.ring(p.centre, 6, [1.6, 1, 0.5]);
    for (let i = 0; i < 14; i++) r.fx.steam(p.centre, [Math.sin(i * 0.45), 0.2, Math.cos(i * 0.45)], 2, 0.4);
    for (const f of r.foes) if (f.alive && dist(f.centre, p.centre) < num("vent_radius", 6.5)) f.hurt({ amount: 14, kind: "blast", dir: norm(sub(f.centre, p.centre)), point: f.centre, knock: 7, lift: 3, stun: 1.6 });
  }
  private tip(): V3 {
    return this.gun.point("root", VIEW[this.current].tip);
  }
  private shown(): V3 {
    return this.r.stage.gunPoint(this.tip());
  }
  private recoil(k = 1) {
    const v = VIEW[this.current];
    this.backVel += v.kick * 13 * k;
    this.riseVel += v.rise * 11 * k;
    this.p.kick(v.rise * 2.2 * k);
  }
  private muzzle(size: number, color: V3, range = 7) {
    const w = this.whiteHeat;
    this.r.fx.muzzle(this.shown(), size, w ? [2.2, 2.5, 3] : color);
    this.flashAt = { life: 0.05, size, color: w ? [2.2, 2.5, 3] : color };
    this.r.stage.lights.flash(mad(this.p.eye, this.p.forward, 0.8), w ? [2, 2.2, 2.6] : mul(color, 1.1), range, 0.1);
  }
  private flashAt = { life: 0, size: 0, color: [0, 0, 0] as V3 };

  /** Straight shot; returns what it met. */
  private ray(dir: V3, damage: number, knock: number, kind: "rivet" | "shot", range = 90) {
    const { r, p } = this;
    const a = p.eye;
    const end = mad(a, dir, range);
    const wall = r.level.collision.trace(a, end, 0, 0, 0, true);
    const h = r.rayFoes(a, wall.end, 0.06);
    if (h) {
      h.foe.hurt({ amount: damage, kind, dir, point: h.point, knock, white: this.whiteHeat });
      r.fx.bleed(h.point, dir, damage, this.whiteHeat);
      this.hits++;
      return { point: h.point, foe: h.foe as Foe | null };
    }
    if (wall.fraction < 1) {
      r.fx.wall(wall.end, wall.normal, kind === "shot" ? 0.05 : 0.07, this.whiteHeat);
      r.strike(wall.end, wall.brush);
    }
    return { point: wall.end, foe: null };
  }

  update(dt: number, i: Intent) {
    const { r, p } = this;
    const owned = WEAPONS.filter((w) => p.owned.includes(w));
    if (i.select >= 0 && WEAPONS[i.select]) this.select(WEAPONS[i.select]);
    if (i.cycle) {
      const usable = owned.filter((w) => p.ammoFor(w) > 0 || w === this.next);
      const at = usable.indexOf(this.next);
      this.select(usable[(at + Math.sign(i.cycle) + usable.length) % usable.length]);
    }
    for (const w of WEAPONS) if (w !== this.current || this.sinceShot > 0.45) this.heat[w] = Math.max(0, this.heat[w] - num("heat_cool", 17) * dt * (w === this.current ? 1 : 0.6));
    this.sinceShot += dt;
    this.wait -= dt;
    this.hammerWait -= dt;
    this.dry -= dt;
    if (this.venting > 0) {
      this.venting -= dt;
      if (this.ventWeapon === this.current && Math.random() < dt * 24) r.fx.steam(this.shown(), [rand(-0.5, 0.5), 1, rand(-0.5, 0.5)], 1, 0.1);
    }
    // Change of weapon
    if (this.next !== this.current) {
      this.swap -= dt * 8;
      if (this.swap <= 0) {
        this.gun.dispose();
        this.current = this.next;
        this.gun = r.stage.actor(this.current, 1);
        this.gun.fogScale = 0;
        this.gun.rim = 0.7;
        this.swap = 0;
        this.wait = Math.max(0.12, Math.min(this.wait, 0.3));
        this.spin = this.pump = this.charge = 0;
        r.sfx.play("ready", { vol: 0.3, rate: rand(0.95, 1.05) });
      }
    } else this.swap = Math.min(1, this.swap + dt * 7);

    this.hammerTime(dt, i);
    this.beam = null;
    const free = this.swap > 0.75 && this.next === this.current && !(this.venting > 0 && this.ventWeapon === this.current) && this.swing <= 0;
    if (free) {
      this.fire(dt, i);
      this.alt(i);
    } else this.charge = 0;
    this.fireHeld = i.fire;
    this.altHeld = i.alt;
    this.animate(dt);
  }

  private spend(n: number) {
    const a = AMMO_OF[this.current];
    if (!a) return true;
    if (this.p.ammo[a] < n) {
      if (this.dry <= 0) {
        this.dry = 0.5;
        this.r.sfx.play("dry", { vol: 0.5 });
        this.r.hud.pulse("empty");
        if (this.p.ammo[a] < 1) this.fallback();
      }
      return false;
    }
    this.p.ammo[a] -= n;
    return true;
  }
  private fallback() {
    const best = [...WEAPONS].reverse().find((w) => w !== "bellgun" && w !== this.current && this.p.owned.includes(w) && this.p.ammoFor(w) > 0);
    if (best && !this.p.ammoFor(this.current)) this.select(best);
  }

  private fire(dt: number, i: Intent) {
    const { r, p } = this;
    const w = this.current;
    if (!i.fire) { this.charge = w === "bellgun" ? Math.max(0, this.charge - dt * 3) : 0; return; }
    if (this.wait > 0 && w !== "arclance") return;
    const f = p.forward;
    const boost = this.boost;
    const white = this.whiteHeat;
    const spread = (k: number): V3 => norm([f[0] + rand(-k, k), f[1] + rand(-k, k), f[2] + rand(-k, k)]);
    const shot = (wait: number, heat: number) => {
      this.wait = wait;
      this.sinceShot = 0;
      this.shots++;
      r.noise(p.pos);
      this.addHeat(heat);
    };
    if (w === "rivet") {
      const from = this.shown();
      const hit = this.ray(spread(0.004), num("rivet_damage", 17) * boost, 1.2, "rivet");
      this.tracer(from, hit.point, white);
      this.muzzle(0.16, [2.2, 1.1, 0.4]);
      this.recoil();
      r.sfx.play(white ? "rivet_white" : "rivet", { vol: 0.7, rate: rand(0.97, 1.04) });
      shot(1 / num("rivet_rate", 6.2), num("rivet_heat", 6.2));
      this.spinVel += 14;
    } else if (w === "bellows") {
      if (!this.spend(1)) return;
      const from = this.shown();
      const n = 13;
      for (let k = 0; k < n; k++) {
        const ring = k === 0 ? 0 : k < 6 ? 0.028 : 0.058;
        const a = (k / (k < 6 ? 5 : 7)) * 6.283 + rand(-0.2, 0.2);
        const u = r.stage.up, v = r.stage.right;
        const dir = norm([f[0] + (v.x * Math.cos(a) + u.x * Math.sin(a)) * ring, f[1] + (v.y * Math.cos(a) + u.y * Math.sin(a)) * ring, f[2] + (v.z * Math.cos(a) + u.z * Math.sin(a)) * ring]);
        const hit = this.ray(dir, num("shot_damage", 7) * boost, 0.85, "shot", 60);
        if (k % 2 === 0) this.tracer(from, hit.point, white, 0.02);
      }
      this.muzzle(0.34, [2.4, 1.1, 0.3], 10);
      this.recoil();
      r.fx.kick(0.28);
      r.sfx.play(white ? "shotgun_white" : "shotgun", { vol: 0.95, rate: rand(0.97, 1.03) });
      shot(1 / num("shot_rate", 1.25), num("shot_heat", 17));
      this.pump = 1;
      p.body.vel[0] -= f[0] * 1.2;
      p.body.vel[2] -= f[2] * 1.2;
    } else if (w === "chainsaw") {
      if (!this.spend(1)) return;
      r.shots.blade(mad(add(p.eye, [0, -0.1, 0]), f, 0.5), f, num("blade_damage", 42) * boost, white);
      this.muzzle(0.14, [1.6, 0.9, 0.4]);
      this.recoil();
      r.sfx.play("blade", { vol: 0.85, rate: rand(0.96, 1.05) });
      shot(1 / num("blade_rate", 2.6), num("blade_heat", 12));
      this.spinVel += 40;
    } else if (w === "arclance") {
      this.sinceShot = 0;
      this.lance(dt, boost);
    } else if (w === "mortar") {
      if (!this.spend(1)) return;
      r.shots.slag(mad(p.eye, f, 0.5), add(mul(f, 23), [p.body.vel[0] * 0.3, 3.2, p.body.vel[2] * 0.3]), num("slag_damage", 95) * boost, white);
      this.muzzle(0.3, [2.4, 0.9, 0.2], 9);
      this.recoil();
      r.fx.kick(0.2);
      r.sfx.play("mortar", { vol: 0.95, rate: rand(0.96, 1.04) });
      shot(1 / num("slag_rate", 1.3), num("slag_heat", 20));
    } else if (w === "bellgun") {
      if (p.ammo.peals < 1) return void (this.fireHeld || this.spend(1));
      if (this.charge === 0) r.sfx.play("bell_wind", { vol: 0.7 });
      this.charge += dt;
      if (this.charge > 0.5) {
        this.charge = 0;
        if (!this.spend(1)) return;
        this.ring(f, boost);
        shot(1.1, 58);
      }
    }
  }

  private tracer(a: V3, b: V3, white: boolean, width = 0.03) {
    this.tracers.push({ a, b, life: 0.07, white, width });
  }
  private tracers: { a: V3; b: V3; life: number; white: boolean; width: number }[] = [];

  private lance(dt: number, boost: number) {
    const { r, p } = this;
    if (p.ammo.cells < 1) return void this.spend(1);
    p.ammo.cells = Math.max(0, p.ammo.cells - dt * 11);
    this.addHeat(dt * num("arc_heat", 24));
    if (this.venting > 0) return;
    r.noise(p.pos);
    const f = p.forward;
    const a = p.eye;
    const wall = r.level.collision.trace(a, mad(a, f, 26), 0, 0, 0, true);
    let first = r.rayFoes(a, wall.end, 0.45)?.foe ?? null;
    if (!first) {
      let best = 0.2;
      for (const e of r.foes) {
        if (!e.alive || dist(e.centre, a) > 20) continue;
        const d = norm(sub(e.centre, a));
        const off = 1 - (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]);
        if (off < best * 0.25 && r.level.collision.clear(a, e.centre)) ((best = off * 4), (first = e));
      }
    }
    const chain: V3[] = [];
    if (first) {
      const done = new Set([first.uid]);
      let at: Foe | null = first;
      for (let k = 0; k < 4 && at; k++) {
        const c: V3 = at.centre;
        chain.push(c);
        at.hurt({ amount: dt * num("arc_damage", 120) * boost * (k ? 0.6 : 1), kind: "arc", dir: f, point: c, knock: dt * 8, stun: k === 0 && at.kind.mass > 0.6 ? 0.12 : 0, white: this.whiteHeat });
        if (Math.random() < dt * 12) r.fx.bleed(c, f, 6, this.whiteHeat);
        this.hits += dt * 4;
        at = r.foes.find((e) => e.alive && !done.has(e.uid) && dist(e.centre, c) < 6 && r.level.collision.clear(c, e.centre)) ?? null;
        if (at) done.add(at.uid);
      }
    } else if (wall.fraction < 1 && Math.random() < dt * 30) r.fx.wall(wall.end, wall.normal, 0.06);
    this.shots += dt * 4;
    this.beam = { to: first ? first.centre : wall.end, chain };
    r.sfx.loop("lance", "lance", null, 0.6, 1 + this.heat.arclance * 0.003);
    this.recoil(dt * 6);
    r.stage.lights.put(mad(a, f, 0.8), [0.5, 1.6, 1.4], 8);
    r.stage.lights.put(this.beam.to, [0.5, 1.8, 1.5], 6);
    this.spinVel += dt * 60;
  }

  private ring(f: V3, boost: number) {
    const { r, p } = this;
    r.sfx.play("bell_big", { vol: 1.2 });
    r.sfx.play("shotgun", { vol: 0.6, rate: 0.6 });
    r.fx.kick(1.2);
    r.fx.freeze = 0.06;
    this.muzzle(0.7, [2.6, 2, 1], 22);
    this.recoil();
    p.body.vel = add(p.body.vel, mul(f, -8));
    for (let k = 1; k < 9; k++) r.fx.ring(mad(p.eye, f, k * 2.6), 1.2 + k * 0.7, [1.8, 1.4, 0.8], 0.3 + k * 0.03);
    for (const e of [...r.foes]) {
      if (!e.alive) continue;
      const d = sub(e.centre, p.eye);
      const l = Math.hypot(...d);
      const c = (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / (l || 1);
      if (l > 32 || c < 0.82 - 1.2 / Math.max(2, l) || !r.level.collision.clear(p.eye, e.centre)) continue;
      e.hurt({ amount: num("bell_damage", 420) * boost, kind: "bell", dir: norm(d), point: e.centre, knock: 14, lift: 8, stun: 2 });
      r.fx.bleed(e.centre, f, 60);
    }
  }

  private alt(i: Intent) {
    const { r, p } = this;
    const w = this.current;
    if (!i.alt || this.wait > 0 || (this.altHeld && w !== "rivet")) return;
    const f = p.forward;
    if (w === "rivet") {
      r.shots.nail(mad(add(p.eye, [0, -0.06, 0]), f, 0.4), f, num("nail_damage", 42) * this.boost, this.whiteHeat);
      this.muzzle(0.22, [2.2, 1, 0.3]);
      this.recoil(2);
      r.sfx.play("nail", { vol: 0.9 });
      this.wait = 0.62;
      this.sinceShot = 0;
      r.noise(p.pos);
      this.addHeat(21);
    } else if (w === "bellows") {
      // The bellows: pushes machines, throws shots back, throws the player, and cools the barrels.
      this.wait = 0.75;
      this.heat.bellows = Math.max(0, this.heat.bellows - 22);
      this.recoil(0.7);
      this.pump = 1;
      r.sfx.play("gust", { vol: 1 });
      r.fx.kick(0.2);
      for (let k = 0; k < 4; k++) r.fx.ring(mad(p.eye, f, 1 + k * 1.5), 1 + k * 0.6, [0.5, 0.48, 0.45], 0.25);
      r.fx.steam(mad(p.eye, f, 0.8), f, 14, 0.35);
      const n = r.shots.reflect(p.eye, f, 8);
      if (n) (r.sfx.play("shield", { vol: 0.9, rate: 1.3 }), r.say("Returned"));
      for (const e of r.foes) {
        if (!e.alive) continue;
        const d = sub(e.centre, p.eye);
        const l = Math.hypot(...d);
        if (l < 8.5 && (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / (l || 1) > 0.5 && r.level.collision.clear(p.eye, e.centre)) e.hurt({ amount: 6, kind: "blast", dir: norm(add(norm(d), [0, 0.15, 0])), point: e.centre, knock: 16 * (1 - l / 12), lift: 6, stun: 0.5 });
      }
      const wall = r.level.collision.trace(p.eye, mad(p.eye, f, 2.6), 0, 0, 0, true);
      const push = wall.fraction < 1 ? 11 : p.body.grounded ? 0 : 5;
      p.body.vel = add(p.body.vel, mul(f, -push));
      if (push > 8 && f[1] < -0.3) p.body.grounded = false;
    } else if (w === "chainsaw") {
      const n = r.shots.recall();
      this.wait = 0.4;
      r.sfx.play(n ? "recall" : "dry", { vol: 0.8 });
      this.spinVel -= n ? 50 : 0;
    } else if (w === "arclance") {
      if (!this.spend(18)) return;
      r.shots.orb(mad(p.eye, f, 0.9), f, num("orb_damage", 15) * this.boost, this.whiteHeat);
      this.muzzle(0.3, [0.6, 2, 1.8]);
      this.recoil(6);
      r.sfx.play("orb", { vol: 0.9 });
      this.wait = 0.8;
      this.sinceShot = 0;
      this.addHeat(28);
      r.noise(p.pos);
    } else if (w === "mortar") {
      if (!this.spend(2)) return;
      for (let k = -2; k <= 2; k++) {
        const a = k * 0.12;
        const c = Math.cos(a), s = Math.sin(a);
        const d: V3 = [f[0] * c + f[2] * s, f[1], f[2] * c - f[0] * s];
        r.shots.slag(mad(p.eye, d, 0.5), add(mul(d, 18 + rand(-1, 1)), [0, 4.5 + rand(-0.5, 0.5), 0]), num("slag_damage", 95) * 0.5 * this.boost, this.whiteHeat, true);
      }
      this.muzzle(0.36, [2.4, 0.9, 0.2], 9);
      this.recoil(1.3);
      r.sfx.play("mortar", { vol: 1, rate: 0.85 });
      this.wait = 1;
      this.sinceShot = 0;
      this.addHeat(34);
      r.noise(p.pos);
    } else if (w === "bellgun") {
      if (!this.spend(1)) return;
      r.sfx.play("bell_big", { vol: 1.1, rate: 0.8 });
      r.shots.wave(p.pos, 17, 22, num("toll_damage", 120) * this.boost, null, true, 3.2);
      r.fx.kick(0.9);
      r.fx.freeze = 0.05;
      this.recoil();
      this.wait = 1.2;
      this.sinceShot = 0;
      this.addHeat(40);
      r.noise(p.pos);
    }
  }

  private hammerTime(dt: number, i: Intent) {
    const { r, p } = this;
    if (i.hammer && this.swing <= 0 && this.hammerWait <= 0) {
      this.swing = 0.42;
      this.swung = false;
      this.hammerWait = 0.5;
      this.charge = 0;
      r.sfx.play("hammer_swing", { vol: 0.6, rate: rand(0.95, 1.05) });
    }
    if (this.swing <= 0) return;
    this.swing -= dt;
    if (this.swung || this.swing > 0.3) return;
    this.swung = true;
    const f = p.forward;
    let hit = 0;
    for (const e of [...r.foes]) {
      if (!e.alive) continue;
      const d = sub(e.centre, p.eye);
      const l = Math.hypot(d[0], d[2]) - e.kind.radius;
      const c = (d[0] * f[0] + d[2] * f[2]) / (Math.hypot(d[0], d[2]) || 1) / Math.hypot(f[0], f[2]);
      if (l > num("hammer_reach", 2.6) || Math.abs(d[1]) > e.kind.height * 0.5 + 1.6 || (c < 0.45 && l > 0.4)) continue;
      hit++;
      const dir = norm([f[0], 0.1, f[2]]);
      const point: V3 = mad(p.eye, norm(d), Math.max(0.5, Math.hypot(...d) - e.kind.radius));
      const amount = num("hammer_damage", 72) * (e.stun > 0 ? 2 : 1) * (p.blessed > 0 ? 1.6 : 1);
      e.hurt({ amount, kind: "hammer", dir, point, knock: 10, lift: 4, stun: 0.35 });
      r.fx.bleed(point, dir, 45);
      r.fx.spark(point, mul(dir, -1), 14);
      if (!e.alive) this.heat[this.current] = Math.max(0, this.heat[this.current] - num("hammer_quench", 45));
    }
    const wall = r.level.collision.trace(p.eye, mad(p.eye, f, 2.2), 0, 0, 0, true);
    if (hit) {
      r.fx.kick(0.45);
      r.fx.freeze = Math.max(r.fx.freeze, 0.045);
      r.sfx.play("hammer_hit", { vol: 1, rate: rand(0.95, 1.06) });
    } else if (wall.fraction < 1) {
      r.fx.wall(wall.end, wall.normal, 0.2);
      r.fx.kick(0.2);
      r.sfx.play("hammer_wall", { vol: 0.8, rate: rand(0.95, 1.06) });
      r.strike(wall.end, wall.brush);
    }
    for (const s of r.shots.list) if (!s.mine && s.type !== "hook" && dist(s.pos, p.eye) < 3) ((s.mine = true), (s.vel = mul(f, 36)), (s.damage *= 4), r.sfx.play("shield", { vol: 0.8, rate: 1.4 }));
  }

  private animate(dt: number) {
    this.backVel += (-this.back * 260 - this.backVel * 20) * dt;
    this.back += this.backVel * dt;
    this.riseVel += (-this.rise * 200 - this.riseVel * 18) * dt;
    this.rise += this.riseVel * dt;
    this.spinVel *= Math.exp(-5 * dt);
    this.spin += this.spinVel * dt;
    this.pump = Math.max(0, this.pump - dt * 1.5);
    this.flashAt.life -= dt;
    this.tracers = this.tracers.filter((t) => (t.life -= dt) > 0);
    this.sink = lerp(this.sink, this.swing > 0 ? 1 : 0, ease(16, dt));
  }

  /** Puts the gun in front of the camera; called once the view is set. */
  place(view: { eye: V3; yaw: number; pitch: number; roll: number }, time: number) {
    const { r, p, gun } = this;
    const { stage } = r;
    const v = VIEW[this.current];
    const narrow = stage.engine.getAspectRatio(stage.camera) < 1.5 ? 0.06 : 0;
    const walk = p.body.grounded ? clamp(p.speed / 9, 0, 1) * p.bobAmount : 0;
    const ph = p.bobPhase * 0.85;
    const low = (1 - this.swap) * 0.4 + this.sink * 0.22 + (this.venting > 0 && this.ventWeapon === this.current ? Math.sin(Math.min(1, this.venting) * 3.14) * 0.07 : 0);
    const jitter = this.charge > 0 ? Math.sin(time * 90) * 0.004 * this.charge * 2 : this.beam ? Math.sin(time * 80) * 0.002 : 0;
    const x = v.at[0] - narrow + Math.sin(ph) * 0.016 * walk - p.sway.x * 0.0035 + jitter;
    const y = v.at[1] - low + Math.abs(Math.cos(ph)) * 0.014 * walk + p.sway.y * 0.0025 - p.landing * 0.22 - clamp(p.body.vel[1], -12, 8) * 0.0025 + Math.sin(time * 1.6) * 0.002;
    const z = v.at[2] - this.back;
    const { right: R, up: U, forward: F } = stage;
    const at = (a: number, b: number, c: number): V3 => [view.eye[0] + R.x * a + U.x * b + F.x * c, view.eye[1] + R.y * a + U.y * b + F.y * c, view.eye[2] + R.z * a + U.z * b + F.z * c];
    gun.pos = at(x, y, z);
    gun.yaw = view.yaw - 0.035 - p.sway.x * 0.008;
    gun.pitch = view.pitch - this.rise * 0.5 + p.sway.y * 0.006 + (1 - this.swap) * 0.7;
    gun.roll = view.roll + p.sway.x * 0.008 - 0.02;
    gun.heat = p.blessed > 0 ? 0.95 : this.venting > 0 && this.ventWeapon === this.current ? 0.95 * (this.venting / 1.2) : clamp((this.heat[this.current] - 12) / 88, 0, 1);
    gun.glow = 1 + gun.heat * 1.4;
    gun.mesh.setEnabled(p.alive && !r.hideGun);
    gun.reset();
    const part = (n: string) => gun.part(n);
    if (this.current === "rivet") ((part("drum")!.rz = -this.spin), (part("slide")!.z = -this.back * 0.6));
    if (this.current === "bellows") part("pump")!.z = -Math.sin(clamp(this.pump, 0, 1) * 3.14) * 0.12;
    if (this.current === "chainsaw") ((part("blade")!.ry = this.spin * 1.5 + time * 3), (part("blade")!.s = p.ammo.blades > 0 ? 1 : 0.001));
    if (this.current === "arclance") part("spark")!.s = 0.8 + Math.random() * 0.5 + (this.beam ? 0.8 : 0);
    if (this.current === "mortar") part("vial")!.rx = Math.sin(time * 3) * 0.05 + this.back;
    if (this.current === "bellgun") ((part("bell")!.rx = Math.sin(time * 26) * 0.05 * clamp(1.1 - this.wait, 0, 1) * (this.wait > 0 ? 1 : 0)), (part("striker")!.rx = this.charge > 0 ? -this.charge * 1.6 : this.wait > 0.9 ? 0.7 : 0));
    const grid = stage.world!.grid;
    grid.sample(p.eye, gun.light);
    gun.light.amb = mul(gun.light.amb, 0.9);
    gun.light.key = gun.light.key.map((v) => Math.min(v, 1.1)) as V3;
    gun.pose();

    const h = this.hammer;
    h.mesh.setEnabled(this.swing > 0 && p.alive);
    if (this.swing > 0) {
      const k = 1 - this.swing / 0.42;
      const s = k < 0.28 ? lerp(0, -0.35, k / 0.28) : k < 0.55 ? lerp(-0.35, 1, ease(9, (k - 0.28) * 2)) : 1;
      const out = k > 0.7 ? (k - 0.7) / 0.3 : 0;
      h.pos = at(-0.3 + s * 0.28, -0.2 + (k < 0.28 ? k * 0.6 : 0.16 - s * 0.2) - out * 0.35, 0.46 + s * 0.08);
      h.yaw = view.yaw + 0.5 - s * 0.7;
      h.pitch = view.pitch - 0.4 + s * 1.35;
      h.roll = view.roll + 0.4 - s * 1.5;
      h.light = gun.light;
      h.pose();
    }

    const tip = this.shown();
    if (this.flashAt.life > 0) r.fx.muzzle(tip, this.flashAt.size * (0.5 + this.flashAt.life * 10), this.flashAt.color);
    for (const t of this.tracers) stage.particles.beam(t.a, t.b, t.width * (t.life / 0.07), SPRITE.beam, t.white ? [1.2, 1.6, 2.2] : [1.6, 0.9, 0.3]);
    if (this.beam) {
      r.fx.arc(tip, this.beam.to, 0.09, this.whiteHeat ? [1.4, 1.8, 2.4] : undefined);
      r.fx.arc(tip, this.beam.to, 0.04);
      for (let k = 1; k < this.beam.chain.length; k++) r.fx.arc(this.beam.chain[k - 1], this.beam.chain[k], 0.06);
      stage.particles.sprite(this.beam.to, 0.35, SPRITE.star, [0.8, 2, 1.8], 1, 1, false, time * 20);
    }
    if (this.charge > 0) stage.particles.sprite(tip, this.charge * 0.5, SPRITE.glow, [2, 1.6, 0.8], 1, 1, true);
    if (gun.heat > 0.6 && Math.random() < 0.25) stage.particles.spawn(tip, { vel: [rand(-0.1, 0.1), 0.6, rand(-0.1, 0.1)], color: [1.4, 1.1, 0.7], end: [0.4, 0.1, 0.03], life: 0.35, size: 0.02, cell: SPRITE.ember });
  }
}
