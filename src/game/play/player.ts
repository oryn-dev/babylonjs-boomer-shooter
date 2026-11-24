import type { Foe } from "../foes/foe";
import { SPRITE } from "../gfx/particles";
import type { KeyName } from "../level/build";
import { add, clamp, ease, lerp, norm, rand, sub, type V3 } from "../level/vec";
import { num } from "../tune";
import { Arsenal } from "./arsenal";
import { Body } from "./body";
import type { Intent } from "./controls";
import type { Run } from "./run";
import { type Ammo, AMMO_MAX, AMMO_OF, type WeaponId } from "./types";

export interface PlayerState {
  health: number; armour: number; ammo: Record<Ammo, number>; owned: WeaponId[]; weapon: WeaponId; keys: KeyName[];
}
export const freshState = (): PlayerState => ({ health: 100, armour: 0, ammo: { shells: 0, blades: 0, cells: 0, slag: 0, peals: 0 }, owned: ["rivet"], weapon: "rivet", keys: [] });
const EYE = 1.52;

export class Player {
  readonly body: Body;
  readonly arsenal: Arsenal;
  yaw: number;
  pitch = 0;
  alive = true;
  health: number;
  armour: number;
  ammo: Record<Ammo, number>;
  owned: WeaponId[];
  keys: Set<KeyName>;
  /** Seconds of the white-heat pickup left. */
  blessed = 0;
  charges = 2;
  hurtFlash = 0;
  healFlash = 0;
  /** Where the last blows came from, for the mask. */
  blows: { angle: number; life: number; amount: number }[] = [];
  private dashLeft = 0;
  private dashDir: V3 = [0, 0, 1];
  private recharge = 0;
  private coyote = 0;
  private jumped = 0;
  private jumpHeld = false;
  private buffer = 0;
  private bob = 0;
  private land = 0;
  private eyeLift = 0;
  private lean = 0;
  private kickPitch = 0;
  private kickVel = 0;
  private burnt = 0;
  private hooked: Foe | null = null;
  private hookLeft = 0;
  private step = 0;
  private lastY = 0;
  safe = 0;
  dashFov = 0;
  bobAmount = 1;
  /** For the hand's sway. */
  sway = { x: 0, y: 0 };

