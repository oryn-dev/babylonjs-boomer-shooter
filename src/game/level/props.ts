import type { V3 } from "./vec";

interface PropInfo {
  solid?: [V3, V3][];
  lights?: { at: V3; color: V3; power: number; range?: number; size?: number }[];
  beam?: { at: number; color: V3; power: number };
  /** Flare drawn at the lamp. */
  flare?: { at: V3; size: number; color: V3 };
}
export const FIRE: V3 = [1, 0.46, 0.13];
export const LAMP: V3 = [1, 0.6, 0.28];
export const GREEN: V3 = [0.32, 0.9, 0.62];
export const COLD: V3 = [0.55, 0.68, 0.85];

/** What a kit piece stops and how it shines. */
export const PROPS: Record<string, PropInfo> = {
  doorarch: { solid: [[[-2.5, 0, -0.5], [-2, 4.5, 0.5]], [[2, 0, -0.5], [2.5, 4.5, 0.5]]] },
  column: { solid: [[[-0.6, 0, -0.6], [0.6, 8, 0.6]], [[-0.9, 0, -0.9], [0.9, 0.5, 0.9]]] },
  pier: { solid: [[[-0.8, 0, -0.8], [0.8, 8, 0.8]], [[-0.95, 0, -0.95], [0.95, 0.6, 0.95]]] },
  buttress: { solid: [[[0, 0, -0.5], [1.1, 7, 0.5]]] },
  window: { beam: { at: 3, color: [1, 0.5, 0.18], power: 16 } },
  windowgreen: { beam: { at: 3, color: [0.35, 0.95, 0.68], power: 11 } },
  rose: { beam: { at: 0, color: [1, 0.52, 0.2], power: 46 } },
  bigpipe: { solid: [[[-0.75, 0, -0.75], [0.75, 10, 0.75]]] },
  organrank: { solid: [[[-2.6, 0, -0.1], [2.6, 5, 0.6]]] },
  organtower: { solid: [[[-1.6, 0, 0], [1.6, 12, 1.4]]] },
  pipe: { solid: [[[-0.28, 0, -0.28], [0.28, 4, 0.28]]] },
  ladle: { lights: [{ at: [0, 3.4, 0], color: FIRE, power: 16, range: 14, size: 1 }], flare: { at: [0, 2.6, 0], size: 4, color: [1, 0.4, 0.1] } },
  furnace: { solid: [[[-2.5, 0, 0], [-1.6, 5.2, 1]], [[1.6, 0, 0], [2.5, 5.2, 1]], [[-1.7, 0, 0], [1.7, 4, 0.3]]], lights: [{ at: [0, 1.4, 1.4], color: FIRE, power: 26, range: 18, size: 0.9 }], flare: { at: [0, 1.5, 0.9], size: 4.5, color: [1, 0.36, 0.08] } },
  boiler: { solid: [[[-1.3, 0, -1.3], [1.3, 4.8, 1.3]]], lights: [{ at: [0, 1.1, 2.1], color: FIRE, power: 5, range: 8 }] },
  vat: { solid: [[[-1.7, 0, -1.7], [1.7, 1.8, 1.7]]], lights: [{ at: [0, 2.6, 0], color: FIRE, power: 18, range: 13, size: 1 }], flare: { at: [0, 2, 0], size: 4, color: [1, 0.4, 0.1] } },
  press: { solid: [[[-1.5, 0, -1.2], [1.5, 1, 1.2]], [[-1.5, 1, -0.6], [-0.9, 6, 0.6]], [[0.9, 1, -0.6], [1.5, 6, 0.6]], [[-1.6, 5, -0.9], [1.6, 6.2, 0.9]], [[-0.95, 2.5, -0.7], [0.95, 5, 0.7]]] },
  anvil: { solid: [[[-0.6, 0, -0.35], [0.7, 1.15, 0.35]]] },
  ingots: { solid: [[[-0.65, 0, -0.55], [0.65, 0.62, 0.55]]] },
  crate: { solid: [[[-0.52, 0, -0.52], [0.52, 1.02, 0.52]]] },
  barrel: { solid: [[[-0.4, 0, -0.4], [0.4, 1.2, 0.4]]] },
  coalheap: { solid: [[[-0.8, 0, -0.8], [0.8, 0.5, 0.8]]] },
  pew: { solid: [[[-0.42, 0, -1.4], [0.3, 0.5, 1.4]]] },
  saint: { solid: [[[-0.8, 0, -0.65], [0.8, 4, 0.65]]] },
  lamp: { lights: [{ at: [0, 0, 1], color: LAMP, power: 5.5, range: 12 }], flare: { at: [0, -0.1, 0.5], size: 1.5, color: [1, 0.5, 0.18] } },
  chandelier: { lights: [{ at: [0, 0.9, 0], color: LAMP, power: 20, range: 18, size: 1.3 }], flare: { at: [0, 0.5, 0], size: 3.4, color: [1, 0.5, 0.18] } },
  brazier: { solid: [[[-0.4, 0, -0.4], [0.4, 1.4, 0.4]]], lights: [{ at: [0, 2.1, 0], color: FIRE, power: 9, range: 13 }], flare: { at: [0, 1.7, 0], size: 2.4, color: [1, 0.42, 0.1] } },
  candles: { lights: [{ at: [0, 0.9, 0], color: LAMP, power: 2.6, range: 8 }], flare: { at: [0, 0.5, 0], size: 1.1, color: [1, 0.55, 0.2] } },
  railing: { solid: [[[-1, 0, -0.08], [1, 1.05, 0.08]]] },
  bell: { solid: [[[-1, 0, -1], [1, 1.8, 1]]] },
  pulpit: { solid: [[[-0.9, 0, -0.9], [0.9, 2.8, 0.9]]] },
  altar: { solid: [[[-1.6, 0, -0.75], [1.6, 1.14, 0.75]]] },
  rubble: {},
  mould: { solid: [[[-0.7, 0, -1.1], [0.7, 0.6, 1.1]]], lights: [{ at: [0, 1.5, 0], color: FIRE, power: 2.5, range: 6 }] },
  console: { solid: [[[-0.6, 0, -0.3], [0.6, 1, 0.3]]] },
  hopper: { solid: [[[-1.2, 0.4, -1.2], [1.2, 2.8, 1.2]]] },
  fallpipe: { lights: [{ at: [0.9, 1.5, 0], color: FIRE, power: 8, range: 14, size: 0.6 }, { at: [-0.9, 4, 0], color: FIRE, power: 8, range: 14, size: 0.6 }], flare: { at: [0, 0.4, 0], size: 4, color: [1, 0.45, 0.12] } },
  gear: {},
};
