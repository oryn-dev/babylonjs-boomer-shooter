import { Foe } from "../foes/foe";
import { KINDS } from "../foes/index";
import { Nav } from "../foes/nav";
import type { Stage } from "../gfx/stage";
import type { LevelBuilder } from "../level/build";
import type { Brush } from "../level/trace";
import { add, dist, mul, norm, rand, sub, type V3 } from "../level/vec";
import { DIFFICULTY, type Difficulty, num } from "../tune";
import type { Intent } from "./controls";
import { Fx } from "./fx";
import { Live } from "./live";
import { freshState, Player, type PlayerState } from "./player";
import { Shots } from "./shots";
import { type Ammo, AMMO_MAX, AMMO_OF, type Hit, type WeaponId } from "./types";

export interface Sfx {
  play(name: string, o?: { pos?: V3; vol?: number; rate?: number; gap?: number }): void;
  loop(id: string, name: string, pos: V3 | null, vol: number, rate: number): void;
}
export interface HudPort {
  message(text: string, seconds: number): void;
  banner(title: string, text: string): void;
  pulse(what: "ammo" | "empty"): void;
  mark(kill: boolean): void;
  points(n: number): void;
}
export interface Snapshot {
  player: PlayerState; pos: V3; yaw: number; dead: number[]; live: ReturnType<Live["snapshot"]>; time: number; kills: number; groupsDone: string[]; hits: number; shots: number; tookDamage: number; score: number;
}
export type Ending = "playing" | "dead" | "finished";

const ALT: Record<WeaponId, string> = {
  rivet: "Second fire pins a machine to the spot.",
  bellows: "Second fire blows a gust: shoves machines, returns their shots, cools the barrels.",
  chainsaw: "Second fire calls the blades back through them.",
  arclance: "Second fire sends a slow ball of lightning.",
  mortar: "Second fire scatters five small pots.",
  bellgun: "Hold to ring. Second fire strikes the floor and stuns all around.",
};

/** One level being played. */
export class Run {
  readonly rules: (typeof DIFFICULTY)[number];
  readonly fx: Fx;
  readonly shots: Shots;
  readonly player: Player;
  readonly live: Live;
  foes: Foe[] = [];
  time = 0;
  kills = 0;
  total = 0;
  score = 0;
  combo = 0;
  comboLeft = 0;
  bestCombo = 0;
  vented = 0;
  tookDamage = 0;
  done = false;
  ending: Ending = "playing";
  endedFor = 0;
  god = false;
  hideGun = false;
  floor: number;
  /** 0 calm to 1 fierce, for the music. */
  tension = 0;
  boss: Foe | null = null;
  checkpoint: Snapshot | null = null;
  onSignal: ((s: string) => void) | null = null;
  onKill: ((f: Foe, hit: Hit) => void) | null = null;
  onCheckpoint: ((s: Snapshot) => void) | null = null;
  private dead = new Set<number>();
  private groupsDone = new Set<string>();
  private navAge = 0;
  private pending: { at: number; fn: () => void }[] = [];
  private quiet = 0;

  constructor(readonly stage: Stage, readonly level: LevelBuilder, readonly nav: Nav, readonly id: string, readonly sfx: Sfx, readonly hud: HudPort, readonly difficulty: Difficulty, readonly arena: boolean, state: PlayerState | null, snap: Snapshot | null = null) {
    this.rules = DIFFICULTY[difficulty];
    level.collision.movers.length = 0;
    this.floor = level.bounds()[0][1];
    this.fx = new Fx(stage);
    this.shots = new Shots(this);
    const s = snap?.player ?? state ?? freshState();
    for (const w of level.weapons) if (!s.owned.includes(w as WeaponId)) s.owned.push(w as WeaponId);
    this.player = new Player(this, snap?.pos ?? level.start.pos, snap?.yaw ?? (level.start.yaw * Math.PI) / 180, s);
    if (!snap && level.start.velocity) this.player.body.vel = [...level.start.velocity];
    this.live = new Live(this);
    this.total = level.enemies.filter((e) => e.min <= difficulty).length;
    if (snap) {
      this.live.restore(snap.live);
      this.dead = new Set(snap.dead);
      this.groupsDone = new Set(snap.groupsDone);
      this.time = snap.time;
      this.kills = snap.kills;
      this.tookDamage = snap.tookDamage;
      this.player.arsenal.hits = snap.hits;
      this.player.arsenal.shots = snap.shots;
      this.player.safe = 1.2;
      this.checkpoint = snap;
    }
    level.enemies.forEach((e, i) => {
      if (e.min > difficulty || this.dead.has(i) || e.spawn && !this.live.fired.has(e.spawn)) return;
      const f = this.spawn(e.kind, e.pos, e.yaw, i, e.group);
      if (e.spawn) f.alert();
    });
    stage.particles.floorAt = (p) => {
      const t = level.collision.trace([p[0], p[1] + 0.2, p[2]], [p[0], p[1] - 0.6, p[2]], 0, 0, 0, true);
      return t.fraction < 1 && !t.startSolid ? { y: t.end[1] } : null;
    };
    this.nav.update(this.player.pos);
  }

