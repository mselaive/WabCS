import { describe, expect, it } from "vitest";
import { TEAM_T } from "../constants.js";
import { AK47, AWP, KNIFE, USP, weapon } from "../weapons.js";
import { recoilOffset, resetTrail, shotDirections } from "./combat.js";
import { createPlayer } from "./step.js";

function withWeapon(wid: number) {
  const p = createPlayer(1, TEAM_T);
  p.alive = true;
  const w = weapon(wid);
  p.slots[w.slot] = wid;
  p.active = w.slot;
  resetTrail(p);
  return p;
}

describe("el patrón de retroceso", () => {
  it("el primer tiro va derecho y los siguientes suben", () => {
    const ak = weapon(AK47);
    expect(recoilOffset(ak, 0)).toEqual({ x: 0, y: 0 });
    const r3 = recoilOffset(ak, 3);
    const r8 = recoilOffset(ak, 8);
    expect(r3.y).toBeGreaterThan(0);
    expect(r8.y).toBeGreaterThan(r3.y);
    // Se aplana: del 8 al 20 sube mucho menos que del 0 al 8.
    expect(recoilOffset(ak, 20).y - r8.y).toBeLessThan(r8.y - recoilOffset(ak, 0).y);
  });

  it("zigzaguea a los costados a partir del tercero", () => {
    const ak = weapon(AK47);
    expect(recoilOffset(ak, 1).x).toBe(0);
    const xs = [4, 6, 8, 10, 12].map((n) => recoilOffset(ak, n).x);
    expect(xs.some((x) => x > 0.01)).toBe(true);
    expect(xs.some((x) => x < -0.01)).toBe(true);
  });

  it("la bala número diez sale más arriba que la primera, aunque la mira no se mueva", () => {
    const p = withWeapon(AK47);
    p.recoil = 1;
    const first = shotDirections(p, AK47, 1)[0]!;
    p.recoil = 10;
    const tenth = shotDirections(p, AK47, 1)[0]!;
    expect(tenth.y).toBeGreaterThan(first.y + 0.05);
  });

  it("con la mira puesta el AWP no tiene patrón, y el cuchillo tampoco", () => {
    const p = withWeapon(AWP);
    p.scoped = true;
    // Con 1,5 s entre tiros el retroceso siempre volvió a cero.
    p.recoil = 1;
    const d = shotDirections(p, AWP, 1)[0]!;
    expect(Math.abs(d.y)).toBeLessThan(0.01);
    expect(recoilOffset(weapon(KNIFE), 10)).toEqual({ x: 0, y: 0 });
    expect(recoilOffset(weapon(USP), 5).y).toBeGreaterThan(0);
  });
});
