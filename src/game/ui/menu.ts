import { type Ink, METAL, textImage } from "./pixels";

export interface Row { label: string; act?: () => void; value?: () => string; step?: (dir: number) => void; small?: boolean }
export interface Page { title: string; big?: boolean; lines?: string[]; rows: Row[]; back?: () => void; stats?: [string, string][] }

/** Screens over the running scene: pixel headings, plain rows; mouse, keys, pad and fingers all work. */
export class Menu {
  readonly root = document.createElement("div");
  private page: Page | null = null;
  private at = 0;
  private buttons: HTMLButtonElement[] = [];
  private padBefore: boolean[] = [];
  onMove: () => void = () => {};
  onPick: () => void = () => {};

  constructor(ui: HTMLElement) {
    this.root.className = "fc-menu";
    this.root.hidden = true;
    ui.append(this.root);
    window.addEventListener("keydown", (e) => {
      if (!this.page) return;
      const k = e.code;
      if (k === "ArrowDown" || k === "KeyS") this.go(1);
      else if (k === "ArrowUp" || k === "KeyW") this.go(-1);
      else if (k === "ArrowLeft" || k === "KeyA") this.turn(-1);
      else if (k === "ArrowRight" || k === "KeyD") this.turn(1);
      else if (k === "Enter" || k === "Space") (e.preventDefault(), this.pick());
      else if (k === "Escape" && this.page.back) this.page.back();
      else return;
      e.preventDefault();
    });
  }
  get open() {
    return this.page !== null;
  }
  show(page: Page) {
    const same = this.page?.title === page.title;
    this.page = page;
    this.at = same ? Math.min(this.at, page.rows.length - 1) : 0;
    this.root.hidden = false;
    this.root.className = `fc-menu${page.big ? " is-title" : ""}`;
    const phone = Math.min(window.innerHeight, window.innerWidth) < 480;
    const box = document.createElement("div");
    box.className = "fc-menu-box";
    const head = document.createElement("h1");
    head.setAttribute("aria-label", page.title);
    const scale = Math.max(2, Math.min(page.big ? (phone ? 5 : 11) : phone ? 3 : 5, Math.floor((window.innerWidth - 48) / (page.title.length * 6))));
    head.append(textImage(page.title, scale, page.big ? METAL.hot : (METAL.bone as Ink)));
    box.append(head);
    for (const l of page.lines ?? []) box.append(Object.assign(document.createElement("p"), { textContent: l }));
    if (page.stats) {
      const t = document.createElement("dl");
      for (const [a, b] of page.stats) t.append(Object.assign(document.createElement("dt"), { textContent: a }), Object.assign(document.createElement("dd"), { textContent: b }));
      box.append(t);
    }
    const list = document.createElement("div");
    list.className = "fc-rows";
    this.buttons = page.rows.map((row, i) => {
      const b = document.createElement("button");
      b.className = `fc-row${row.small ? " is-small" : ""}`;
      b.innerHTML = `<span>${row.label}</span>${row.value ? `<b>${row.value()}</b>` : ""}`;
      b.addEventListener("pointerenter", () => { if (this.at !== i) ((this.at = i), this.mark(), this.onMove()); });
      b.addEventListener("click", (e) => { e.stopPropagation(); this.at = i; const r = b.getBoundingClientRect(); if (row.step) this.turn(e.clientX < r.left + r.width / 2 ? -1 : 1); else this.pick(); });
      list.append(b);
      return b;
    });
    box.append(list);
    this.root.replaceChildren(box);
    this.mark();
  }
  hide() {
    this.page = null;
    this.at = 0;
    this.root.hidden = true;
  }
  private mark() {
    this.buttons.forEach((b, i) => b.classList.toggle("is-on", i === this.at));
  }
  private go(d: number) {
    if (!this.page) return;
    this.at = (this.at + d + this.page.rows.length) % this.page.rows.length;
    this.mark();
    this.onMove();
  }
  private turn(d: number) {
    const row = this.page?.rows[this.at];
    if (!row?.step) return;
    row.step(d);
    this.onMove();
    const b = this.buttons[this.at]?.querySelector("b");
    if (b && row.value) b.textContent = row.value();
  }
  private pick() {
    const row = this.page?.rows[this.at];
    if (!row) return;
    this.onPick();
    if (row.act) row.act();
    else this.turn(1);
  }
  /** Gamepad. */
  poll() {
    const pad = navigator.getGamepads?.().find((p) => p?.connected);
    if (!pad || !this.page) return;
    const now = pad.buttons.map((b) => b.pressed);
    const y = pad.axes[1] ?? 0, x = pad.axes[0] ?? 0;
    now[12] ||= y < -0.6; now[13] ||= y > 0.6; now[14] ||= x < -0.6; now[15] ||= x > 0.6;
    const hit = (i: number) => now[i] && !this.padBefore[i];
    const [up, down, left, right, ok, back] = [12, 13, 14, 15, 0, 1].map(hit);
    this.padBefore = now;
    if (up) this.go(-1);
    if (down) this.go(1);
    if (left) this.turn(-1);
    if (right) this.turn(1);
    if (ok) this.pick();
    else if (back) this.page?.back?.();
  }
}
