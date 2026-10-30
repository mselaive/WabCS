import { describe, expect, it } from "vitest";
import { SKIN_EMERALD, SKIN_NONE, SKIN_RUBY, SKIN_SAPPHIRE, knifeSkin } from "./cosmetics.js";

describe("la skin del cuchillo", () => {
  it("toca más o menos una de cada diez rondas, de las tres gemas, y siempre la misma para el mismo jugador y ronda", () => {
    let hits = 0;
    const seen = new Set<number>();
    for (let id = 1; id <= 50; id++) {
      for (let r = 1; r <= 200; r++) {
        const s = knifeSkin(id, r);
        if (s !== SKIN_NONE) {
          hits++;
          seen.add(s);
        }
      }
    }
    expect(hits / 10_000).toBeGreaterThan(0.08);
    expect(hits / 10_000).toBeLessThan(0.12);
    expect([...seen].sort()).toEqual([SKIN_RUBY, SKIN_SAPPHIRE, SKIN_EMERALD]);
    expect(knifeSkin(3, 7)).toBe(knifeSkin(3, 7));
  });
});
