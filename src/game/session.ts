import type { Game, GameContext } from "../oryn/context";
import { saves } from "../oryn/saves";
import { settings, updateSettings } from "../oryn/settings";
import { Nav } from "./foes/nav";
import { Stage } from "./gfx/stage";
import { LevelBuilder } from "./level/build";
import { LEVELS } from "./level/maps";
import { clamp } from "./level/vec";
import { Controls, type Intent } from "./play/controls";
import { Run, type Snapshot } from "./play/run";
import { Sound } from "./sound/sound";
import { DIFFICULTY, type Difficulty } from "./tune";
import { Hud } from "./ui/hud";
import { Menu, type Row } from "./ui/menu";

type State = "title" | "playing" | "paused" | "dead" | "won";
interface Options { sensitivity: number; fov: number; bob: number; shake: number; pixels: number; music: number; invert: boolean; autoFire: boolean; difficulty: Difficulty }
interface Save { options: Options; best: Record<string, { time: number; kills: number; secrets: number }> }
const LEVEL = "pit";
const DEFAULTS: Options = { sensitivity: 1, fov: 100, bob: 1, shake: 1, pixels: 1, music: 1, invert: false, autoFire: true, difficulty: 1 };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Title, play, pause, death and the end tally. */
export class Session implements Game {
  readonly stage: Stage;
  private hud: Hud;
  private controls: Controls;
  private menu: Menu;
  private sound: Sound;
  private level!: LevelBuilder;
  private nav!: Nav;
  run!: Run;
  state: State = "title";
  private save: Save = { options: { ...DEFAULTS }, best: {} };
  private checkpoint: Snapshot | null = null;
  private time = 0;
  private fade = 1;
  private fadeTo = 0;
  private after: (() => void) | null = null;
  private wantLock = false;
  private portrait = window.matchMedia("(orientation: portrait) and (max-width: 560px)");
  /** Scripts may stand in for the player. */
  script: ((run: Run, dt: number) => Partial<Intent>) | null = null;

