/** The game's own lettering: 5 by 7 dots, narrow ones closed up, drawn in metal. */
const ROWS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01111 10000 10000 10000 10000 10000 01111", D: "11110 10001 10001 10001 10001 10001 11110", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000", G: "01111 10000 10000 10011 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "111 010 010 010 010 010 111", J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "1000 1000 1000 1000 1000 1000 1111", M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001", S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 11011 10001", X: "10001 10001 01010 00100 01010 10001 10001", Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110", "1": "010 110 010 010 010 010 111", "2": "01110 10001 00001 00110 01000 10000 11111", "3": "11110 00001 00001 01110 00001 00001 11110", "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110", "6": "01110 10000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000", "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00001 01110",
  ".": "0 0 0 0 0 0 1", ",": "00 00 00 00 00 01 10", ":": "0 0 1 0 0 1 0", "!": "1 1 1 1 1 0 1", "?": "01110 10001 00001 00110 00100 00000 00100", "'": "1 1 0 0 0 0 0", "-": "000 000 000 111 000 000 000", "+": "00000 00100 00100 11111 00100 00100 00000", "/": "00001 00001 00010 00100 01000 10000 10000", "%": "11001 11010 00010 00100 01000 01011 10011", "(": "01 10 10 10 10 10 01", ")": "10 01 01 01 01 01 10", "&": "01100 10010 10100 01000 10101 10010 01101", "=": "000 000 111 000 111 000 000", " ": "000 000 000 000 000 000 000", "#": "01010 11111 01010 01010 11111 01010 00000",
};
const GLYPH = new Map(Object.entries(ROWS).map(([c, r]) => [c, r.split(" ")]));
const glyph = (c: string) => GLYPH.get(c.toUpperCase()) ?? GLYPH.get("?")!;

export function textWidth(text: string, scale = 1) {
  let w = 0;
  for (const c of text) w += (glyph(c)[0].length + 1) * scale;
  return Math.max(0, w - scale);
}

export type Ink = string | { top: string; mid: string; low: string };
export const METAL = { bone: { top: "#fff3d2", mid: "#e0c795", low: "#a3825a" }, hot: { top: "#fff0b4", mid: "#ff9d35", low: "#d8480f" }, cyan: { top: "#d8fbff", mid: "#4fdcf0", low: "#1c8fae" }, iron: { top: "#8f8a86", mid: "#6b6562", low: "#453f3d" }, red: { top: "#ffb08a", mid: "#ee4a22", low: "#9c1d0c" } } as const;

export function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, o: { scale?: number; ink?: Ink; align?: "left" | "center" | "right"; shadow?: boolean; alpha?: number } = {}) {
  const s = o.scale ?? 1;
  const ink = o.ink ?? METAL.bone;
  const w = textWidth(text, s);
  let px = Math.round(o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x);
  const py = Math.round(y);
  const old = g.globalAlpha;
  g.globalAlpha = old * (o.alpha ?? 1);
  for (const c of text) {
    const rows = glyph(c);
    for (let j = 0; j < rows.length; j++)
      for (let i = 0; i < rows[j].length; i++) {
        if (rows[j][i] !== "1") continue;
        if (o.shadow !== false) {
          g.fillStyle = "rgba(8,5,4,.85)";
          g.fillRect(px + i * s + Math.max(1, s / 2), py + j * s + Math.max(1, s / 2), s, s);
        }
      }
    for (let j = 0; j < rows.length; j++)
      for (let i = 0; i < rows[j].length; i++) {
        if (rows[j][i] !== "1") continue;
        g.fillStyle = typeof ink === "string" ? ink : j < 2 ? ink.top : j < 5 ? ink.mid : ink.low;
        g.fillRect(px + i * s, py + j * s, s, s);
        if (s >= 3 && typeof ink !== "string") {
          g.fillStyle = "rgba(255,255,255,.28)";
          g.fillRect(px + i * s, py + j * s, s, 1);
        }
      }
    px += (rows[0].length + 1) * s;
  }
  g.globalAlpha = old;
  return w;
}

/** A dark iron plate with a bevel and rivets. */
export function plate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = (c: string, a: number, b: number, d: number, e: number) => ((g.fillStyle = c), g.fillRect(x + a, y + b, d, e));
  r("#0a0706", 1, 0, w - 2, h); r("#0a0706", 0, 1, w, h - 2);
  r("#3d3330", 2, 1, w - 4, h - 2); r("#3d3330", 1, 2, w - 2, h - 4);
  r("#2a2321", 2, 2, w - 4, h - 4);
  r("#5f524c", 3, 1, w - 6, 1);
  r("#191413", 3, h - 2, w - 6, 1);
  for (let i = 0; i < (w * h) / 26; i++) {
    const a = 3 + ((i * 37) % (w - 6)), b = 3 + ((i * 61 + i * i * 7) % (h - 6));
    r(i % 3 ? "#241e1c" : "#342b28", a, b, 1 + (i % 2), 1);
  }
  for (const [a, b] of [[3, 3], [w - 5, 3], [3, h - 5], [w - 5, h - 5]]) (r("#8a6a3c", a, b, 2, 2), r("#d8b070", a, b, 1, 1));
}

/** Text as a picture, for DOM menus. */
export function textImage(text: string, scale: number, ink: Ink = METAL.bone) {
  const c = document.createElement("canvas");
  c.width = textWidth(text, scale) + scale + 2;
  c.height = 7 * scale + scale + 2;
  drawText(c.getContext("2d")!, text, 0, 0, { scale, ink });
  return c;
}
