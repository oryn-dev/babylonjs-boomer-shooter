import { tuning } from "../oryn/tuning";

/** A gameplay number by its knob, read live so the studio's sliders work while playing. */
export const num = (id: string, fallback: number) => tuning.number(id, fallback);

export type Difficulty = 0 | 1 | 2;
export const DIFFICULTY = [
  { name: "Apprentice", hurt: 0.5, hp: 0.85, pace: 0.85, drops: 1.4, note: "The heat is forgiving." },
  { name: "Smith", hurt: 1, hp: 1, pace: 1, drops: 1, note: "As it was forged." },
  { name: "Martyr", hurt: 1.7, hp: 1.15, pace: 1.18, drops: 0.8, note: "More machines, faster, harder." },
] as const;