  constructor(private ctx: GameContext) {
    this.stage = new Stage(ctx.scene, ctx.look, ctx.assets.url);
    const ui = document.querySelector<HTMLElement>("#oryn-ui")!;
    this.hud = new Hud(ui);
    this.controls = new Controls(ctx.input, ctx.canvas, ui);
    this.menu = new Menu(ui);
    this.sound = new Sound(ctx.audio, ctx.assets.url);
    this.menu.onMove = () => this.sound.play("ready", { vol: 0.3 });
    this.menu.onPick = () => (this.sound.unlock(), this.sound.play("lever", { vol: 0.5 }));
    const turn = document.createElement("div");
    turn.className = "fc-turn";
    turn.innerHTML = "<i></i><span>Turn your phone sideways to play</span>";
    ui.append(turn);
    this.controls.owned = () => {
      const p = this.run.player;
      return (["rivet", "bellows", "chainsaw", "arclance", "mortar", "bellgun"] as const).map((w, index) => ({ w, index })).filter(({ w }) => p.owned.includes(w)).map(({ w, index }) => ({ name: ["Rivet", "Bellows", "Blades", "Arc", "Mortar", "Bell"][index], index, color: "", ammo: Number.isFinite(p.ammoFor(w)) ? String(Math.floor(p.ammoFor(w))) : "" }));
    };
    ctx.canvas.addEventListener("pointerdown", (e) => {
      this.sound.unlock();
      if (this.state === "playing" && e.pointerType === "mouse" && ctx.input.device !== "touch") this.lock();
    });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement) this.wantLock = false;
      else if (this.state === "playing" && ctx.input.device === "keyboard" && !this.wantLock) this.pause();
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.state === "playing") this.pause(); });
    this.portrait.addEventListener("change", () => { if (this.portrait.matches && this.state === "playing") this.pause(); });
  }

  async load() {
    const font = new FontFace("VT323", `url(${this.ctx.assets.url("vt323.ttf")})`);
    void font.load().then((f) => document.fonts.add(f)).catch(() => undefined);
    const [saved] = await Promise.all([saves.load<Save>("furnace").catch(() => null), this.stage.load()]);
    if (saved?.options) this.save = { options: { ...DEFAULTS, ...saved.options }, best: saved.best ?? {} };
    this.level = new LevelBuilder();
    LEVELS[LEVEL](this.level);
    this.level.finish();
    await this.stage.show(LEVEL, this.level);
    this.nav = new Nav(this.level, this.level.collision);
    void this.sound.load();
    this.applyOptions();
    this.begin(null);
    this.title();
  }
  private get o() {
    return this.save.options;
  }
  private store() {
    void saves.save("furnace", this.save).catch(() => undefined);
  }
  private applyOptions() {
    this.stage.pixelLook = this.o.pixels;
    this.stage.sharpness();
    this.sound.musicVolume = this.o.music;
  }
  private lock() {
    if (document.pointerLockElement) return;
    const p = this.ctx.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    p?.catch?.(() => undefined);
  }

  private begin(snap: Snapshot | null) {
    this.run?.dispose();
    this.sound.quiet();
    this.hud.reset();
    this.run = new Run(this.stage, this.level, this.nav, LEVEL, this.sound, this.hud, this.o.difficulty, false, null, snap);
    this.run.onCheckpoint = (s) => (this.checkpoint = s);
  }
  private go(state: State) {
    this.state = state;
    const on = state === "playing";
    this.controls.setActive(on);
    this.hud.visible = on || state === "dead";
    if (!on && document.pointerLockElement) document.exitPointerLock();
    if (on) this.menu.hide();
  }
  private through(fn: () => void) {
    this.fadeTo = 1;
    this.after = fn;
  }

  private title() {
    this.go("title");
    const best = this.save.best[LEVEL];
    const rows: Row[] = [
      { label: "Play", act: () => this.start() },
      { label: "Difficulty", value: () => DIFFICULTY[this.o.difficulty].name, step: (d) => ((this.o.difficulty = ((this.o.difficulty + d + 3) % 3) as Difficulty), this.store()) },
      { label: "Options", act: () => this.options(() => this.title()) },
      { label: "Controls", act: () => this.help(() => this.title()) },
    ];
    this.menu.show({ title: "Furnace Choir", big: true, lines: best ? [`Best time ${clock(best.time)}, ${best.secrets} of ${this.level.secrets.length} secrets`] : ["The ironworks grew into a cathedral. Its workers became the choir."], rows });
  }
  private start() {
    if (this.ctx.input.device === "keyboard") this.lock();
    this.through(() => {
      this.checkpoint = null;
      this.begin(null);
      this.go("playing");
      this.hud.banner("The Casting Pit", "");
    });
  }
  private retry() {
    if (this.ctx.input.device === "keyboard") this.lock();
    this.through(() => {
      this.begin(this.checkpoint);
      this.go("playing");
    });
  }
  private pause() {
    if (this.state !== "playing" || this.run.done) return;
    this.go("paused");
    this.sound.quiet();
    this.menu.show({
      title: "Paused",
      back: () => this.resume(),
      rows: [
        { label: "Continue", act: () => this.resume() },
        { label: this.checkpoint ? "Back to checkpoint" : "Start again", act: () => this.retry() },
        { label: "Options", act: () => this.options(() => ((this.state = "playing"), this.pause())) },
        { label: "Controls", act: () => this.help(() => ((this.state = "playing"), this.pause())) },
        { label: "Title", act: () => this.through(() => (this.begin(null), this.title())) },
      ],
    });
  }
  private resume() {
    if (this.ctx.input.device === "keyboard") this.lock();
    this.go("playing");
  }
  private options(back: () => void) {
    const o = this.o;
    const pct = (v: number) => `${Math.round(v * 100)} %`;
    const set = (fn: () => void) => (fn(), this.applyOptions(), this.store());
    this.menu.show({
      title: "Options", back,
      rows: [
        { label: "Volume", value: () => pct(settings.volume), step: (d) => updateSettings({ volume: clamp(Math.round((settings.volume + d * 0.1) * 10) / 10, 0, 1) }) },
        { label: "Music", value: () => pct(o.music), step: (d) => set(() => (o.music = clamp(Math.round((o.music + d * 0.1) * 10) / 10, 0, 1))) },
        { label: "Look speed", value: () => pct(o.sensitivity), step: (d) => set(() => (o.sensitivity = clamp(Math.round((o.sensitivity + d * 0.1) * 10) / 10, 0.3, 3))) },
        { label: "Invert look", value: () => (o.invert ? "On" : "Off"), step: () => set(() => (o.invert = !o.invert)) },
        { label: "Field of view", value: () => `${o.fov}`, step: (d) => set(() => (o.fov = clamp(o.fov + d * 5, 80, 120))) },
        { label: "Head bob", value: () => pct(o.bob), step: (d) => set(() => (o.bob = clamp(Math.round((o.bob + d * 0.25) * 4) / 4, 0, 1))) },
        { label: "Shake", value: () => pct(o.shake), step: (d) => set(() => (o.shake = clamp(Math.round((o.shake + d * 0.25) * 4) / 4, 0, 1))) },
        { label: "Pixels", value: () => ["Smooth", "Fine", "Chunky"][o.pixels], step: (d) => set(() => (o.pixels = (o.pixels + d + 3) % 3)) },
        { label: "Touch auto fire", value: () => (o.autoFire ? "On" : "Off"), step: () => set(() => (o.autoFire = !o.autoFire)) },
        { label: "Back", act: back },
      ],
    });
  }
  private help(back: () => void) {
    const d = this.ctx.input.device;
    const stats: [string, string][] = d === "touch"
      ? [["Move", "Left thumb"], ["Look", "Drag on the right"], ["Star", "Fire"], ["Ring", "Second fire"], ["Arrows", "Jump, dash"], ["Hammer", "Melee"], ["Swap, hold", "Weapon wheel"]]
      : d === "gamepad"
        ? [["Move, look", "Sticks"], ["Fire, second", "RT, LT"], ["Jump, dash", "A, B"], ["Hammer, use", "RB, X"], ["Weapons", "Y, LB"]]
        : [["Move", "W A S D"], ["Fire, second", "Mouse"], ["Jump, dash", "Space, Shift"], ["Hammer", "Q"], ["Weapons", "1 to 6, wheel"], ["Use", "E"], ["Pause", "Esc"]];
    this.menu.show({ title: "Controls", stats, lines: ["Heat makes shots stronger. At the limit the weapon vents and stuns all around you.", "Hammer kills drop more and cool the weapon."], back, rows: [{ label: "Back", act: back }] });
  }
  private died() {
    this.go("dead");
    this.menu.show({ title: "Gone cold", lines: [this.checkpoint ? "The furnace keeps your place." : "The choir sings on."], rows: [{ label: this.checkpoint ? "From checkpoint" : "Try again", act: () => this.retry() }, { label: "Title", act: () => this.through(() => ((this.checkpoint = null), this.begin(null), this.title())) }] });
  }
  private won() {
    this.go("won");
    const r = this.run;
    const old = this.save.best[LEVEL];
    if (!old || r.time < old.time) this.save.best[LEVEL] = { time: r.time, kills: r.kills, secrets: r.live.found.size };
    this.store();
    this.menu.show({
      title: "The gate is yours",
      stats: [["Machines", `${r.kills} / ${r.kills + r.foes.filter((f) => f.alive).length}`], ["Secrets", `${r.live.found.size} / ${this.level.secrets.length}`], ["Time", clock(r.time)], ["Par", clock(this.level.par)], ["Score", `${Math.round(r.score)}`], ["Best chain", `${r.bestCombo}`]],
      lines: [old && r.time < old.time ? `New best time, ${clock(old.time - r.time)} faster.` : r.time < this.level.par ? "Under par." : ""].filter(Boolean),
      rows: [{ label: "Play again", act: () => this.start() }, { label: "Title", act: () => this.through(() => (this.begin(null), this.title())) }],
    });
  }

  update(dt: number) {
    const { stage, run, controls, ctx, o } = this;
    this.time += dt;
    this.menu.poll();
    this.fade = clamp(this.fade + Math.sign(this.fadeTo - this.fade) * dt * 3.2, Math.min(this.fade, this.fadeTo), Math.max(this.fade, this.fadeTo));
    if (this.after && this.fade >= 1) {
      const fn = this.after;
      this.after = null;
      this.fadeTo = 0;
      fn();
      return;
    }
    stage.particles.begin();
    const touch = ctx.input.device === "touch";
    let intent = controls.read(dt, { sensitivity: o.sensitivity, invert: o.invert });
    const playing = this.state === "playing" && !this.after;
    if (playing && this.script) intent = { ...intent, ...this.script(run, dt) };
    if (playing && intent.pause) return this.pause();
    run.hideGun = this.state === "title" || this.state === "won";
    if (playing || this.state === "dead") {
      if (playing && (touch || intent.pad) && run.player.alive) {
        const t = run.player.assist(dt, touch ? 2.6 : 1.8);
        if (touch && o.autoFire && t && t.sees && run.player.arsenal.current !== "bellgun") intent.fire = true;
      }
      run.player.bobAmount = o.bob;
      run.update(dt, this.state === "dead" ? { ...intent, fire: false, alt: false, hammer: false, use: false } : intent);
      controls.showUse(Boolean(run.live.near));
      this.hud.hint = run.live.near && !touch ? "E  pull the lever" : "";
    } else {
      run.live.update(this.state === "title" ? dt : 0, false);
    }
    if (this.state === "playing" && run.ending === "dead" && run.endedFor > 1.3) this.died();
    if (this.state === "playing" && run.ending === "finished" && run.endedFor > 1) this.won();

    if (this.state === "title" || this.state === "won") {
      const a = this.time * 0.07;
      stage.fov = 92;
      stage.look([Math.sin(a) * 15.5, 6.4 + Math.sin(a * 1.7) * 0.8, Math.cos(a) * 15.5], a + Math.PI + 0.45, 0.16, 0);
    } else {
      const view = run.player.view(stage.time, o.shake);
      stage.fov = o.fov + run.player.dashFov * 8;
      stage.look(view.eye, view.yaw, view.pitch, view.roll);
      run.player.arsenal.place(view, stage.time);
    }
    this.sound.ear = { pos: stage.eye, yaw: run.player.yaw };
    const quiet = this.state === "paused" ? 0.35 : 1;
    this.sound.update(dt, (1 - (playing ? run.tension * 0.6 : 0)) * quiet, (playing ? (run.boss ? 1 : run.tension) : 0) * quiet);
    stage.retro.hurt = this.state === "title" || this.state === "won" ? 0 : Math.min(0.9, run.player.hurtFlash * 0.7 + (run.player.health < 30 && run.player.alive ? 0.12 + Math.sin(this.time * 6) * 0.05 : 0));
    stage.retro.white = playing && run.player.arsenal.whiteHeat ? 0.3 : 0;
    stage.retro.heal = playing ? run.player.healFlash * 0.4 : 0;
    stage.retro.fade = this.fade;
    if (this.state === "playing" || this.state === "dead") this.hud.draw(run, dt, touch, safeArea());
    stage.flush(this.state === "paused" ? 0 : dt);
    ctx.metric("state", this.state);
    ctx.metric("health", Math.round(run.player.health));
    ctx.metric("kills", run.kills);
    ctx.metric("foes", run.foes.length);
    ctx.metric("time", Math.round(run.time));
    ctx.metric("secrets", run.live.found.size);
  }
}

let probe: HTMLElement | null = null;
function safeArea() {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)";
    document.body.append(probe);
  }
  const s = getComputedStyle(probe);
  const n = (v: string) => parseFloat(v) || 0;
  return { l: n(s.paddingLeft), r: n(s.paddingRight), t: n(s.paddingTop), b: n(s.paddingBottom) };
}
