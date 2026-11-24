import type { Style } from "../build";

/** Wall, floor and ceiling sets. Trim bands: 0 riveted iron, 1 brass, 2 stone, 3 worn chevrons. */
export const STYLE = {
  intake: { wall: "brick", base: "ashlar", floor: "flag", ceil: "girder", plinth: 2, cornice: 0 },
  hall: { wall: "ashlar", base: "ashlar", top: "brick", floor: "flag", ceil: "vault", plinth: 2, cornice: 1 },
  iron: { wall: "iron", floor: "tread", ceil: "girder", plinth: 0, cornice: 0 },
  ironway: { wall: "iron", floor: "grate", ceil: "girder", plinth: 3, cornice: 0 },
  nave: { wall: "arcade", base: "ashlar", floor: "checker", ceil: "vault", plinth: 1, cornice: 1 },
  copper: { wall: "copper", base: "iron", floor: "tread", ceil: "girder", plinth: 0, cornice: 1 },
  fire: { wall: "firebrick", base: "brick", floor: "cobble", ceil: "brick", plinth: 0 },
  crypt: { wall: "rock", base: "ashlar", floor: "cobble", ceil: "vault", plinth: 2 },
  cave: { wall: "rock", floor: "slag", ceil: "rock" },
  organ: { wall: "pipes", base: "arcade", floor: "checker", ceil: "vault", plinth: 1, cornice: 1 },
  channel: { wall: "firebrick", floor: "firebrick", ceil: "brick" },
  plain: { wall: "plaster", base: "ashlar", floor: "flag", ceil: "vault", plinth: 2 },
  shaft: { wall: "brick", floor: "tread", ceil: "girder" },
  tracery: { wall: "tracery", base: "iron", floor: "grate", ceil: "girder", plinth: 0, cornice: 1 },
  tower: { wall: "ashlar", base: "ashlar", floor: "flag", ceil: "girder", plinth: 2, cornice: 0 },
} satisfies Record<string, Style>;