  spawn(kind: string, pos: V3, yaw: number, index = -1, group?: string) {
    const k = KINDS[kind];
    if (!k) throw new Error(`no machine ${kind}`);
    const f = new Foe(k, pos, yaw, this, index, group);
    if (kind === "cantor") f.mem.floor = pos[1] + 0.02;
    this.foes.push(f);
    if (k.boss) this.boss = f;
    return f;
  }
  arrive(kind: string, pos: V3, index = -1, group?: string) {
    const yaw = Math.atan2(this.player.pos[0] - pos[0], this.player.pos[2] - pos[2]);
    this.fx.arrive(pos, KINDS[kind].height);
    this.sfx.play("arrive", { pos, vol: 0.8, rate: rand(0.9, 1.1), gap: 0.06 });
    const f = this.spawn(kind, pos, yaw, index, group);
    f.alert();
    f.cool = rand(0.6, 1.4);
    return f;
  }
  spawnSignal(signal: string) {
    this.level.enemies.forEach((e, i) => {
      if (e.spawn !== signal || e.min > this.difficulty || this.dead.has(i) || this.foes.some((f) => f.index === i)) return;
      this.later(e.wait + rand(0, 0.15), () => { if (!this.foes.some((f) => f.index === i)) this.arrive(e.kind, e.pos, i, e.group); });
    });
  }
  later(seconds: number, fn: () => void) {
    this.pending.push({ at: this.time + seconds, fn });
  }
  say(text: string, seconds = 2) {
    this.hud.message(text, seconds);
  }
  altHint(w: WeaponId) {
    return ALT[w];
  }
  hitMark(_f: Foe, _amount: number) {
    this.hud.mark(false);
  }
  noise(p: V3) {
    for (const f of this.foes) if (f.mood === "idle" && f.alive && dist(f.pos, p) < 24 && Math.abs(f.pos[1] - p[1]) < 7 && (f.range < 14 || this.nav.distance(f.pos) < 30)) f.alert();
  }
  strike(point: V3, brush: Brush | null) {
    this.live.strike(point, brush);
  }

  killed(f: Foe, hit: Hit) {
    this.kills += f.index >= 0 || this.arena ? 1 : 0;
    if (f.index >= 0) this.dead.add(f.index);
    this.combo++;
    this.comboLeft = num("combo_time", 4);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const points = Math.round(f.kind.score * (1 + Math.floor(this.combo / 3) * 0.25) * (hit.kind === "hammer" ? 1.5 : 1));
    this.score += points;
    this.hud.mark(true);
    this.hud.points(points);
    this.sfx.play("kill", { vol: 0.45, rate: Math.min(1.8, 0.9 + this.combo * 0.06) });
    if (hit.kind !== "burn" && f.kind.hp > 200) this.fx.freeze = Math.max(this.fx.freeze, 0.05);
    this.drops(f, hit);
    this.onKill?.(f, hit);
    if (f === this.boss) this.boss = null;
    if (f.group && !this.foes.some((o) => o.alive && o.group === f.group) && !this.level.enemies.some((e, i) => e.group === f.group && e.min <= this.difficulty && !this.dead.has(i))) this.clearGroup(f.group);
  }
  private clearGroup(g: string) {
    if (this.groupsDone.has(g)) return;
    this.groupsDone.add(g);
    for (const s of this.level.cleared[g] ?? []) this.later(0.4, () => this.live.fire(s));
  }
  private drops(f: Foe, hit: Hit) {
    if (hit.kind === "burn" && f.kind.id === "crucible") return;
    const p = this.player;
    const k = this.rules.drops;
    const big = f.kind.hp > 100;
    const out: string[] = [];
    const need = (["shells", "blades", "cells", "slag"] as Ammo[]).filter((a) => p.owned.some((w) => AMMO_OF[w] === a)).sort((a, b) => p.ammo[a] / AMMO_MAX[a] - p.ammo[b] / AMMO_MAX[b])[0];
    if (hit.kind === "hammer") {
      out.push("vial", "vial", "shard", "shard");
      if (need) out.push(need);
    } else {
      const low = p.health < 45 ? 1.8 : 1;
      if (Math.random() < 0.3 * k * low) out.push("vial");
      if (Math.random() < 0.28 * k) out.push("shard");
      if (need && Math.random() < 0.3 * k) out.push(need);
    }
    if (big) out.push("vial", "shard", ...(need ? [need] : []));
    if (f.kind.boss) out.push("flask", "flask", "armour");
    for (const o of out) this.live.drop(o, f.centre);
  }

