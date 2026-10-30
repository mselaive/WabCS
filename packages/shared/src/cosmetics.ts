/**
 * Lo cosmético: la skin del cuchillo. No va por la red: la sortea un hash del
 * jugador y del número de ronda, así cada cliente ve lo mismo para todos.
 */

export const SKIN_NONE = 0;
export const SKIN_RUBY = 1;
export const SKIN_SAPPHIRE = 2;
export const SKIN_EMERALD = 3;

/** Nombres para mostrar, por skin. */
export const SKIN_NAMES = ["", "Rubí", "Zafiro", "Esmeralda"] as const;

/** Probabilidad de que en una ronda toque una hoja de gema. */
export const SKIN_CHANCE = 0.1;

/**
 * Qué hoja le toca a `playerId` en la ronda `round`: casi siempre ninguna, una
 * de cada diez una gema (rubí, zafiro o esmeralda por igual). Determinista.
 */
export function knifeSkin(playerId: number, round: number): number {
  let h = (Math.imul(playerId + 1, 0x9e3779b1) ^ Math.imul(round + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  const u = (h >>> 0) / 4294967296;
  if (u >= SKIN_CHANCE) return SKIN_NONE;
  return 1 + (Math.floor((u / SKIN_CHANCE) * 3) % 3);
}
