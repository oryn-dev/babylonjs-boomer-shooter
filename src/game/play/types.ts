import type { V3 } from "../level/vec";

export type DamageKind = "rivet" | "nail" | "shot" | "blade" | "arc" | "slag" | "bell" | "hammer" | "blast" | "burn" | "crush";
export interface Hit {
  amount: number;
  kind: DamageKind;
  dir: V3;
  point: V3;
  /** Push in metres per second. */
  knock: number;
  lift?: number;
  stun?: number;
  white?: boolean;
  part?: string;
}
export type Ammo = "shells" | "blades" | "cells" | "slag" | "peals";
export type WeaponId = "rivet" | "bellows" | "chainsaw" | "arclance" | "mortar" | "bellgun";
export const WEAPONS: WeaponId[] = ["rivet", "bellows", "chainsaw", "arclance", "mortar", "bellgun"];
export const WEAPON_NAME: Record<WeaponId | "hammer", string> = { rivet: "Rivet Pistol", bellows: "Bellows Shotgun", chainsaw: "Blade Launcher", arclance: "Arc Lance", mortar: "Slag Mortar", bellgun: "The Bell", hammer: "Hammer" };
export const AMMO_OF: Record<WeaponId, Ammo | null> = { rivet: null, bellows: "shells", chainsaw: "blades", arclance: "cells", mortar: "slag", bellgun: "peals" };
export const AMMO_MAX: Record<Ammo, number> = { shells: 40, blades: 24, cells: 200, slag: 16, peals: 3 };