  /** Area damage. `to` null hurts everybody, "foes" spares the player, "player" hurts the player fully and machines by `foeAmount`. */
  blast(at: V3, radius: number, amount: number, to: "foes" | "player" | null, foeAmount = amount, white = false) {
    this.fx.blast(at, radius, white ? [1.6, 1.9, 2.4] : undefined);
    this.sfx.play("explode", { pos: at, vol: 1, rate: rand(0.92, 1.08) });
    const floor = this.level.collision.trace(at, add(at, [0, -2, 0]), 0, 0, 0, true);
    if (floor.fraction < 1) this.stage.particles.decal(floor.end, floor.normal, radius * 0.45, 17, [0, 0, 0], 0.85, 2);
    for (const f of [...this.foes]) {
      if (!f.alive) continue;
      const l = Math.max(0, dist(f.centre, at) - f.kind.radius);
      if (l > radius || !this.level.collision.clear(at, f.centre)) continue;
      const k = 1 - (l / radius) * 0.65;
      f.hurt({ amount: foeAmount * k, kind: "blast", dir: norm(add(norm(sub(f.centre, at)), [0, 0.3, 0])), point: f.centre, knock: 9 * k, lift: 5, white });
    }
    const p = this.player;
    const l = Math.max(0, dist(p.centre, at) - 0.5);
    if (l < radius && amount > 0) {
      const k = 1 - (l / radius) * 0.7;
      const push = mul(norm(add(norm(sub(p.centre, at)), [0, 0.4, 0])), 11 * k);
      if (to !== "foes") p.hurt(amount * k, at, push);
      else if (l < radius * 0.8) (p.hurt(Math.min(18, amount * 0.16 * k), at, push));
    }
  }

  /** Nearest machine on a line. */
  rayFoes(a: V3, b: V3, pad: number, skip?: Set<number>): { foe: Foe; point: V3 } | null {
    const d = sub(b, a);
    const l = Math.hypot(...d);
    if (l < 1e-6) return null;
    let best = 1;
    let foe: Foe | null = null;
    for (const f of this.foes) {
      if (!f.alive || skip?.has(f.uid)) continue;
      const rad = f.kind.radius + pad;
      // Upright cylinder.
      const ox = a[0] - f.pos[0];
      const oz = a[2] - f.pos[2];
      const A = d[0] * d[0] + d[2] * d[2];
      const B = ox * d[0] + oz * d[2];
      const C = ox * ox + oz * oz - rad * rad;
      let t0 = 0;
      let t1 = 1;
      if (A < 1e-9) { if (C > 0) continue; } else {
        const q = B * B - A * C;
        if (q < 0) continue;
        const s = Math.sqrt(q);
        t0 = (-B - s) / A;
        t1 = (-B + s) / A;
      }
      const lo = f.pos[1] - pad;
      const hi = f.pos[1] + f.kind.height + pad;
      if (Math.abs(d[1]) > 1e-9) {
        const u0 = (lo - a[1]) / d[1];
        const u1 = (hi - a[1]) / d[1];
        t0 = Math.max(t0, Math.min(u0, u1));
        t1 = Math.min(t1, Math.max(u0, u1));
      } else if (a[1] < lo || a[1] > hi) continue;
      const t = Math.max(0, t0);
      if (t > t1 || t >= best) continue;
      best = t;
      foe = f;
    }
    return foe ? { foe, point: [a[0] + d[0] * best, a[1] + d[1] * best, a[2] + d[2] * best] } : null;
  }

  moltenAt(p: V3): number | null {
    for (const l of this.level.liquids) if (l.kind === "molten" && p[0] > l.lo[0] && p[0] < l.hi[0] && p[2] > l.lo[2] && p[2] < l.hi[2] && p[1] < l.hi[1] - 0.05 && p[1] > l.lo[1] - 3) return l.hi[1];
    return null;
  }
  /** Lowest floor around a molten pool that can be reached from it. */
  rimAbove(p: V3, surface: number) {
    let best = surface + 6;
    for (const n of this.nav.at) if (n[1] > surface - 0.1 && n[1] < best && Math.hypot(n[0] - p[0], n[2] - p[2]) < 7) best = n[1];
    return best;
  }
  surfaceUnder() {
    const b = this.player.body.ground;
    return b?.owner ? "step_metal" : "step_stone";
  }

