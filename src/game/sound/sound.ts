import type { AudioEngineV2 } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import type { StaticSound } from "@babylonjs/core/AudioV2/abstractAudio/staticSound";
import { clamp, type V3 } from "../level/vec";
import type { Sfx } from "../play/run";

const NAMES = "rivet rivet_white shotgun shotgun_white nail blade mortar bell_wind bell_big gust recall orb dry hammer_swing hammer_hit hammer_wall swap ready white vent zap saw_hit blade_wall blade_back ricochet pin fizz flame explode hurt hurt_plate death dash dash_ready jump land pad sizzle step_stone step_metal step_iron step_heavy stoker_swing slash usher_charge usher_fire shield break clank fuse ringer_wind slam censer_charge ember deacon_wind wire hooked choir_sing boss_roar boss_wind boss_open organ_stab kill arrive pick vial plate key weapon great respawn secret checkpoint unlock exit locked door door_shut door_end lift lift_end lever".split(" ");
for (const k of ["stoker", "usher", "censer", "deacon", "crucible", "ringer", "choir", "boss"]) for (const s of ["wake", "hit", "die"]) NAMES.push(`${k}_${s}`);
const LOOPS = ["lance", "roll", "choir"];
const PAD = 0.12;
const BARS = (8 * 4 * 60) / 132;

/** Effects with distance and side, and two music layers that swell with the fight. */
export class Sound implements Sfx {
  private bank = new Map<string, StaticSound>();
  private loops = new Map<string, { s: StaticSound; seen: number; name: string }>();
  private last = new Map<string, number>();
  private calm: StaticSound | null = null;
  private fight: StaticSound | null = null;
  private started = false;
  private level = { calm: 0, fight: 0 };
  ear = { pos: [0, 0, 0] as V3, yaw: 0 };
  musicVolume = 1;
  private now = 0;

  constructor(private audio: AudioEngineV2, private url: (path: string) => string) {}

  async load() {
    const one = async (name: string) => {
      try {
        this.bank.set(name, await this.audio.createSoundAsync(name, this.url(`audio/${name}.mp3`), { maxInstances: 5, stereoEnabled: true }));
      } catch {
        // A missing sound stays silent.
      }
    };
    const list = [...NAMES, ...LOOPS];
    for (let i = 0; i < list.length; i += 12) await Promise.all(list.slice(i, i + 12).map(one));
    const music = (n: string) => this.audio.createSoundAsync(n, this.url(`audio/${n}.mp3`), { loop: true, loopStart: PAD, loopEnd: PAD + BARS, volume: 0, maxInstances: 1 });
    try {
      [this.calm, this.fight] = await Promise.all([music("calm"), music("fight")]);
      if (this.started) this.begin();
    } catch {
      // The game plays without music.
    }
  }
  private place(pos?: V3 | null) {
    if (!pos) return { k: 1, pan: 0 };
    const dx = pos[0] - this.ear.pos[0], dy = pos[1] - this.ear.pos[1], dz = pos[2] - this.ear.pos[2];
    const d = Math.hypot(dx, dy, dz);
    const side = d > 0.5 ? (dx * Math.cos(this.ear.yaw) - dz * Math.sin(this.ear.yaw)) / d : 0;
    return { k: clamp(1.25 / (1 + d * 0.09) - 0.16, 0, 1), pan: side * 0.75 };
  }
  play(name: string, o: { pos?: V3; vol?: number; rate?: number; gap?: number } = {}) {
    const s = this.bank.get(name);
    if (!s) return;
    if (this.now - (this.last.get(name) ?? -9) < (o.gap ?? 0.025)) return;
    this.last.set(name, this.now);
    const { k, pan } = this.place(o.pos);
    const volume = (o.vol ?? 1) * k * 0.7;
    if (volume < 0.012) return;
    if (s.stereo) s.stereo.pan = pan;
    s.playbackRate = o.rate ?? 1;
    s.play({ volume });
  }
  loop(id: string, name: string, pos: V3 | null, vol: number, rate: number) {
    let l = this.loops.get(id);
    if (!l) {
      const source = this.bank.get(name);
      if (!source || [...this.loops.values()].some((x) => x.name === name)) return;
      source.loop = true;
      source.volume = 0;
      source.play();
      l = { s: source, seen: this.now, name };
      this.loops.set(id, l);
    }
    l.seen = this.now;
    const { k, pan } = this.place(pos);
    l.s.volume = vol * k * 0.5;
    l.s.playbackRate = rate;
    if (l.s.stereo) l.s.stereo.pan = pan;
  }
  unlock() {
    void this.audio.unlockAsync().then(() => this.begin()).catch(() => undefined);
  }
  private begin() {
    this.started = true;
    for (const m of [this.calm, this.fight]) if (m && !m.activeInstancesCount) m.play({ startOffset: PAD });
  }
  quiet() {
    for (const l of this.loops.values()) l.s.stop();
    this.loops.clear();
  }
  update(dt: number, calm: number, fight: number) {
    this.now += dt;
    for (const [id, l] of this.loops) if (this.now - l.seen > 0.15) (l.s.stop(), this.loops.delete(id));
    const go = (k: "calm" | "fight", want: number, s: StaticSound | null) => {
      this.level[k] += (want - this.level[k]) * Math.min(1, dt * 2);
      if (s) s.volume = this.level[k] * this.musicVolume;
    };
    go("calm", calm * 0.4, this.calm);
    go("fight", fight * 0.42, this.fight);
  }
}