  constructor(readonly r: Run, pos: V3, yaw: number, state: PlayerState) {
    this.body = new Body([...pos], 0.34, 1.75, r.level.collision);
    this.yaw = yaw;
    this.health = state.health;
    this.armour = state.armour;
    this.ammo = { ...state.ammo };
    this.owned = [...state.owned];
    this.keys = new Set(state.keys);
    this.lastY = pos[1];
    this.arsenal = new Arsenal(r, this, state.weapon);
  }
  state(): PlayerState {
    return { health: Math.max(1, Math.round(this.health)), armour: Math.round(this.armour), ammo: { ...this.ammo }, owned: [...this.owned], weapon: this.arsenal.current, keys: [...this.keys] };
  }
  get pos() {
    return this.body.pos;
  }
  get centre(): V3 {
    return [this.pos[0], this.pos[1] + 0.95, this.pos[2]];
  }
  get eye(): V3 {
    return [this.pos[0], this.pos[1] + EYE, this.pos[2]];
  }
  get forward(): V3 {
    const c = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * c, -Math.sin(this.pitch), Math.cos(this.yaw) * c];
  }
  get speed() {
    return Math.hypot(this.body.vel[0], this.body.vel[2]);
  }
  get dashing() {
    return this.dashLeft > 0;
  }

  give(ammo: Ammo, n: number, quiet = false) {
    if (this.ammo[ammo] >= AMMO_MAX[ammo]) return false;
    this.ammo[ammo] = Math.min(AMMO_MAX[ammo], this.ammo[ammo] + n);
    if (!quiet) this.r.hud.pulse("ammo");
    return true;
  }
  heal(n: number, max = 100) {
    if (this.health >= max) return false;
    this.health = Math.min(max, this.health + n);
    this.healFlash = Math.max(this.healFlash, 0.5);
    return true;
  }
  plate(n: number, max = 100) {
    if (this.armour >= max) return false;
    this.armour = Math.min(max, this.armour + n);
    this.healFlash = Math.max(this.healFlash, 0.4);
    return true;
  }
  reel(f: Foe) {
    this.hooked = f;
    this.hookLeft = 0.75;
  }
  kick(pitch: number) {
    this.kickVel -= pitch;
  }

  hurt(amount: number, from: V3, push: V3 = [0, 0, 0]) {
    const { r } = this;
    if (!this.alive || r.done || this.dashLeft > 0.06 || this.safe > 0) return;
    let left = amount * r.rules.hurt * num("damage_taken", 1);
    const soak = Math.min(this.armour, left * 0.6);
    this.armour -= soak;
    left -= soak;
    this.health -= r.god ? 0 : left;
    for (let i = 0; i < 3; i++) this.body.vel[i] += push[i];
    if (push[1] > 3) this.body.grounded = false;
    const d = sub(from, this.pos);
    this.blows.push({ angle: Math.atan2(d[0], d[2]) - this.yaw, life: 1.1, amount: left });
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.25 + left * 0.02);
    r.fx.kick(Math.min(0.5, 0.15 + left * 0.015));
    this.kickVel += rand(-1, 1) + left * 0.03;
    r.sfx.play(soak > left ? "hurt_plate" : "hurt", { vol: 0.8, rate: rand(0.95, 1.06), gap: 0.09 });
    r.tookDamage = (r.tookDamage ?? 0) + left;
    if (this.health <= 0) this.die();
  }
  die() {
    this.health = 0;
    this.alive = false;
    this.arsenal.drop();
    this.r.sfx.play("death", { vol: 1 });
    this.r.playerDied();
  }

  update(dt: number, i: Intent) {
    const { body, r } = this;
    if (this.alive) {
      this.yaw += i.turn;
      this.pitch = clamp(this.pitch + i.pitch, -1.5, 1.5);
      this.sway.x = lerp(this.sway.x, clamp(i.turn / Math.max(dt, 0.004), -6, 6), ease(12, dt));
      this.sway.y = lerp(this.sway.y, clamp(i.pitch / Math.max(dt, 0.004), -6, 6), ease(12, dt));
      this.walk(dt, i);
      this.arsenal.update(dt, i);
    } else {
      body.vel[1] -= 20 * dt;
      body.friction(4, 1, dt);
      body.move(dt, 0);
      this.eyeLift = lerp(this.eyeLift, -1.15, ease(4, dt));
      this.lean = lerp(this.lean, 0.5, ease(3, dt));
    }
    this.safe -= dt;
    this.blessed = Math.max(0, this.blessed - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.9);
    this.healFlash = Math.max(0, this.healFlash - dt * 2.5);
    this.blows = this.blows.filter((b) => (b.life -= dt) > 0);
    if (this.pos[1] < r.floor - 14) this.die();
  }

  private walk(dt: number, i: Intent) {
    const { body, r } = this;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = i.move.x * cos + i.move.y * sin;
    let wz = -i.move.x * sin + i.move.y * cos;
    const wl = Math.hypot(wx, wz);
    const run = num("run_speed", 9.4);
    if (wl > 1e-3) ((wx /= wl), (wz /= wl));

    // A press just before landing still jumps; holding keeps hopping.
    if (i.jump && !this.jumpHeld) this.buffer = 0.14;
    this.jumpHeld = i.jump;
    this.buffer -= dt;
    this.jumped -= dt;
    this.coyote = body.grounded ? 0.09 : this.coyote - dt;
    const wantsJump = this.buffer > 0 || (i.jump && body.grounded);

    this.recharge = this.charges < 2 ? this.recharge + dt : 0;
    if (this.recharge > num("dash_recharge", 1.5)) ((this.recharge = 0), this.charges++, r.sfx.play("dash_ready", { vol: 0.25 }));
    if (i.dash && this.charges > 0 && this.dashLeft <= 0) {
      this.charges--;
      this.dashLeft = 0.17;
      this.dashDir = wl > 0.1 ? [wx, 0, wz] : [sin, 0, cos];
      this.hooked = null;
      this.dashFov = 1;
      r.sfx.play("dash", { vol: 0.7, rate: rand(0.96, 1.05) });
      r.fx.steam([this.pos[0], this.pos[1] + 0.3, this.pos[2]], [-this.dashDir[0], 0.2, -this.dashDir[2]], 8, 0.22);
    }
    this.dashFov = Math.max(0, this.dashFov - dt * 3.2);

    if (this.hooked) {
      this.hookLeft -= dt;
      const d = sub(this.hooked.centre, this.centre);
      const l = Math.hypot(...d);
      if (this.hookLeft <= 0 || l < 2 || !this.hooked.alive) this.hooked = null;
      else {
        for (let a = 0; a < 3; a++) body.vel[a] = lerp(body.vel[a], (d[a] / l) * 16, ease(8, dt));
        r.stage.particles.beam(this.hooked.actor.point("hookR"), [this.pos[0], this.pos[1] + 1, this.pos[2]], 0.03, SPRITE.beam, [0.5, 0.9, 0.7], 0.6);
      }
    }

    if (this.dashLeft > 0) {
      this.dashLeft -= dt;
      const v = num("dash_speed", 23);
      body.vel = [this.dashDir[0] * v, body.grounded ? 0 : Math.max(0, body.vel[1] * 0.5), this.dashDir[2] * v];
      if (this.dashLeft <= 0) {
        const keep = run * 1.3;
        body.vel[0] = this.dashDir[0] * keep;
        body.vel[2] = this.dashDir[2] * keep;
      }
    } else if (body.grounded && !wantsJump) {
      body.friction(num("friction", 8), 3.2, dt);
      if (wl > 1e-3) body.accelerate(wx, wz, run * Math.min(1, wl), 11, dt);
    } else if (wl > 1e-3 && !this.hooked) {
      // In the air: turn the flight towards the wish, and let a strafe gain a little speed.
      const s = this.speed;
      const along = s > 0.1 ? (body.vel[0] * wx + body.vel[2] * wz) / s : 1;
      body.accelerate(wx, wz, along > 0.7 ? run : Math.min(run, 4.5), along > 0.7 ? 2.4 : 7, dt);
      const s2 = this.speed;
      if (s2 > 1 && along > 0) {
        const k = num("air_control", 6) * along * along * dt;
        const nx = body.vel[0] / s2 + wx * k;
        const nz = body.vel[2] / s2 + wz * k;
        const n = Math.hypot(nx, nz);
        const keep = Math.min(s2 + (i.jump ? dt * 1.6 * (1 - along) : 0), 18);
        body.vel[0] = (nx / n) * keep;
        body.vel[2] = (nz / n) * keep;
      }
      const top = num("top_speed", 18);
      const now = this.speed;
      if (now > top) ((body.vel[0] *= top / now), (body.vel[2] *= top / now));
    }
    if (this.buffer > 0 || (i.jump && body.grounded)) {
      if ((body.grounded || this.coyote > 0) && this.jumped <= 0) {
        body.vel[1] = num("jump_speed", 8.4) + Math.max(0, body.ground?.offset ? this.liftSpeed() : 0);
        body.grounded = false;
        this.coyote = 0;
        this.buffer = 0;
        this.jumped = 0.2;
        r.sfx.play("jump", { vol: 0.3, rate: rand(0.95, 1.08) });
      }
    }
    if (this.dashLeft <= 0) body.vel[1] -= num("gravity", 22) * dt;
    const fall = body.vel[1];
    const was = body.grounded;
    body.move(dt, 0.6);
    if (body.grounded && !was && fall < -4) {
      this.land = Math.min(0.32, -fall * 0.02);
      r.sfx.play("land", { vol: clamp(-fall / 20, 0.15, 0.8) });
      if (fall < -13) r.fx.kick(0.25);
    }
    // Steps under the feet are smoothed for the eye.
    const jumpUp = this.pos[1] - this.lastY;
    if (body.grounded && was && Math.abs(jumpUp) > 0.08 && Math.abs(jumpUp) < 0.8) this.eyeLift -= jumpUp;
    this.lastY = this.pos[1];
    this.eyeLift = lerp(this.eyeLift, 0, ease(14, dt));

    for (const p of r.level.pads)
      if (this.pos[0] > p.lo[0] && this.pos[0] < p.hi[0] && this.pos[2] > p.lo[2] && this.pos[2] < p.hi[2] && this.pos[1] > p.lo[1] - 0.2 && this.pos[1] < p.hi[1] && body.vel[1] < 2) {
        body.vel = [...p.velocity];
        body.grounded = false;
        this.dashLeft = 0;
        r.sfx.play("pad", { vol: 0.8 });
        r.fx.steam(this.pos, [0, 1, 0], 10, 0.3);
      }
    const molten = r.moltenAt(this.pos);
    this.burnt -= dt;
    if (molten !== null && this.burnt <= 0) {
      this.burnt = 0.5;
      this.hurt(18, add(this.pos, [0, -1, 0]));
      const v = Math.sqrt(2 * num("gravity", 22) * (clamp(r.rimAbove(this.pos, molten) - this.pos[1] + 0.9, 1, 8)));
      body.vel[1] = Math.max(body.vel[1], v);
      body.grounded = false;
      this.charges = Math.max(1, this.charges);
      r.sfx.play("sizzle", { vol: 1 });
      r.stage.particles.burst(this.pos, 16, [2, 7], { color: [2.2, 0.9, 0.2], end: [0.5, 0.05, 0.01], life: 0.6, size: 0.12, cell: SPRITE.drop, gravity: 10 }, [0, 1, 0]);
    }

    if (body.grounded && this.speed > 2) {
      this.bob += this.speed * dt;
      this.step += this.speed * dt;
      if (this.step > 2.7) ((this.step = 0), r.sfx.play(r.surfaceUnder(), { vol: 0.22, rate: rand(0.92, 1.1) }));
    }
    const side = body.vel[0] * cos - body.vel[2] * sin;
    this.lean = lerp(this.lean, -side * 0.0016, ease(8, dt));
    this.land = lerp(this.land, 0, ease(9, dt));
    this.kickVel += (-this.kickPitch * 190 - this.kickVel * 17) * dt;
    this.kickPitch += this.kickVel * dt;
  }
  private liftSpeed() {
    return this.r.live.liftSpeed(this.body.ground);
  }

  /** Where the camera stands and looks this frame. */
  view(time: number, shakeAmount: number): { eye: V3; yaw: number; pitch: number; roll: number } {
    const s = this.r.fx.shake * shakeAmount;
    const n = (k: number) => Math.sin(time * 47 * k + k * 13) * 0.6 + Math.sin(time * 71 * k + k * 5) * 0.4;
    const walk = this.body.grounded && this.alive ? clamp(this.speed / 9, 0, 1) * this.bobAmount : 0;
    const b = Math.abs(Math.sin(this.bob * 0.85)) * 0.045 * walk;
    return {
      eye: [this.pos[0] + n(1.1) * s * 0.03, this.pos[1] + EYE + this.eyeLift + b - this.land + n(0.9) * s * 0.03, this.pos[2] + n(1.3) * s * 0.03],
      yaw: this.yaw + n(0.7) * s * 0.006,
      pitch: this.pitch + this.kickPitch * 0.02 + n(1.2) * s * 0.008,
      roll: this.lean + Math.sin(this.bob * 0.85) * 0.003 * walk + n(0.8) * s * 0.012,
    };
  }
  get bobPhase() {
    return this.bob;
  }
  get landing() {
    return this.land;
  }
  /** Aim point for assist: a little help towards the nearest machine near the crosshair. */
  assist(dt: number, strength: number) {
    let best: Foe | null = null;
    let score = 0.14;
    const f = this.forward;
    for (const e of this.r.foes) {
      if (!e.alive || !e.sees || e.range > 40) continue;
      const d = norm(sub(e.centre, this.eye));
      const off = Math.acos(clamp(d[0] * f[0] + d[1] * f[1] + d[2] * f[2], -1, 1));
      const size = e.kind.radius / Math.max(2, e.range);
      if (off - size < score) ((score = off - size), (best = e));
    }
    if (!best) return null;
    const d = sub(best.centre, this.eye);
    const yaw = Math.atan2(d[0], d[2]);
    const pitch = -Math.atan2(d[1], Math.hypot(d[0], d[2]));
    const dy = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    this.yaw += dy * ease(strength, dt);
    this.pitch += (pitch - this.pitch) * ease(strength, dt);
    return Math.abs(dy) < best.kind.radius / Math.max(2, best.range) + 0.03 ? best : null;
  }
  ammoFor(w: WeaponId) {
    const a = AMMO_OF[w];
    return a ? this.ammo[a] : Infinity;
  }
}