  saveCheckpoint(_i: number) {
    this.checkpoint = this.snapshot();
    this.say("Progress kept", 1.6);
    this.sfx.play("checkpoint", { vol: 0.5 });
    this.onCheckpoint?.(this.checkpoint);
  }
  snapshot(): Snapshot {
    const p = this.player;
    return { player: p.state(), pos: [...p.pos], yaw: p.yaw, dead: [...this.dead], live: this.live.snapshot(), time: this.time, kills: this.kills, groupsDone: [...this.groupsDone], hits: p.arsenal.hits, shots: p.arsenal.shots, tookDamage: this.tookDamage, score: this.score };
  }
  playerDied() {
    this.ending = "dead";
    this.done = true;
  }
  finish() {
    if (this.done) return;
    this.done = true;
    this.ending = "finished";
    this.player.safe = 99;
    this.sfx.play("exit", { vol: 1 });
  }

  update(dt: number, intent: Intent) {
    if (this.fx.freeze > 0) {
      this.fx.freeze -= dt;
      dt *= 0.08;
    }
    if (!this.done) this.time += dt;
    else this.endedFor += dt;
    const due = this.pending.filter((p) => p.at <= this.time || (this.done && p.at <= this.time + this.endedFor));
    this.pending = this.pending.filter((p) => !due.includes(p));
    due.forEach((p) => p.fn());
    this.navAge -= dt;
    if (this.navAge <= 0) ((this.navAge = 0.3), this.nav.update(this.player.pos));
    this.player.update(dt, this.done && this.ending === "finished" ? { ...intent, fire: false, alt: false, move: { x: 0, y: 0 } } : intent);
    this.live.update(dt, intent.use);
    for (const f of this.foes) f.update(dt);
    this.apart(dt);
    this.shots.update(dt);
    this.fx.update(dt);
    this.foes = this.foes.filter((f) => {
      if (!f.alive) f.dispose();
      return f.alive;
    });
    this.comboLeft -= dt;
    if (this.comboLeft <= 0) this.combo = 0;
    const awake = this.foes.filter((f) => f.mood !== "idle" && f.alive && f.range < 40).length;
    this.quiet = awake ? 0 : this.quiet + dt;
    const want = awake ? Math.min(1, 0.45 + awake * 0.12) : this.quiet > 2 ? 0 : 0.4;
    this.tension += (want - this.tension) * Math.min(1, dt * (want > this.tension ? 3 : 0.5));
  }

  /** Machines keep out of each other and of the player. */
  private apart(dt: number) {
    const list = this.foes;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || a.mood === "idle") continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || Math.abs(a.pos[1] - b.pos[1]) > 2.5) continue;
        const dx = b.pos[0] - a.pos[0];
        const dz = b.pos[2] - a.pos[2];
        const need = a.kind.radius + b.kind.radius + 0.12;
        const l2 = dx * dx + dz * dz;
        if (l2 > need * need || l2 < 1e-6) continue;
        const l = Math.sqrt(l2);
        const push = (need - l) * 26 * dt;
        const ma = a.kind.mass + 0.02, mb = b.kind.mass + 0.02;
        a.body.vel[0] -= (dx / l) * push * (ma / (ma + mb)) * 6;
        a.body.vel[2] -= (dz / l) * push * (ma / (ma + mb)) * 6;
        b.body.vel[0] += (dx / l) * push * (mb / (ma + mb)) * 6;
        b.body.vel[2] += (dz / l) * push * (mb / (ma + mb)) * 6;
      }
      const p = this.player;
      const dx = p.pos[0] - a.pos[0];
      const dz = p.pos[2] - a.pos[2];
      const need = a.kind.radius + p.body.radius;
      const l = Math.hypot(dx, dz);
      if (l < need && l > 0.01 && Math.abs(p.centre[1] - a.centre[1]) < a.kind.height * 0.5 + 0.8) {
        const k = (need - l) * 18 * dt;
        p.body.vel[0] += (dx / l) * k * 6;
        p.body.vel[2] += (dz / l) * k * 6;
      }
    }
  }

  dispose() {
    for (const f of this.foes) f.dispose();
    this.foes = [];
    this.shots.clear();
    this.fx.clear();
    this.live.dispose();
    this.player.arsenal.dispose();
    this.stage.particles.clear();
    this.stage.lights.clear();
  }
}
