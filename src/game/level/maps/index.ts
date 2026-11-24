import type { LevelBuilder } from "../build";
import { pit } from "./pit";

export const LEVELS: Record<string, (L: LevelBuilder) => void> = { pit };
