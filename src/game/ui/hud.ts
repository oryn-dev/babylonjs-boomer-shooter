import type { KeyName } from "../level/build";
import type { HudPort, Run } from "../play/run";
import { WHITE } from "../play/arsenal";
import { AMMO_OF, WEAPON_NAME, WEAPONS } from "../play/types";
import { drawText, type Ink, METAL, plate, textWidth } from "./pixels";

const KEY_INK: Record<KeyName, string> = { cobalt: "#4f86ff", rose: "#ff4a6c", white: "#f2f4ff" };

/** Numbers, heat, keys, the mask and messages, drawn on a small canvas in the textures' own pixels. */
export class Hud implements HudPort {
  private canvas = document.createElement("canvas");
  private g: CanvasRenderingContext2D;
  private scale = 3;
  private cache = new Map<string, HTMLCanvasElement>();
  private note = { text: "", left: 0 };
  private card = { title: "", text: "", left: 0, total: 1 };
  private hit = 0;
  private killMark = 0;
  private pulses = { ammo: 0, empty: 0 };
  private gain: { n: number; left: number }[] = [];
  private shown = { health: 100, armour: 0, ammo: 0 };
  private bumpHealth = 0;
  private shake = 0;
  /** Extra line at the top right: wave, time. */
  corner: string[] = [];
  hint = "";

  constructor(ui: HTMLElement) {
    this.canvas.className = "fc-hud";
    ui.prepend(this.canvas);
    this.g = this.canvas.getContext("2d")!;
    window.addEventListener("resize", () => this.fit());
    this.fit();
  }
  private fit() {
    const w = window.innerWidth, h = window.innerHeight;
    this.scale = Math.max(2, Math.round(Math.min(h, w * 0.6) / 270));
    this.canvas.width = Math.ceil(w / this.scale);
    this.canvas.height = Math.ceil(h / this.scale);
  }
  set visible(v: boolean) {
    this.canvas.hidden = !v;
  }
  message(text: string, seconds: number) {
    this.note = { text, left: seconds };
  }
  banner(title: string, text: string) {
    this.card = { title, text, left: 4.2, total: 4.2 };
  }
  pulse(what: "ammo" | "empty") {
    this.pulses[what] = 1;
  }
  mark(kill: boolean) {
    this.hit = 1;
    if (kill) this.killMark = 1;
  }
  points(n: number) {
    this.gain.push({ n, left: 1.1 });
    if (this.gain.length > 4) this.gain.shift();
  }
  reset() {
    this.note.left = this.card.left = this.hit = this.killMark = 0;
    this.gain = [];
    this.hint = "";
  }
  private panel(w: number, h: number) {
    const k = `${w}x${h}`;
    let c = this.cache.get(k);
    if (!c) {
      c = document.createElement("canvas");
      c.width = w; c.height = h;
      plate(c.getContext("2d")!, 0, 0, w, h);
      this.cache.set(k, c);
    }
    return c;
  }

