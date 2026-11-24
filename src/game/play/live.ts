import { Actor } from "../gfx/actor";
import { SPRITE } from "../gfx/particles";
import type { DoorDef, ItemDef, KeyName, LiftDef, SwitchDef } from "../level/build";
import { PROPS } from "../level/props";
import { slabModel, type Slab } from "../level/shapes";
import { boxBrush, type Brush } from "../level/trace";
import { add, dist, ease, lerp, mul, norm, rand, sub, type V3 } from "../level/vec";
import { num } from "../tune";
import { CYAN } from "./fx";
import type { Run } from "./run";
import { type Ammo, WEAPON_NAME, type WeaponId, WEAPONS } from "./types";

export const KEY_COLOR: Record<KeyName, V3> = { cobalt: [0.2, 0.45, 1], rose: [1, 0.2, 0.36], white: [0.95, 0.97, 1] };
const KEY_SIGIL: Record<KeyName, string> = { cobalt: "sigilcog", rose: "sigilflame", white: "sigilbell" };
const KEY_TEXT: Record<KeyName, string> = { cobalt: "Cobalt seal", rose: "Rose seal", white: "White seal" };

interface Door { def: DoorDef; actor: Actor; sigils: Actor[]; brush: Brush; k: number; open: boolean; unlocked: boolean; hold: number; nodes: Set<number>; told: number }
interface Lift { def: LiftDef; actor: Actor; brush: Brush; y: number; vel: number; state: "low" | "up" | "high" | "down"; wait: number }
interface Item { def: ItemDef; index: number; actor: Actor; pos: V3; vel: V3; drop: boolean; life: number; taken: boolean; age: number }
interface Lever { def: SwitchDef; actor: Actor; on: boolean; k: number }

const COLOR_OF: Record<string, V3> = { keycobalt: [0.3, 0.6, 2], keyrose: [2, 0.3, 0.6], keywhite: [1.6, 1.6, 1.7] };
export const ITEM_MODELS = ["vial", "flask", "heart", "shard", "armour", "shells", "blades", "cells", "slag", "peal", "whiteheat", "keycobalt", "keyrose", "keywhite"];

/** Everything in a level that moves, opens or can be taken. */
export class Live {
  doors: Door[] = [];
  lifts: Lift[] = [];
  items: Item[] = [];
  levers: Lever[] = [];
  private moving: { actor: Actor; spin: number; swing: number; base: number; swingBase: number }[] = [];
  private flares: { pos: V3; size: number; color: V3; flame: boolean }[] = [];
  fired = new Set<string>();
  taken = new Set<number>();
  found = new Set<number>();
  passed = new Set<number>();
  private triggersDone = new Set<number>();
  near: Lever | null = null;
  respawn: { item: number; at: number }[] = [];
  /** Item pads refill after a while. */
  refill = 0;

