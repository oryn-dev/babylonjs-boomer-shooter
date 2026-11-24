import { censer, choir, deacon } from "./air";
import { cantor, mainspring } from "./bosses";
import type { Kind } from "./foe";
import { crucible, ringer, stoker, usher } from "./ground";

export const KINDS: Record<string, Kind> = { stoker, censer, usher, deacon, crucible, choir, ringer, mainspring, cantor };
