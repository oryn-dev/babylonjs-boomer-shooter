import type { LevelBuilder } from "../build";
import { STYLE as S } from "./styles";

/** A casting hall round a molten pit, a pattern store to the east, a bell foundry to the west, the gate to the north. */
export function pit(L: LevelBuilder) {
  L.name = "The Casting Pit";
  L.fog = { color: [0.075, 0.038, 0.026], density: 0.012, floor: -2, height: 5 };
  L.par = 300;
  L.start = { pos: [0, 6.4, -37.5], yaw: 0, velocity: [0, 0, 11] };
  L.room(-24, 0, -24, 24, 14, 24, S.hall);
  L.room(-9, -4, -9, 9, 0, 9, S.channel);
  L.liquid(-9, -9, 9, 9, -2.4, "molten");
  L.vault(-24, -24, 24, 24, 10, 14, "z", "vault", 5);
  // Galleries
  for (const s of [-1, 1]) {
    L.box(s * 24, 4, -24, s * 17, 4.5, 24, "tread", "iron");
    for (const z of [-18, -6, 6, 18]) L.prop("column", s * 17.2, 0, z, 0, [0.8, 0.5, 0.8]);
    for (let z = -23; z < 24; z += 2) if (Math.abs(z) > 3 && Math.abs(Math.abs(z) - 13) > 1.5) L.prop("railing", s * 17.1, 4.5, z, 90);
  }
  L.stairs(-17, 14, -8, 18, 0, 4.5, "x-", "flag", "ashlar");
  L.stairs(8, -18, 17, -14, 0, 4.5, "x+", "flag", "ashlar");
  // Bridge over the pit
  L.box(-17, 4, -1.5, 17, 4.5, 1.5, "grate", "iron");
  for (let x = -16; x < 17; x += 2) { L.prop("railing", x, 4.5, -1.45, 0); if (Math.abs(x) > 3) L.prop("railing", x, 4.5, 1.45, 0); }
  L.prop("truss", -8, 2.5, 0); L.prop("truss", 8, 2.5, 0); L.prop("truss", 0, 2.5, 0);
  // Islands in the pit
  L.box(-3, -4, -3, 3, 0, 3, "tread", "iron");
  L.box(-9, -1, -1.5, -3, 0, 1.5, "grate", "iron"); L.box(3, -1, -1.5, 9, 0, 1.5, "grate", "iron");
  for (const [x, z] of [[-10.5, -10.5], [10.5, -10.5], [-10.5, 10.5], [10.5, 10.5]]) L.prop("pier", x, 0, z, 0, [1, 1.45, 1]);
  for (const z of [-18, -9, 0, 9, 18]) L.prop("rib", 0, 10.2, z, 0, [6.1, 0.66, 1]);
  for (const z of [-12, 0, 12]) { L.prop("window", -23.95, 6, z, 90); L.prop("window", 23.95, 6, z, -90); }
  L.prop("rose", 0, 8.5, 23.95, 180); for (const x of [-8.5, 8.5]) L.prop("furnace", x, 0, 23.6, 180);
  for (const x of [-14.6, 14.6]) { L.prop("organrank", x, 0, 23.4, 180); L.prop("organrank", x, 0, -23.4, 0); }
  L.prop("ladle", 0, 5.8, -7, 0, 0.9); L.prop("ladle", 0, 6.4, 7, 0, 0.9);
  for (const [x, z, y] of [[-23.9, -16, 90], [-23.9, 16, 90], [23.9, -16, -90], [23.9, 16, -90]]) L.prop("lamp", x, 2.6, z, y);
  for (const x of [-4.5, 4.5]) { L.prop("lamp", x, 3.2, 23.9, 180); L.prop("lamp", x, 3.2, -23.9, 0); }
  L.prop("boiler", -20, 4.5, -21, 0); L.prop("vat", 20, 4.5, 20, 0);
  L.prop("press", 14, 0, 20, 180); L.prop("crate", -14, 0, -20, 12); L.prop("crate", -15.3, 0, -20.3, -8); L.prop("ingots", -14, 1.02, -20, 40); L.prop("barrel", 14, 0, -21, 0); L.prop("barrel", 15, 0, -21.5, 0);
  for (const [x, z] of [[-13, -4.5], [13, 4.5], [-4.5, 14], [4.5, -14]]) L.prop("brazier", x, 0, z);
  L.beam([-23, 9, 0], [0.5, 3, 2], [0.75, -0.55, 0.2], [1, 0.55, 0.22], 1.4);

  // Chute in
  L.room(-2, 0, -39, 2, 9, -24, S.ironway);
  L.ramp(-2, -36, 2, -25, 6, 0, "z-", "tread", "iron");
  L.box(-2, 5.5, -39, 2, 6, -36, "tread", "iron");
  L.light(0, 8, -31, [1, 0.5, 0.2], 1.7, 14);
  L.prop("doorarch", 0, 0, -24, 0, [1, 0.8, 1]);

  // Pattern store: raised deck with the cobalt seal, stairs up to the east gallery.
  L.room(24, 0, -2, 28, 4, 2, S.iron);
  L.room(28, 0, -11, 48, 9, 11, S.copper);
  L.box(40, 0, -11, 48, 2.5, 11, "tread", "iron");
  L.stairs(36, -3, 40, 3, 0, 2.5, "x+", "tread", "iron");
  L.box(28, 4, -11, 31, 4.5, 11, "grate", "iron");
  L.stairs(31, 8, 40, 11, 2.5, 4.5, "x-", "tread", "iron", 1.9);
  L.room(24, 4, 6, 28, 9, 10, S.iron);
  L.box(24, 4, 6, 28, 4.5, 10, "grate", "iron");
  for (const z of [-8, 8]) L.prop("column", 34, 0, z, 0, [1, 1.1, 1]);
  for (let z = -10; z < 7; z += 2) L.prop("railing", 30.9, 4.5, z, 90);
  L.prop("gearhuge", 47.8, 5.8, 0, -90, 1, { spin: 0.35 });
  L.prop("press", 44, 2.5, -8.5, 180); L.prop("vat", 44, 2.5, 8, 0); L.prop("chandelier", 34, 5.4, 0);
  for (const z of [-6, 6]) L.prop("lamp", 47.9, 5, z, -90);
  for (const x of [32, 44]) { L.prop("windowgreen", x, 4, -10.95, 0, 0.8); L.prop("lamp", x, 3, 10.9, 180); }
  L.prop("crate", 32, 0, -9.6, 10); L.prop("crate", 33.2, 0, -9.8, -20); L.prop("barrel", 30, 0, -9.8); L.prop("ingots", 38, 0, 9.4, 30);
  L.door("east", [25.5, 0, -2], [26, 3.9, 2], { open: "openEast", auto: false });
  L.doors[L.doors.length - 1].auto = false;

  // Bell foundry: round casting floor, lever at the far end.
  L.room(-28, 0, -2, -24, 4, 2, S.iron);
  L.room(-50, 0, -12, -28, 11, 12, S.nave);
  L.disc(-39, 0, 5, 0, 1, "checker", "ashlar", 12);
  L.ramp(-35.2, -1.4, -32.6, 1.4, 1, 0, "x+", "flag", "ashlar");
  L.ramp(-45.4, -1.4, -42.8, 1.4, 0, 1, "x+", "flag", "ashlar");
  L.prop("bell", -39, 1, 0, 20, 1.3); L.prop("ladle", -39, 6.4, 0, 0, 0.8);
  for (const [x, z] of [[-33, -7], [-45, -7], [-33, 7], [-45, 7]]) L.prop("column", x, 0, z, 0, [1, 1.35, 1]);
  L.prop("rose", -49.95, 7, 0, 90, 0.8);
  for (const z of [-7, 7]) { L.prop("lamp", -49.9, 3, z, 90); L.prop("window", -39, 4.5, z < 0 ? -11.95 : 11.95, z < 0 ? 0 : 180); }
  for (const x of [-44, -34]) { L.prop("lamp", x, 3, -11.9, 0); L.prop("lamp", x, 3, 11.9, 180); }
  for (const z of [-9, 9]) L.prop("organtower", -49.9, 0, z, 90, 0.8);
  L.door("west", [-26, 0, -2], [-25.5, 3.9, 2], { key: "cobalt" });
  L.lever(-48.4, 0, 0, 90, "boss", "The north gate answers");

  // North gate and the way out
  L.room(-3, 0, 24, 3, 5, 36, S.hall);
  L.prop("doorarch", 0, 0, 24, 0, [1, 0.8, 1]);
  L.door("north", [-3, 0, 26], [3, 5, 26.6], { open: "gate", auto: false });
  L.doors[L.doors.length - 1].auto = false;
  for (const x of [-2.9, 2.9]) L.prop("lamp", x, 2.6, 31, x < 0 ? 90 : -90);
  L.prop("windowgreen", 0, 0.5, 35.95, 180, 0.8);
  L.exit = { lo: [-2, 0, 31], hi: [2, 4, 35] };

  // Secret: a cracked wall behind the south-west crates, and a ledge over the pattern store.
  L.room(-22, 0, -30, -16, 4, -25, S.crypt);
  L.room(-20, 0, -25, -18, 3, -24, S.crypt);
  L.door("crack", [-20, 0, -24.6], [-18, 3, -24.1], { open: "hit", auto: false, tex: "brick" });
  L.doors[L.doors.length - 1].auto = false;
  L.prop("candles", -21, 0, -29); L.prop("saint", -19, 0, -29.2, 0);
  L.secret([-22, 0, -30], [-16, 3, -25.5], "The founder's tomb");
  L.item("bellgun", -17.5, 0, -28, true); L.item("heart", -20.5, 0, -27, true);
  L.secret([24, 4, -10], [31.5, 7, 5.5], "Over the pattern store");
  L.item("whiteheat", 29.5, 4.5, -9.5, true);

  // What lies about
  L.item("bellows", 0, 0, -11.5); L.item("shells", -3, 0, -18.5); L.item("shells", 3, 0, -18.5);
  L.item("chainsaw", 0, 4.5, 0); L.item("blades", -8, 4.5, 0.6); L.item("flask", 20, 4.5, 0); L.item("armour", -21, 4.5, 12); L.item("shells", -21, 4.5, 0); L.item("shells", 21, 4.5, -20);
  L.item("flask", -13, 0, 19); L.item("flask", 12, 0, 18); L.item("cells", 10, 0, 21.5); L.item("slag", -10, 0, 21); L.item("blades", 20, 0, 0); L.item("shells", -20, 0, 6);
  for (const x of [-1.5, 0, 1.5]) L.item("vial", x, 0, 0);
  L.item("arclance", 34, 0, 0); L.item("cells", 38, 0, -8); L.item("keycobalt", 45, 2.5, 0); L.item("flask", 41.5, 2.5, 4); L.item("shells", 29.5, 4.5, 4);
  L.item("mortar", -31, 0, 5); L.item("slag", -47, 0, 6); L.item("flask", -47, 0, -6); L.item("armour", -39, 0, -9); L.item("cells", -31, 0, -9); L.item("shells", -39, 0, 9.5);

  // Machines
  const a = { group: "A" };
  L.enemy("stoker", -3, 0, -13, 180, a); L.enemy("stoker", 4, 0, -11, 180, a); L.enemy("stoker", 12, 0, -3, 180, a); L.enemy("stoker", -12, 0, 2, 180, a); L.enemy("stoker", -20, 4.5, 4, 120, { ...a, min: 1 });
  L.enemy("censer", -6, 1, 4, 180, a); L.enemy("censer", 8, 1, 6, 180, a); L.enemy("usher", 0, 0, 15, 180, a); L.enemy("stoker", 6, 0, 14, 180, { ...a, min: 2 });
  L.cleared.A = ["openEast"]; L.lines.openEast = "The east door grinds open";
  L.enemy("usher", 38, 0, 6, -90); L.enemy("stoker", 33, 0, -6, -90); L.enemy("stoker", 35, 0, 7, -90); L.enemy("deacon", 43, 2.5, 3, -90); L.enemy("censer", 38, 2, -5, -90, { min: 1 }); L.enemy("crucible", 42, 2.5, -4, -90); L.enemy("crucible", 37, 0, 8.5, -90);
  L.trigger([43, 2, -3], [48, 6, 3], "key");
  L.lines.key = "The hall is awake";
  for (const [k, x, z, w, m] of [["stoker", -4, 16, 0, 0], ["stoker", 4, 16, 0.2, 0], ["stoker", -14, -8, 0.4, 0], ["censer", 0, 12, 0.6, 0], ["censer", -10, 14, 0.8, 1], ["ringer", -13, 14, 1, 0], ["crucible", 14, 12, 1.4, 0], ["crucible", 12, -14, 1.6, 2]] as const) L.enemy(k, x, 0, z, 180, { spawn: "key", wait: w, min: m });
  L.enemy("deacon", -40, 0, 8, 90); L.enemy("deacon", -44, 0, -8, 90, { min: 1 }); L.enemy("choir", -46, 0, 3, 90); L.enemy("stoker", -35, 0, -8, 90); L.enemy("stoker", -35, 0, 8.5, 90); L.enemy("usher", -44, 0, 5, 90); L.enemy("crucible", -38, 0, -9.5, 90);
  L.enemy("mainspring", 0, 0, 16, 180, { spawn: "boss", group: "boss", wait: 1 });
  for (const [k, x, z, p] of [["stoker", -14, 8, "phase1"], ["stoker", 14, 8, "phase1"], ["censer", -8, 16, "phase1"], ["crucible", 14, -12, "phase2"], ["crucible", -14, -12, "phase2"], ["stoker", 0, -14, "phase2"], ["censer", 8, 16, "phase2"]] as const) L.enemy(k, x, 0, z, 180, { spawn: p });
  L.cleared.boss = ["gate"]; L.lines.boss = "Something winds itself up in the hall"; L.lines.gate = "The north gate is open";
  L.checkpoint([26, 0, -3], [31, 4, 3], [29.5, 0, 0], 90);
  L.checkpoint([-31, 0, -3], [-27, 4, 3], [-29.5, 0, 0], -90);
  L.checkpoint([-49, 0, -3], [-46.5, 4, 3], [-47.3, 0, 0], 90);
}