  constructor(private r: Run) {
    const { stage, level } = r;
    for (const def of level.doors) {
      const size = sub(def.hi, def.lo);
      const along = size[0] >= size[2] ? 0 : 2;
      const h = size[1];
      const c: V3 = [(def.lo[0] + def.hi[0]) / 2, def.lo[1], (def.lo[2] + def.hi[2]) / 2];
      const half = size.map((s) => s / 2) as V3;
      const slabs: Slab[] = [{ lo: [-half[0], 0, -half[2]], hi: [half[0], h, half[2]], tex: def.tex }];
      if (def.tex === "door") {
        const t = along === 0 ? 2 : 0;
        const strip = (a0: number, a1: number, y0: number, y1: number, tex: string, out: number, color?: V3, glow?: number) => {
          const lo: V3 = [0, y0, 0], hi: V3 = [0, y1, 0];
          lo[along] = a0; hi[along] = a1; lo[t] = -half[t] - out; hi[t] = half[t] + out;
          slabs.push({ lo, hi, tex, color, glow });
        };
        strip(-half[along], half[along], 0, 0.35, "metal", 0.06);
        strip(-half[along], half[along], h - 0.35, h, "metal", 0.06);
        strip(-half[along], half[along], h * 0.5 - 0.14, h * 0.5 + 0.14, "brass", 0.05);
        for (const s of [-1, 1]) strip(s * half[along] - 0.14, s * half[along] + 0.14, 0.35, h - 0.35, "metal", 0.04);
        strip(-0.1, 0.1, 0.35, h - 0.35, "metal", 0.08);
        if (def.key) strip(-half[along] + 0.2, half[along] - 0.2, h * 0.5 - 0.06, h * 0.5 + 0.06, "glow", 0.08, KEY_COLOR[def.key], 0.3);
      }
      const actor = new Actor(stage.scene, slabModel(`door ${r.id} ${def.id}`, slabs), stage.surfaces);
      actor.pos = c;
      actor.rim = 0;
      const sigils: Actor[] = [];
      if (def.key) for (const s of [-1, 1]) {
        const a = stage.actor(KEY_SIGIL[def.key], 0, "kit");
        a.flash = 0.75; a.flashColor = mul(KEY_COLOR[def.key], 1.3); a.scale = 1.1;
        a.yaw = along === 0 ? (s > 0 ? 0 : Math.PI) : s > 0 ? Math.PI / 2 : -Math.PI / 2;
        const p: V3 = [c[0], c[1] + Math.min(h * 0.5, 2.2), c[2]];
        p[along === 0 ? 2 : 0] += s * (half[along === 0 ? 2 : 0] + 0.14);
        a.pos = p;
        sigils.push(a);
      }
      const brush = boxBrush(def.lo, def.hi);
      brush.owner = def;
      level.collision.addMover(brush);
      const nodes = new Set<number>();
      r.nav.at.forEach((n, i) => { if (n[0] > def.lo[0] - 0.6 && n[0] < def.hi[0] + 0.6 && n[2] > def.lo[2] - 0.6 && n[2] < def.hi[2] + 0.6 && n[1] > def.lo[1] - 1 && n[1] < def.hi[1]) nodes.add(i); });
      this.doors.push({ def, actor, sigils, brush, k: 0, open: false, unlocked: !def.key, hold: 0, nodes, told: 0 });
    }
    r.nav.closed = (n) => this.doors.some((d) => !d.open && (!d.def.auto || !d.unlocked) && d.nodes.has(n));
    for (const def of level.lifts) {
      const size = sub(def.hi, def.lo);
      const half: V3 = [size[0] / 2, 0, size[2] / 2];
      const h = size[1];
      const slabs: Slab[] = [{ lo: [-half[0], 0, -half[2]], hi: [half[0], h, half[2]], tex: def.tex }];
      for (const s of [-1, 1]) slabs.push({ lo: [s > 0 ? half[0] - 0.14 : -half[0], -0.12, -half[2]], hi: [s > 0 ? half[0] : -half[0] + 0.14, h + 0.03, half[2]], tex: "brass" }, { lo: [-half[0], -0.12, s > 0 ? half[2] - 0.14 : -half[2]], hi: [half[0], h + 0.03, s > 0 ? half[2] : -half[2] + 0.14], tex: "brass" });
      slabs.push({ lo: [-half[0] * 0.4, -3, -half[2] * 0.4], hi: [half[0] * 0.4, -0.02, half[2] * 0.4], tex: "steel" });
      const actor = new Actor(stage.scene, slabModel(`lift ${r.id} ${def.id}`, slabs), stage.surfaces);
      actor.rim = 0;
      const brush = boxBrush(def.lo, def.hi);
      brush.owner = def;
      level.collision.addMover(brush);
      this.lifts.push({ def, actor, brush, y: 0, vel: 0, state: "low", wait: 0 });
    }
    for (const p of level.props) {
      if (!p.spin && !p.swing) continue;
      const actor = stage.actor(p.model, 0, "kit");
      actor.pos = [...p.pos]; actor.yaw = p.yaw; actor.pitch = p.pitch; actor.roll = p.roll; actor.scale = p.scale[0]; actor.rim = 0;
      this.moving.push({ actor, spin: p.spin, swing: p.swing, base: p.roll, swingBase: rand(0, 6) });
    }
    for (const p of level.props) {
      const f = PROPS[p.model]?.flare;
      if (!f) continue;
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), k = p.scale[0];
      this.flares.push({ pos: [p.pos[0] + (f.at[0] * c + f.at[2] * s) * k, p.pos[1] + f.at[1] * k, p.pos[2] + (f.at[2] * c - f.at[0] * s) * k], size: f.size * k, color: f.color, flame: p.model === "brazier" || p.model === "candles" });
    }
    for (const def of level.switches) {
      const actor = stage.actor("lever");
      actor.yaw = def.yaw;
      actor.pos = [def.pos[0] + Math.sin(def.yaw) * 0.28, def.pos[1] + 0.85, def.pos[2] + Math.cos(def.yaw) * 0.28];
      this.levers.push({ def, actor, on: false, k: 0 });
    }
    level.items.forEach((def, i) => this.addItem(def, i));
  }

  private addItem(def: ItemDef, index: number, vel?: V3) {
    const name = def.kind;
    const gun = WEAPONS.includes(name as WeaponId);
    const actor = this.r.stage.actor(name);
    if (gun) { actor.scale = 1.5; for (const h of ["hand1", "hand2"]) { const p = actor.part(h); if (p) p.s = 0; } }
    actor.pos = [...def.pos];
    actor.rim = 1.2;
    const item: Item = { def, index, actor, pos: [...def.pos], vel: vel ?? [0, 0, 0], drop: Boolean(vel), life: 22, taken: false, age: rand(0, 6) };
    this.items.push(item);
    return item;
  }
  drop(kind: string, pos: V3) {
    if (this.items.filter((i) => i.drop).length > 26) return;
    const a = rand(0, 6.28);
    this.addItem({ kind, pos: add(pos, [0, 0.4, 0]) }, -1, [Math.cos(a) * rand(2, 4), rand(4, 6.5), Math.sin(a) * rand(2, 4)]);
  }

  /** Takes an item; false when there is no need for it. */
  private take(item: Item): boolean {
    const { r } = this;
    const p = r.player;
    const k = item.def.kind;
    const ammo = (a: Ammo, n: number) => p.give(a, Math.ceil(n * (r.rules.drops > 1 ? 1.25 : 1)));
    let text = "";
    let sound = "pick";
    let ok = true;
    if (k === "vial") ((ok = p.heal(10)), (sound = "vial"));
    else if (k === "flask") ((ok = p.heal(35)), (sound = "vial"), (text = "Quench oil"));
    else if (k === "heart") ((ok = p.heal(100, 200)), (sound = "great"), (text = "Chorister's heart"));
    else if (k === "shard") ((ok = p.plate(6)), (sound = "plate"));
    else if (k === "armour") ((ok = p.plate(60, 150)), (sound = "plate"), (text = "Foundry plate"));
    else if (k === "shells") ((ok = ammo("shells", 6)), (text = item.drop ? "" : "Shells"));
    else if (k === "blades") ((ok = ammo("blades", 4)), (text = item.drop ? "" : "Saw blades"));
    else if (k === "cells") ((ok = ammo("cells", 30)), (text = item.drop ? "" : "Arc cells"));
    else if (k === "slag") ((ok = ammo("slag", 3)), (text = item.drop ? "" : "Slag pots"));
    else if (k === "peal") ((ok = ammo("peals", 1)), (text = "A peal for the Bell"));
    else if (k === "whiteheat") ((p.blessed = 20), (sound = "great"), (text = "White heat"), r.stage.lights.flash(p.eye, [2, 2.4, 3], 12, 0.6));
    else if (k.startsWith("key")) {
      const key = k.slice(3) as KeyName;
      p.keys.add(key);
      text = KEY_TEXT[key];
      sound = "key";
    } else if (WEAPONS.includes(k as WeaponId)) {
      const w = k as WeaponId;
      const isNew = !p.owned.includes(w);
      const first: Partial<Record<WeaponId, [Ammo, number]>> = { bellows: ["shells", 12], chainsaw: ["blades", 10], arclance: ["cells", 80], mortar: ["slag", 6], bellgun: ["peals", 1] };
      const f = first[w];
      const got = f ? p.give(f[0], f[1]) : false;
      ok = isNew || got;
      if (isNew) {
        p.owned.push(w);
        p.arsenal.select(w);
        sound = "weapon";
        r.hud.banner(WEAPON_NAME[w], r.altHint(w));
      } else text = WEAPON_NAME[w];
    }
    if (!ok) return false;
    r.sfx.play(sound, { vol: 0.8, rate: k === "vial" || k === "shard" ? rand(0.95, 1.15) : 1 });
    if (text) r.say(text);
    const c = COLOR_OF[k] ?? CYAN;
    r.stage.particles.burst(item.pos, 8, [0.5, 2.5], { color: c, life: 0.4, size: 0.04, cell: SPRITE.ember, drag: 2 }, [0, 1, 0]);
    r.stage.lights.flash(item.pos, mul(c, 0.8), 4, 0.25);
    return true;
  }

  fire(signal: string) {
    const { r } = this;
    if (!signal) return;
    this.fired.add(signal);
    for (const d of this.doors) {
      if (d.def.open === signal) this.setDoor(d, true);
      if (d.def.close === signal) this.setDoor(d, false);
    }
    for (const l of this.lifts) if (l.def.signal === signal) ((l.state = l.state === "low" || l.state === "down" ? "up" : "down"), r.sfx.play("lift", { pos: this.liftPos(l), vol: 0.8 }));
    r.spawnSignal(signal);
    const line = r.level.lines[signal];
    if (line) r.say(line, 4);
    r.onSignal?.(signal);
  }
  private setDoor(d: Door, open: boolean) {
    if (d.open === open) return;
    d.open = open;
    this.r.sfx.play(open ? "door" : "door_shut", { pos: this.doorPos(d), vol: 1 });
    if (d.def.tex !== "door" && open) {
      const c = this.doorPos(d);
      this.r.fx.blast(c, 1.6, [0.6, 0.4, 0.25]);
      this.r.fx.scrap(c, [0, 0.5, 0], 5, 5);
      d.k = 1;
      d.brush.enabled = false;
      d.actor.mesh.setEnabled(false);
    }
  }
  private doorPos(d: Door): V3 {
    return [(d.def.lo[0] + d.def.hi[0]) / 2, (d.def.lo[1] + d.def.hi[1]) / 2, (d.def.lo[2] + d.def.hi[2]) / 2];
  }
  private liftPos(l: Lift): V3 {
    return [(l.def.lo[0] + l.def.hi[0]) / 2, l.def.hi[1] + l.y, (l.def.lo[2] + l.def.hi[2]) / 2];
  }
  liftSpeed(b: Brush | null) {
    return this.lifts.find((l) => l.brush === b)?.vel ?? 0;
  }
  /** A shot or blow on something solid: levers move, cracked walls fall. */
  strike(point: V3, brush: Brush | null) {
    for (const l of this.levers) if (!l.on && dist(l.actor.pos, point) < 0.9) this.pull(l);
    const d = this.doors.find((x) => x.brush === brush && x.def.open === "hit");
    if (d) this.setDoor(d, true);
  }
  pull(l: Lever) {
    if (l.on) return;
    l.on = true;
    this.r.sfx.play("lever", { pos: l.actor.pos, vol: 1 });
    if (l.def.text) this.r.say(l.def.text, 2.5);
    for (const s of l.def.fire) this.fire(s);
  }

  update(dt: number, use: boolean) {
    const { r } = this;
    const p = r.player;
    const inside = (lo: V3, hi: V3, pad = 0) => p.pos[0] > lo[0] - pad && p.pos[0] < hi[0] + pad && p.pos[1] > lo[1] - 0.5 && p.pos[1] < hi[1] + pad && p.pos[2] > lo[2] - pad && p.pos[2] < hi[2] + pad;
    const { particles, lights } = r.stage;
    const eye = r.stage.eye;

    for (const d of this.doors) {
      const c = this.doorPos(d);
      const close = Math.hypot(p.pos[0] - c[0], p.pos[2] - c[2]) < 3.6 + Math.max(d.def.hi[0] - d.def.lo[0], d.def.hi[2] - d.def.lo[2]) * 0.2 && Math.abs(p.pos[1] - d.def.lo[1]) < 3;
      d.told -= dt;
      if (close && !d.unlocked) {
        if (p.keys.has(d.def.key!)) ((d.unlocked = true), r.sfx.play("unlock", { pos: c, vol: 1 }), r.say(`${KEY_TEXT[d.def.key!]} accepted`));
        else if (d.told <= 0) ((d.told = 4), r.say(`Needs the ${KEY_TEXT[d.def.key!].toLowerCase()}`), r.sfx.play("locked", { pos: c, vol: 0.8 }));
      }
      if (d.def.auto && d.unlocked) {
        const foeNear = !d.open || d.hold < 1 ? r.foes.some((f) => f.alive && f.mood !== "idle" && Math.hypot(f.pos[0] - c[0], f.pos[2] - c[2]) < 2.6 && Math.abs(f.pos[1] - d.def.lo[1]) < 2) : false;
        if (close || foeNear) ((d.hold = 1.6), this.setDoor(d, true));
        else if ((d.hold -= dt) < 0 && d.open && d.def.key === undefined) this.setDoor(d, false);
      }
      const to = d.open ? 1 : 0;
      if (d.k !== to) {
        const before = d.k;
        d.k = d.k < to ? Math.min(to, d.k + dt / d.def.time) : Math.max(to, d.k - dt / d.def.time);
        const e = d.k * d.k * (3 - 2 * d.k);
        const o = mul(d.def.move, e);
        // A door does not close on somebody.
        if (to === 0 && inside(d.def.lo, d.def.hi, 0.4)) { d.k = before; continue; }
        d.brush.offset = o;
        d.actor.pos = add([(d.def.lo[0] + d.def.hi[0]) / 2, d.def.lo[1], (d.def.lo[2] + d.def.hi[2]) / 2], o);
        d.sigils.forEach((s) => (s.stretch = 1));
        if (d.k === 0 || d.k === 1) (r.sfx.play("door_end", { pos: c, vol: 0.6 }), r.fx.kick(0.15, c));
      }
      const base = add([(d.def.lo[0] + d.def.hi[0]) / 2, d.def.lo[1], (d.def.lo[2] + d.def.hi[2]) / 2], d.brush.offset ?? [0, 0, 0]);
      d.sigils.forEach((s) => (s.pos = [s.pos[0], base[1] + Math.min((d.def.hi[1] - d.def.lo[1]) * 0.5, 2.2), s.pos[2]]));
      d.actor.relight(r.stage.world!.grid, dt, 1.5);
      if (d.def.key && dist(c, eye) < 30) lights.put([c[0], d.def.lo[1] + 2.2, c[2]], mul(KEY_COLOR[d.def.key], 0.8), 4.5);
    }

    for (const l of this.lifts) {
      const { def } = l;
      const c = this.liftPos(l);
      const on = p.body.ground === l.brush;
      if (def.mode === "step") {
        if (l.state === "low" && on) ((l.wait += dt), l.wait > 0.25 && ((l.state = "up"), (l.wait = 0), r.sfx.play("lift", { pos: c, vol: 0.8 })));
        else if (l.state === "low") l.wait = 0;
        if (l.state === "high") {
          l.wait += on ? 0 : dt;
          if (l.wait > def.wait) ((l.state = "down"), (l.wait = 0), r.sfx.play("lift", { pos: c, vol: 0.6 }));
        }
      } else if (def.mode === "loop" && (l.state === "low" || l.state === "high") && (l.wait += dt) > def.wait) ((l.state = l.state === "low" ? "up" : "down"), (l.wait = 0));
      const goal = l.state === "up" ? def.rise : l.state === "down" ? 0 : l.y;
      const gap = goal - l.y;
      const want = Math.sign(gap) * Math.min(def.speed, Math.sqrt(Math.abs(gap) * 18) + 0.2);
      l.vel = gap === 0 ? 0 : lerp(l.vel, want, ease(10, dt));
      let step = l.vel * dt;
      if (Math.abs(step) >= Math.abs(gap)) {
        step = gap;
        if (l.state === "up") ((l.state = "high"), (l.wait = 0), r.sfx.play("lift_end", { pos: c, vol: 0.7 }));
        else if (l.state === "down") ((l.state = "low"), (l.wait = 0), r.sfx.play("lift_end", { pos: c, vol: 0.6 }));
        l.vel = 0;
      }
      // A foot under a falling lift stops it.
      if (step < 0 && p.pos[1] + 1.75 < c[1] && inside([def.lo[0], def.lo[1] - 4, def.lo[2]], [def.hi[0], c[1], def.hi[2]], 0.3) && c[1] - (def.hi[1] - def.lo[1]) + step < p.pos[1] + 1.8) step = 0;
      l.y += step;
      l.brush.offset = [0, l.y, 0];
      if (on && step) p.body.pos[1] += step;
      for (const f of r.foes) if (f.alive && f.body.ground === l.brush) f.body.pos[1] += step;
      l.actor.pos = [c[0], def.lo[1] + l.y, c[2]];
      l.actor.relight(r.stage.world!.grid, dt, 1);
    }

    for (const m of this.moving) {
      if (m.spin) m.actor.roll += m.spin * dt;
      if (m.swing) m.actor.roll = m.base + Math.sin(r.time * 1.4 + m.swingBase) * m.swing;
      m.actor.relight(r.stage.world!.grid, dt, 0);
    }
    for (const f of this.flares) {
      const d = dist(f.pos, eye);
      if (d > 45) continue;
      const k = 0.85 + Math.sin(r.time * 9 + f.pos[0] * 3) * 0.06 + Math.sin(r.time * 23 + f.pos[2]) * 0.04;
      const to = norm(sub(eye, f.pos));
      particles.sprite(add(f.pos, mul(to, 0.3)), f.size * 0.42 * k, SPRITE.glow, mul(f.color, 0.42 * Math.min(1, d / 4)));
      if (f.flame && d < 24 && Math.random() < dt * 14) r.fx.flame(add(f.pos, [rand(-0.2, 0.2), -0.15, rand(-0.2, 0.2)]), 0.28 * Math.min(1.4, f.size / 2), [0, 1.3, 0]);
    }

    this.near = null;
    for (const l of this.levers) {
      l.k = lerp(l.k, l.on ? 1 : 0, ease(9, dt));
      l.actor.part("arm")!.rx = -0.2 + l.k * 2.1;
      l.actor.glow = l.on ? 0.3 : 1 + Math.sin(r.time * 5) * 0.4;
      l.actor.relight(r.stage.world!.grid, dt, 0.5);
      if (!l.on) {
        lights.put(add(l.actor.pos, [0, 0.4, 0]), [0.9, 0.4, 0.08], 3);
        if (dist(p.eye, l.actor.pos) < 2.6) this.near = l;
      }
    }
    if (use && this.near) this.pull(this.near);

    for (const item of this.items) {
      item.age += dt;
      const a = item.actor;
      if (item.drop) {
        item.life -= dt;
        if (item.life <= 0) item.taken = true;
        item.vel[1] -= 16 * dt;
        const pull = dist(p.centre, item.pos);
        if (pull < num("magnet", 4) && item.age % 100 > 0.35 && this.wanted(item.def.kind)) item.vel = mul(norm(sub(p.centre, item.pos)), 13);
        const to = add(item.pos, mul(item.vel, dt));
        const t = r.level.collision.trace(item.pos, to, 0.12, 0.12, 0.12);
        if (t.fraction < 1 && !t.startSolid) {
          item.pos = t.end;
          const into = item.vel[0] * t.normal[0] + item.vel[1] * t.normal[1] + item.vel[2] * t.normal[2];
          for (let k = 0; k < 3; k++) ((item.vel[k] -= t.normal[k] * into * 1.3), (item.vel[k] *= 0.6));
        } else item.pos = to;
        if (r.moltenAt(item.pos) !== null) item.vel[1] = 7;
      }
      const d = dist(item.pos, eye);
      a.mesh.setEnabled(d < 50);
      if (d > 50) continue;
      const gun = a.scale > 1.2;
      a.pos = [item.pos[0], item.pos[1] + (item.drop ? -0.12 : 0.12) + Math.sin(item.age * 2.6) * 0.06 + (gun ? 0.75 : 0), item.pos[2]];
      a.yaw = item.age * 1.6;
      if (gun) a.pitch = -0.15;
      a.glow = 1.1 + Math.sin(item.age * 4) * 0.25;
      a.relight(r.stage.world!.grid, dt, 0.5);
      const c = COLOR_OF[item.def.kind] ?? CYAN;
      const big = gun || item.def.kind.startsWith("key") || ["heart", "whiteheat"].includes(item.def.kind);
      if (!item.drop) particles.ground(add(item.pos, [0, 0.03, 0]), big ? 0.95 : 0.6, SPRITE.ring, mul(c, 0.4 + Math.sin(item.age * 4) * 0.1), 1, 1);
      particles.sprite(add(a.pos, [0, gun ? 0.05 : 0.22, 0]), big ? 0.95 : 0.42, SPRITE.glow, mul(c, big ? 0.22 : 0.14));
      if (big) {
        if (d < 25) lights.put(add(a.pos, [0, 0.4, 0]), mul(c, 0.7), 3.6);
        if (Math.random() < dt * 5) particles.spawn(add(a.pos, [rand(-0.4, 0.4), rand(-0.3, 0.5), rand(-0.4, 0.4)]), { vel: [0, rand(0.3, 0.8), 0], color: c, life: 0.8, size: 0.025 });
      }
      const reach = item.drop ? 1.1 : 1.15;
      if (p.alive && Math.hypot(item.pos[0] - p.pos[0], item.pos[2] - p.pos[2]) < reach + p.body.radius && item.pos[1] > p.pos[1] - 1 && item.pos[1] < p.pos[1] + 2.1 && this.take(item)) {
        item.taken = true;
        if (item.index >= 0) {
          this.taken.add(item.index);
          if (this.refill > 0) this.respawn.push({ item: item.index, at: r.time + this.refill });
        }
      }
    }
    this.items = this.items.filter((i) => {
      if (i.taken) i.actor.dispose();
      return !i.taken;
    });
    this.respawn = this.respawn.filter((x) => {
      if (r.time < x.at) return true;
      this.taken.delete(x.item);
      const it = this.addItem(r.level.items[x.item], x.item);
      r.fx.ring(add(it.pos, [0, 0.5, 0]), 1, CYAN);
      r.sfx.play("respawn", { pos: it.pos, vol: 0.4 });
      return false;
    });

    r.level.triggers.forEach((t, i) => {
      if (this.triggersDone.has(i) || !inside(t.lo, t.hi)) return;
      this.triggersDone.add(i);
      if (t.text) r.say(t.text, 4);
      for (const s of t.fire) this.fire(s);
    });
    r.level.secrets.forEach((s, i) => {
      if (this.found.has(i) || !inside(s.lo, s.hi)) return;
      this.found.add(i);
      r.sfx.play("secret", { vol: 1 });
      r.hud.banner("A secret", s.name);
    });
    r.level.checkpoints.forEach((c, i) => {
      if (this.passed.has(i) || !inside(c.lo, c.hi)) return;
      this.passed.add(i);
      r.saveCheckpoint(i);
    });
    const x = r.level.exit;
    if (x && !r.done) {
      const c: V3 = [(x.lo[0] + x.hi[0]) / 2, x.lo[1], (x.lo[2] + x.hi[2]) / 2];
      if (dist(c, eye) < 60) {
        const w = Math.min(x.hi[0] - x.lo[0], x.hi[2] - x.lo[2]) / 2;
        for (let k = 0; k < 4; k++) particles.ground(add(c, [0, 0.05 + ((r.time * 0.6 + k / 4) % 1) * 2.2, 0]), w * 0.9, SPRITE.wave, mul([1.4, 0.8, 0.25], 1 - ((r.time * 0.6 + k / 4) % 1)), 1, 1);
        lights.put(add(c, [0, 1.2, 0]), [1.8, 1, 0.35], 7);
      }
      if (inside(x.lo, x.hi)) r.finish();
    }
  }
  private wanted(kind: string) {
    const p = this.r.player;
    if (kind === "vial") return p.health < 100;
    if (kind === "shard") return p.armour < 100;
    return true;
  }

  snapshot() {
    return { fired: [...this.fired], taken: [...this.taken], found: [...this.found], passed: [...this.passed], triggers: [...this.triggersDone], levers: this.levers.map((l) => l.on), doors: this.doors.map((d) => d.open && (!d.def.auto || Boolean(d.def.key))), unlocked: this.doors.map((d) => d.unlocked) };
  }
  restore(s: ReturnType<Live["snapshot"]>) {
    this.fired = new Set(s.fired);
    this.taken = new Set(s.taken);
    this.found = new Set(s.found);
    this.passed = new Set(s.passed);
    this.triggersDone = new Set(s.triggers);
    this.levers.forEach((l, i) => ((l.on = s.levers[i]), (l.k = l.on ? 1 : 0)));
    this.doors.forEach((d, i) => {
      d.open = s.doors[i];
      d.unlocked = s.unlocked[i];
      if (!d.open) return;
      d.k = 0.99;
      if (d.def.tex !== "door") ((d.brush.enabled = false), d.actor.mesh.setEnabled(false), (d.k = 1));
    });
    for (const i of this.items) if (i.index >= 0 && this.taken.has(i.index)) i.taken = true;
  }
  dispose() {
    for (const d of this.doors) (d.actor.dispose(), d.sigils.forEach((s) => s.dispose()));
    for (const l of this.lifts) l.actor.dispose();
    for (const i of this.items) i.actor.dispose();
    for (const l of this.levers) l.actor.dispose();
    for (const m of this.moving) m.actor.dispose();
    Actor.forget(this.r.stage.scene, "door ");
    Actor.forget(this.r.stage.scene, "lift ");
  }
}
