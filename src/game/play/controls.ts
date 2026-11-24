import type { Input } from "../../oryn/input";
import { clamp } from "../level/vec";

export interface Intent {
  move: { x: number; y: number };
  /** Radians. */
  turn: number;
  pitch: number;
  fire: boolean;
  alt: boolean;
  jump: boolean;
  dash: boolean;
  hammer: boolean;
  use: boolean;
  select: number;
  cycle: number;
  pause: boolean;
  touch: boolean;
  pad: boolean;
}
export interface Look { sensitivity: number; invert: boolean }

const ICON: Record<string, string> = {
  fire: "M8 1 10 6 15 8 10 10 8 15 6 10 1 8 6 6Z", alt: "M3 8a5 5 0 1 1 10 0a5 5 0 1 1-10 0M6 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0", jump: "M8 2 14 9 10 9 10 14 6 14 6 9 2 9Z", dash: "M2 3 8 8 2 13ZM8 3 14 8 8 13Z", hammer: "M3 2H13V6H9V15H7V6H3Z", use: "M6 1H10V8H13L8 15 3 8H6Z", pause: "M4 2H7V14H4ZM9 2H12V14H9Z", swap: "M2 5H10V2L15 6.5 10 11V8H2Z",
};

/** Reads keyboard and mouse, gamepad and touch into one intent. */
export class Controls {
  private keys = new Set<string>();
  private down = new Set<string>();
  private buttons = new Set<number>();
  private wheel = 0;
  private padBefore: boolean[] = [];
  private held = new Set<string>();
  private tapped = new Set<string>();
  private drag = { x: 0, y: 0 };
  private free = { x: 0, y: 0 };
  private root = document.createElement("div");
  private wheelRoot = document.createElement("div");
  private chosen = -1;
  private turnRamp = 0;
  /** Weapons that can be picked on the touch wheel. */
  owned: () => { name: string; index: number; color: string; ammo: string }[] = () => [];
  active = false;

