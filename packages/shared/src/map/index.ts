import { BODEGA } from "./bodega.js";
import type { GameMap } from "./types.js";

export * from "./types.js";
export * from "./raycast.js";

/** Los mapas, por índice. Por ahora uno. */
export const MAPS: readonly GameMap[] = [BODEGA];

export function mapByIndex(i: number): GameMap {
  return MAPS[i] ?? MAPS[0]!;
}
