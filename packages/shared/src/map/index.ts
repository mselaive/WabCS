import { BODEGA } from "./bodega.js";
import { PATIO } from "./patio.js";
import type { GameMap } from "./types.js";

export * from "./types.js";
export * from "./raycast.js";

/** Los mapas, por índice (el host elige en la sala). */
export const MAPS: readonly GameMap[] = [BODEGA, PATIO];

export function mapByIndex(i: number): GameMap {
  return MAPS[i] ?? MAPS[0]!;
}