  draw(r: Run, dt: number, touch: boolean, safe: { l: number; r: number; t: number; b: number }) {
    const { g, canvas: { width: W, height: H } } = this;
    const p = r.player;
    const ars = p.arsenal;
    g.clearRect(0, 0, W, H);
    const s = this.scale;
    const L = 5 + Math.ceil(safe.l / s), R = W - 5 - Math.ceil(safe.r / s), T = 5 + Math.ceil(safe.t / s), B = H - 5 - Math.ceil(safe.b / s);
    this.hit = Math.max(0, this.hit - dt * 6);
    this.killMark = Math.max(0, this.killMark - dt * 3.2);
    this.shake = Math.max(0, p.hurtFlash);
    for (const k of ["ammo", "empty"] as const) this.pulses[k] = Math.max(0, this.pulses[k] - dt * 2.5);
    if (Math.round(p.health) > this.shown.health) this.bumpHealth = 1;
    this.shown.health = Math.round(p.health);
    this.bumpHealth = Math.max(0, this.bumpHealth - dt * 3);

    if (p.alive && !r.hideGun) this.crosshair(W / 2, H / 2, ars.heatShown, ars.whiteHeat, p.blessed > 0);
    // Health and the mask
    const top = touch;
    const ph = 34;
    const hx = L, hy = top ? T : B - ph;
    const jig = Math.round(Math.sin(r.time * 60) * this.shake * 2);
    g.drawImage(this.panel(124, ph), hx + jig, hy);
    this.mask(hx + jig + 19, hy + 17, r);
    const low = p.health <= 30;
    const ink: Ink = p.health > 100 ? METAL.cyan : low ? (Math.sin(r.time * 8) > 0 ? METAL.red : METAL.hot) : METAL.bone;
    drawText(g, String(Math.max(0, Math.ceil(p.health))), hx + jig + 88, hy + 6 - Math.round(this.bumpHealth * 2), { scale: 3, ink, align: "right" });
    drawText(g, String(Math.round(p.armour)), hx + jig + 118, hy + 8, { scale: 2, ink: p.armour > 0 ? { top: "#e4eaf0", mid: "#a9b4bf", low: "#65707c" } : METAL.iron, align: "right" });
    // Dash charges
    for (let i = 0; i < 2; i++) {
      g.fillStyle = "#0a0706"; g.fillRect(hx + jig + 92 + i * 14, hy + 26, 13, 4);
      g.fillStyle = i < p.charges ? "#4fdcf0" : "#3a302c"; g.fillRect(hx + jig + 93 + i * 14, hy + 27, 11, 2);
    }
    // Keys
    let kx = hx + 128;
    for (const k of ["cobalt", "rose", "white"] as KeyName[]) if (p.keys.has(k)) (this.key(kx, hy + (top ? 2 : 10), k), (kx += 20));

    // Weapon
    const w = ars.current;
    const ammo = AMMO_OF[w];
    const pw = 132;
    const ax = R - pw, ay = top ? T : B - ph;
    const pauseRoom = touch ? 22 : 0;
    const x0 = ax - pauseRoom;
    g.drawImage(this.panel(pw, ph), x0, ay);
    drawText(g, WEAPON_NAME[w], x0 + 8, ay + 6, { ink: METAL.bone, alpha: 0.85 });
    const n = ammo ? String(Math.floor(p.ammo[ammo])) : "";
    const ok = !ammo || p.ammo[ammo] > 0;
    if (ammo) drawText(g, n, x0 + pw - 8, ay + 6 + (this.pulses.empty > 0 ? Math.round(Math.sin(this.pulses.empty * 30)) : 0), { scale: 2, align: "right", ink: ok ? (this.pulses.ammo > 0.5 ? METAL.cyan : METAL.bone) : METAL.red });
    this.heatBar(x0 + 8, ay + 22, pw - 16, 7, ars.heatShown, ars.venting > 0 && ars.ventWeapon === w, p.blessed, r.time);
    // Slots
    if (!touch) {
      let sx = x0 + 2;
      for (const id of WEAPONS) {
        if (!p.owned.includes(id)) continue;
        const on = id === w;
        const has = p.ammoFor(id) >= 1;
        g.fillStyle = "#0a0706"; g.fillRect(sx, ay - 13, 13, 11);
        g.fillStyle = on ? "#d8892e" : "#2a2321"; g.fillRect(sx + 1, ay - 12, 11, 9);
        drawText(g, String(WEAPONS.indexOf(id) + 1), sx + 7, ay - 11, { align: "center", shadow: false, ink: on ? "#1a0d04" : has ? "#d9c39a" : "#5a4f48" });
        const h = ars.heat[id] / 100;
        if (h > 0.02) ((g.fillStyle = h > 0.75 ? "#fff" : "#ff8a2a"), g.fillRect(sx + 1, ay - 3, Math.ceil(11 * Math.min(1, h)), 1));
        sx += 15;
      }
    }
    // Combo and points
    const cx = R - 2, cy = Math.round(H * 0.42);
    if (r.combo > 1) {
      const k = Math.max(0, r.comboLeft / 4);
      drawText(g, `x${r.combo}`, cx, cy, { scale: 3, align: "right", ink: r.combo > 9 ? METAL.hot : METAL.bone });
      g.fillStyle = "rgba(10,7,6,.8)"; g.fillRect(cx - 40, cy + 24, 40, 3);
      g.fillStyle = "#ff8a2a"; g.fillRect(cx - Math.round(40 * k), cy + 24, Math.round(40 * k), 2);
    }
    this.gain = this.gain.filter((x) => (x.left -= dt) > 0);
    this.gain.forEach((x, i) => drawText(g, `+${x.n}`, cx, cy + 32 + i * 10, { align: "right", ink: METAL.hot, alpha: Math.min(1, x.left * 2) }));
    this.corner.forEach((line, i) => drawText(g, line, R - 2, (touch ? T + ph + 6 : T) + i * 12, { align: "right", ink: i ? METAL.bone : METAL.hot, scale: i ? 1 : 2 }));

    if (r.boss?.alive && r.boss.mood !== "idle") {
      const bw = Math.min(220, W - 40), bx = Math.round(W / 2 - bw / 2), by = touch ? T + ph + 2 : T + 2;
      const k = Math.max(0, r.boss.hp / (r.boss.kind.hp * r.rules.hp));
      drawText(g, r.boss.kind.name, W / 2, by, { align: "center", ink: METAL.bone });
      g.drawImage(this.panel(bw, 11), bx, by + 10);
      g.fillStyle = "#0a0706"; g.fillRect(bx + 6, by + 13, bw - 12, 5);
      g.fillStyle = "#b3240c"; g.fillRect(bx + 6, by + 13, Math.round((bw - 12) * k), 5);
      g.fillStyle = "#ff8a2a"; g.fillRect(bx + 6, by + 13, Math.round((bw - 12) * k), 2);
    }
    if (this.note.left > 0) {
      this.note.left -= dt;
      const lines = this.wrap(this.note.text, W - 60);
      lines.forEach((line, i) => drawText(g, line, W / 2, Math.round(H * (touch ? 0.3 : 0.66)) + i * 11, { align: "center", ink: METAL.bone, alpha: Math.min(1, this.note.left * 3) }));
    }
    if (this.card.left > 0) {
      this.card.left -= dt;
      const a = Math.min(1, this.card.left * 2.5, (this.card.total - this.card.left) * 5);
      const y = Math.round(H * (touch ? 0.27 : 0.2));
      const sc = textWidth(this.card.title, 3) < W - 40 ? 3 : 2;
      drawText(g, this.card.title, W / 2, y, { scale: sc, align: "center", ink: METAL.hot, alpha: a });
      this.wrap(this.card.text, W - 70).forEach((line, i) => drawText(g, line, W / 2, y + sc * 9 + 2 + i * 11, { align: "center", ink: METAL.bone, alpha: a }));
    }
    if (this.hint) drawText(g, this.hint, W / 2, Math.round(H * 0.57), { align: "center", ink: METAL.cyan });
  }
  private wrap(text: string, w: number) {
    const out: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next) > w && line) (out.push(line), (line = word));
      else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  private crosshair(x: number, y: number, heat: number, white: boolean, blessed: boolean) {
    const { g } = this;
    const cx = Math.round(x), cy = Math.round(y);
    const c = white || blessed ? "#ffffff" : heat > 0.45 ? "#ffb04a" : "#e8d7b0";
    const gap = 3 + Math.round(heat * 2);
    const bar = (a: number, b: number, w: number, h: number, col: string) => ((g.fillStyle = "rgba(0,0,0,.55)"), g.fillRect(cx + a - 1, cy + b - 1, w + 2, h + 2), (g.fillStyle = col), g.fillRect(cx + a, cy + b, w, h));
    bar(0, 0, 1, 1, c);
    bar(-gap - 2, 0, 2, 1, c); bar(gap + 1, 0, 2, 1, c); bar(0, gap + 1, 1, 2, c);
    if (this.hit > 0) {
      const col = this.killMark > 0.2 ? "#ff5a22" : "#fff";
      const d = 4 + Math.round((1 - this.hit) * 3) + (this.killMark > 0 ? 1 : 0);
      g.fillStyle = col;
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 0; i < (this.killMark > 0 ? 4 : 3); i++) g.fillRect(cx + a * (d + i), cy + b * (d + i), 1, 1);
    }
    // Heat around the sight: an arc that fills towards white.
    if (heat > 0.05) {
      const n = Math.round(heat * 20);
      for (let i = 0; i < 20; i++) {
        const a = Math.PI * (0.15 + (0.7 * i) / 19);
        g.fillStyle = i < n ? (i >= 15 ? "#fff" : i > 9 ? "#ffb04a" : "#e8642a") : "rgba(0,0,0,.35)";
        g.fillRect(Math.round(cx - Math.cos(a) * 15), Math.round(cy + Math.sin(a) * 15), 1, 2);
      }
    }
  }
  private heatBar(x: number, y: number, w: number, h: number, heat: number, vent: boolean, blessed: number, t: number) {
    const { g } = this;
    g.fillStyle = "#0a0706"; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = "#1c1513"; g.fillRect(x, y, w, h);
    const zone = Math.round((w * WHITE) / 100);
    g.fillStyle = "#4a4038"; g.fillRect(x + zone, y, w - zone, h);
    const k = blessed > 0 ? Math.min(1, blessed / 20) : Math.min(1, heat);
    const fill = Math.round(w * k);
    for (let i = 0; i < fill; i++) {
      const u = i / w;
      const on = vent ? (Math.floor(t * 14 + i / 4) % 2 ? "#ff5a22" : "#5a1508") : blessed > 0 ? "#9fefff" : u > 0.75 ? "#ffffff" : u > 0.5 ? "#ffc25a" : u > 0.25 ? "#f5822a" : "#b83a12";
      g.fillStyle = on;
      g.fillRect(x + i, y + 1, 1, h - 2);
      g.fillStyle = "rgba(255,255,255,.3)";
      g.fillRect(x + i, y + 1, 1, 1);
    }
    for (let i = 0; i < w; i += 7) ((g.fillStyle = "rgba(0,0,0,.35)"), g.fillRect(x + i, y, 1, h));
    if (vent) drawText(g, "Venting", x + w / 2, y, { align: "center", ink: "#fff" });
    else if (blessed <= 0 && heat * 100 >= WHITE) drawText(g, "White heat", x + w / 2, y, { align: "center", ink: "#1a0d04", shadow: false });
  }

  /** The mask: eyes burn with health, lamps around it show where a blow came from. */
  private mask(x: number, y: number, r: Run) {
    const { g } = this;
    const p = r.player;
    const dot = (a: number, b: number, w: number, h: number, c: string) => ((g.fillStyle = c), g.fillRect(x + a, y + b, w, h));
    const k = Math.min(1, p.health / 100);
    const blow = p.blows[p.blows.length - 1];
    let turn = 0;
    if (blow) turn = Math.round(Math.sin(blow.angle) * 2 * Math.min(1, blow.life * 2));
    const base = p.blessed > 0 ? "#f4fbff" : k > 0.6 ? "#d9c69c" : k > 0.3 ? "#b39a74" : "#8d7358";
    const dark = k > 0.3 ? "#8a7350" : "#5d4936";
    const lite = p.blessed > 0 ? "#ffffff" : "#f5e7c2";
    dot(-8, -11, 16, 14, dark); dot(-7, 3, 14, 5, dark); dot(-5, 8, 10, 3, dark); dot(-3, 11, 6, 1, dark);
    dot(-7, -11, 13, 13, base); dot(-6, 2, 11, 5, base); dot(-4, 7, 8, 3, base);
    dot(-6, -11, 11, 1, lite); dot(-7, -10, 1, 10, lite);
    dot(-8, -12, 16, 2, "#4a3f3a"); dot(-9, -11, 1, 6, "#4a3f3a"); dot(8, -11, 1, 6, "#4a3f3a");
    // Eyes
    const eye = p.hurtFlash > 0.25 ? "#ffffff" : k > 0.6 ? "#ffb04a" : k > 0.3 ? "#ff7a22" : Math.sin(r.time * 9) > 0 ? "#ff3a12" : "#7a1406";
    for (const s of [-1, 1]) (dot(s * 4 - 2 + turn, -5, 4, 3, "#1a0f0a"), dot(s * 4 - 1 + turn, -4, 2, 1, eye), dot(s * 4 - 1 + turn, -5, 3, 1, eye));
    dot(-1 + turn, -4, 2, 6, lite); dot(1 + turn, -3, 1, 5, dark);
    for (let i = 0; i < 4; i++) dot(-3 + i * 2, 5, 1, 3, "#2a1c14");
    if (k < 0.7) (dot(3, -9, 1, 3, "#3a2a20"), dot(4, -7, 1, 2, "#3a2a20"));
    if (k < 0.4) (dot(-5, 0, 1, 4, "#3a2a20"), dot(-4, 3, 1, 3, "#3a2a20"), dot(5, 1, 2, 1, "#ff6a1a"));
    if (!p.alive) dot(-6, -6, 13, 5, "#120a07");
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283;
      let lit = 0;
      for (const b of p.blows) lit = Math.max(lit, Math.cos(b.angle - a) > 0.7 ? Math.min(1, b.life * 1.4) : 0);
      const lx = Math.round(Math.sin(a) * 14), ly = Math.round(-Math.cos(a) * 13.5);
      dot(lx - 1, ly - 1, 3, 3, "#0a0706");
      dot(lx, ly, 1, 1, "#4a3a30");
      if (lit > 0) ((g.globalAlpha = lit), dot(lx - 1, ly - 1, 3, 3, "#ff4a1a"), dot(lx, ly, 1, 1, "#fff0c0"), (g.globalAlpha = 1));
    }
    // The strongest blow also shows around the sight.
    for (const b of p.blows) {
      const W = this.canvas.width / 2, H = this.canvas.height / 2;
      g.globalAlpha = Math.min(0.9, b.life);
      for (let i = -5; i <= 5; i++) {
        const a = b.angle + i * 0.06;
        const rad = 38 - Math.abs(i) * 0.4;
        g.fillStyle = "#ff4a1a";
        g.fillRect(Math.round(W + Math.sin(a) * rad), Math.round(H - Math.cos(a) * rad), 2, 2);
      }
      g.globalAlpha = 1;
    }
  }
  private key(x: number, y: number, k: KeyName) {
    const { g } = this;
    g.drawImage(this.panel(18, 20), x, y);
    const c = KEY_INK[k];
    g.fillStyle = c;
    const d = (a: number, b: number, w: number, h: number) => g.fillRect(x + a, y + b, w, h);
    d(6, 4, 6, 1); d(5, 5, 2, 4); d(11, 5, 2, 4); d(6, 9, 6, 1); d(8, 10, 2, 6); d(10, 12, 2, 1); d(10, 14, 3, 1);
    if (k === "cobalt") d(8, 6, 2, 2);
    if (k === "rose") (d(8, 5, 1, 3), d(9, 6, 1, 2));
  }
}