  constructor(private input: Input, canvas: HTMLCanvasElement, ui: HTMLElement) {
    input.touch.configure({ stick: true, buttons: [] });
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.down.add(e.code);
      if (this.active && ["Space", "Tab", "AltLeft"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    const clear = () => (this.keys.clear(), this.buttons.clear(), this.held.clear());
    window.addEventListener("blur", clear);
    document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement) clear(); });
    // The template's canvas swallows mouse events, so the buttons come from the pointer's mask.
    const buttons = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || (e.type === "pointerdown" && e.target !== canvas)) return;
      for (const [bit, n] of [[1, 0], [2, 2], [4, 1]]) {
        if (!(e.buttons & bit)) this.buttons.delete(n);
        else if (e.target === canvas && !this.buttons.has(n)) (this.buttons.add(n), this.down.add(`mouse${n}`));
      }
      if (e.button === 1) e.preventDefault();
    };
    for (const t of ["pointerdown", "pointermove", "pointerup"] as const) window.addEventListener(t, buttons, true);
    // Where the page may not hold the pointer, the bare mouse still turns the view.
    window.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && this.active && !document.pointerLockElement) ((this.free.x += e.movementX), (this.free.y += e.movementY)); });
    window.addEventListener("wheel", (e) => { if (this.active) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    this.root.className = "fc-touch";
    this.root.hidden = true;
    for (const id of ["fire", "alt", "jump", "dash", "hammer", "swap", "use", "pause"]) this.root.append(this.button(id));
    this.wheelRoot.className = "fc-wheel";
    this.wheelRoot.hidden = true;
    this.root.append(this.wheelRoot);
    ui.append(this.root);
  }

  private button(id: string) {
    const b = document.createElement("button");
    b.className = `fc-tb fc-tb-${id}`;
    b.setAttribute("aria-label", id);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="${ICON[id]}"/></svg>`;
    let last = { x: 0, y: 0 };
    let finger = -1;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      finger = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      try { b.setPointerCapture(e.pointerId); } catch { /* A made-up pointer cannot be captured. */ }
      if (id === "swap") return this.openWheel(e);
      this.held.add(id);
      this.tapped.add(id);
    });
    // Dragging on a button turns the view too, so one thumb can aim and fire.
    b.addEventListener("pointermove", (e) => {
      if (e.pointerId !== finger) return;
      if (id === "swap") return this.pointWheel(e);
      this.drag.x += (e.clientX - last.x) * 1.4;
      this.drag.y += (e.clientY - last.y) * 1.4;
      last = { x: e.clientX, y: e.clientY };
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== finger) return;
      finger = -1;
      this.held.delete(id);
      if (id === "swap") this.closeWheel();
    };
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
    return b;
  }

  private wheelAt = { x: 0, y: 0, moved: false };
  private wheelPick = -1;
  private openWheel(e: PointerEvent) {
    this.wheelAt = { x: e.clientX, y: e.clientY, moved: false };
    this.wheelPick = -1;
    const list = this.owned();
    this.wheelRoot.replaceChildren(...list.map((w, i) => {
      const n = document.createElement("div");
      const a = this.angleOf(i, list.length);
      n.className = "fc-wheel-item";
      n.style.left = `calc(50% + ${Math.cos(a) * 108}px)`;
      n.style.top = `calc(50% + ${Math.sin(a) * 108}px)`;
      n.innerHTML = `<b>${w.index + 1}</b><span>${w.name}</span><i>${w.ammo}</i>`;
      return n;
    }));
    this.wheelRoot.hidden = false;
  }
  private angleOf(i: number, n: number) {
    return -Math.PI / 2 + (i / n) * Math.PI * 2;
  }
  private pointWheel(e: PointerEvent) {
    const dx = e.clientX - this.wheelAt.x;
    const dy = e.clientY - this.wheelAt.y;
    if (Math.hypot(dx, dy) < 22) return;
    this.wheelAt.moved = true;
    const list = this.owned();
    const a = Math.atan2(dy, dx);
    let best = 0;
    let score = -2;
    list.forEach((_, i) => { const c = Math.cos(a - this.angleOf(i, list.length)); if (c > score) ((score = c), (best = i)); });
    this.wheelPick = best;
    [...this.wheelRoot.children].forEach((n, i) => n.classList.toggle("is-on", i === best));
  }
  private closeWheel() {
    this.wheelRoot.hidden = true;
    if (this.wheelAt.moved && this.wheelPick >= 0) this.chosen = this.owned()[this.wheelPick].index;
    else this.tapped.add("swap");
  }

  setActive(on: boolean) {
    this.active = on;
    this.input.touch.setEnabled(on);
    if (!on) (this.held.clear(), (this.wheelRoot.hidden = true));
  }
  /** Something to use is near. */
  showUse(on: boolean) {
    this.root.classList.toggle("has-use", on);
  }

  read(dt: number, look: Look, autoAlt = false): Intent {
    const { input } = this;
    const touch = input.device === "touch";
    this.root.hidden = !(touch && this.active);
    const pad = navigator.getGamepads?.().find((p) => p?.connected) ?? null;
    const padOn = input.device === "gamepad" && !!pad;
    const now = pad ? pad.buttons.map((b) => b.pressed || b.value > 0.4) : [];
    const hit = (i: number) => padOn && !!now[i] && !this.padBefore[i];
    const on = (i: number) => padOn && !!now[i];
    const l = input.look();
    const k = 0.0022 * look.sensitivity * (touch ? 1.5 : 1);
    let turn = 0;
    let pitch = 0;
    if (padOn && pad) {
      const [, , rx = 0, ry = 0] = pad.axes;
      const len = Math.hypot(rx, ry);
      if (len > 0.14) {
        const c = Math.pow((Math.min(1, len) - 0.14) / 0.86, 1.8) / len;
        this.turnRamp = clamp(this.turnRamp + (len > 0.9 ? dt * 3 : -dt * 6), 0, 1);
        turn = rx * c * (3.4 + this.turnRamp * 1.6) * dt * look.sensitivity;
        pitch = ry * c * 2.5 * dt * look.sensitivity;
      }
    } else if (!touch && !document.pointerLockElement) {
      turn = this.free.x * k;
      pitch = this.free.y * k;
    } else {
      turn = (l.x + this.drag.x) * k;
      pitch = (l.y + this.drag.y) * k;
    }
    this.drag = { x: 0, y: 0 };
    this.free = { x: 0, y: 0 };
    if (look.invert) pitch = -pitch;
    let select = this.chosen;
    this.chosen = -1;
    for (let i = 0; i < 6; i++) if (this.down.has(`Digit${i + 1}`)) select = i;
    const key = (...c: string[]) => c.some((x) => this.keys.has(x));
    const tap = (...c: string[]) => c.some((x) => this.down.has(x));
    const mouse = !touch && !padOn;
    const intent: Intent = {
      move: input.axis(), turn, pitch, touch, pad: padOn,
      fire: (mouse && this.buttons.has(0)) || key("KeyF", "Enter") || on(7) || this.held.has("fire"),
      alt: (mouse && this.buttons.has(2)) || key("KeyC") || on(6) || this.held.has("alt") || autoAlt,
      jump: key("Space") || on(0) || this.held.has("jump"),
      dash: tap("ShiftLeft", "ShiftRight") || hit(1) || this.tapped.has("dash"),
      hammer: tap("KeyQ", "KeyV", "mouse1") || hit(5) || hit(11) || this.tapped.has("hammer"),
      use: tap("KeyE") || hit(2) || this.tapped.has("use"),
      select,
      cycle: this.wheel + (hit(3) || this.tapped.has("swap") ? 1 : 0) + (hit(4) ? -1 : 0),
      pause: tap("KeyP") || hit(9) || this.tapped.has("pause") || (tap("Escape") && !document.pointerLockElement),
    };
    this.wheel = 0;
    this.down.clear();
    this.tapped.clear();
    this.padBefore = now;
    return intent;
  }
}
