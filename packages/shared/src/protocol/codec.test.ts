import { describe, expect, it } from "vitest";
import { TEAM_CT } from "../constants.js";
import { createPlayer } from "../sim/step.js";
import { AK47, USP } from "../weapons.js";
import { packPlayer, unpackPlayer } from "./codec.js";

describe("el códec", () => {
  it("empaqueta y desempaqueta un jugador sin perder lo que importa", () => {
    const p = createPlayer(7, TEAM_CT);
    p.alive = true;
    p.x = 12.345;
    p.y = 0.4;
    p.z = -3.21;
    p.yaw = 1.2345;
    p.pitch = -0.5;
    p.hp = 73;
    p.armor = 55;
    p.helmet = true;
    p.slots = [AK47, USP, 0];
    p.active = 0;
    p.ammo = [17, 12, 0];
    p.reserve = [60, 24, 0];
    p.money = 4200;
    p.fireCd = 1;
    p.reloadCd = 0;
    p.recoil = 3;
    p.crouch = 2;
    p.vy = -1.5;
    p.lastSeq = 999;
    p.shootHeld = true;

    const own = unpackPlayer(packPlayer(p, true));
    expect(own.id).toBe(7);
    expect(own.team).toBe(TEAM_CT);
    expect(own.x).toBeCloseTo(12.35, 2);
    expect(own.z).toBeCloseTo(-3.21, 2);
    // Los ángulos viajan en milirradianes.
    expect(own.yaw).toBeCloseTo(1.2345, 2);
    expect(own.hp).toBe(73);
    expect(own.armor).toBe(55);
    expect(own.helmet).toBe(true);
    expect(own.weapon).toBe(AK47);
    expect(own.slots).toEqual([AK47, USP, 0]);
    expect(own.active).toBe(0);
    expect(own.lastSeq).toBe(999);
    expect(own.crouch).toBe(2);
    expect(own.shootHeld).toBe(true);
    expect(own.own?.ammo).toEqual([17, 12, 0]);
    expect(own.own?.reserve).toEqual([60, 24, 0]);
    expect(own.own?.money).toBe(4200);
    expect(own.own?.recoil).toBe(3);
    expect(own.own?.vy).toBeCloseTo(-1.5, 2);

    const other = unpackPlayer(packPlayer(p, false));
    expect(other.own).toBeNull();
    expect(other.weapon).toBe(AK47);
  });

  it("la ranura activa se recupera aunque las dos armas tengan el mismo id", () => {
    const p = createPlayer(1);
    p.slots = [-1, USP, 0];
    p.active = 2;
    const u = unpackPlayer(packPlayer(p, false));
    expect(u.active).toBe(2);
    expect(u.weapon).toBe(0);
  });
});
