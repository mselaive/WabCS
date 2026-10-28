import { describe, expect, it } from "vitest";
import { BODEGA } from "../map/bodega.js";
import {
  ACT_BUY_BASE,
  ACT_GRENADE_BASE,
  FREEZE_TICKS,
  GRENADE_FUSE_TICKS,
  SMOKE_FUSE_TICKS,
  SMOKE_TICKS,
  TEAM_CT,
  TEAM_T,
} from "../constants.js";
import { BUY_ITEMS, HE_GRENADE, SLOT_GRENADE, SLOT_SECONDARY, USP } from "../weapons.js";
import { advanceGrenade, smokeBlocks } from "./grenade.js";
import { startMatch } from "./rounds.js";
import { createGameState, createPlayer, step } from "./step.js";
import type { GrenadeState, PlayerInput, SimEvent } from "./types.js";

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, fwd: 0, side: 0, yaw: 0, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, walk: false, scope: false, act: 0, view: -1,
  ...over,
});

function match() {
  const state = createGameState();
  const t = createPlayer(1, TEAM_T);
  const ct = createPlayer(2, TEAM_CT);
  state.players.push(t, ct);
  const events: SimEvent[] = [];
  startMatch(state, 3, BODEGA, 8, events);
  // Pasar el tiempo de compra.
  for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map(), events, BODEGA);
  events.length = 0;
  return { state, t, ct, events };
}

describe("las granadas", () => {
  it("se compran hasta el tope y se sacan con 4, 5 y 6", () => {
    const { state, t, events } = match();
    state.round.phase = "freeze";
    t.money = 2000;
    const he = ACT_BUY_BASE + BUY_ITEMS.findIndex((b) => b.key === "he");
    step(state, new Map([[1, [input({ act: he })]]]), events, BODEGA);
    step(state, new Map([[1, [input({ act: he })]]]), events, BODEGA);
    expect(t.grenades).toEqual([1, 0, 0]);
    expect(t.money).toBe(1700);
    state.round.phase = "live";
    step(state, new Map([[1, [input({ act: ACT_GRENADE_BASE + 0 })]]]), events, BODEGA);
    expect(t.active).toBe(SLOT_GRENADE);
    expect(t.slots[SLOT_GRENADE]).toBe(HE_GRENADE);
    // Sin flash, 5 no hace nada.
    step(state, new Map([[1, [input({ act: ACT_GRENADE_BASE + 1 })]]]), events, BODEGA);
    expect(t.slots[SLOT_GRENADE]).toBe(HE_GRENADE);
  });

  it("al tirarla vuela, rebota, cae y estalla con la mecha", () => {
    const { state, t, events } = match();
    t.grenades = [1, 0, 0];
    step(state, new Map([[1, [input({ act: ACT_GRENADE_BASE + 0 })]]]), events, BODEGA);
    for (let i = 0; i < 10; i++) step(state, new Map([[1, [input()]]]), events, BODEGA);
    step(state, new Map([[1, [input({ shoot: true, seq: 50 })]]]), events, BODEGA);
    expect(state.grenades).toHaveLength(1);
    expect(t.grenades[0]).toBe(0);
    // Sin granadas, vuelve a la pistola.
    expect(t.active).toBe(SLOT_SECONDARY);
    expect(events.some((e) => e.t === "throw" && e.seq === 50)).toBe(true);
    const g = state.grenades[0]!;
    const z0 = g.z;
    for (let i = 0; i < GRENADE_FUSE_TICKS - 2; i++) step(state, new Map(), events, BODEGA);
    expect(state.grenades).toHaveLength(1);
    expect(g.z).toBeLessThan(z0 - 3);
    expect(g.y).toBeGreaterThanOrEqual(0);
    step(state, new Map(), events, BODEGA);
    expect(state.grenades).toHaveLength(0);
    expect(events.some((e) => e.t === "explode" && e.kind === 0)).toBe(true);
  });

  it("rebota contra una pared y no la atraviesa", () => {
    const g: GrenadeState = { id: 1, kind: 0, ownerId: 1, team: 0, x: -3, y: 1.5, z: 6, vx: 0, vy: 0, vz: -15, ticksLeft: 100 };
    // La pared sur de la casita está en z 3,5..4: a 15 m/s la toca en el tercer tick.
    for (let i = 0; i < 6; i++) advanceGrenade(g, BODEGA.boxes);
    expect(g.z).toBeGreaterThan(4);
    expect(g.vz).toBeGreaterThan(0);
  });

  it("la HE lastima al que está cerca y a la vista, no al que está detrás de una pared", () => {
    const { state, t, ct, events } = match();
    ct.x = 0;
    ct.z = -1;
    // Dentro de la casita, lejos del T que está afuera detrás de la pared.
    t.x = -3;
    t.z = 6;
    state.grenades.push({ id: 9, kind: 0, ownerId: 1, team: TEAM_T, x: 0, y: 0.1, z: 0, vx: 0, vy: 0, vz: 0, ticksLeft: 1 });
    step(state, new Map(), events, BODEGA);
    expect(ct.hp).toBeLessThan(100);
    expect(ct.hp).toBeGreaterThan(0);
    expect(t.hp).toBe(100);
  });

  it("la flash ciega más al que la mira de frente", () => {
    const { state, t, ct, events } = match();
    // Los dos a 5 m de la flash, uno de frente y el otro de espaldas.
    ct.x = 0; ct.z = -5; ct.yaw = Math.PI; // mira a +z: hacia la flash
    t.x = 0; t.z = 5; t.yaw = Math.PI; // mira a +z: de espaldas
    state.grenades.push({ id: 9, kind: 1, ownerId: 2, team: TEAM_CT, x: 0, y: 1.5, z: 0, vx: 0, vy: 0, vz: 0, ticksLeft: 1 });
    step(state, new Map(), events, BODEGA);
    expect(ct.blindTicks).toBeGreaterThan(t.blindTicks);
    expect(t.blindTicks).toBeGreaterThan(0);
    expect(ct.blindTicks).toBeGreaterThan(40);
  });

  it("el humo estalla, dura, y tapa la vista entre dos puntos", () => {
    const { state, events } = match();
    state.grenades.push({ id: 9, kind: 2, ownerId: 1, team: TEAM_T, x: 0, y: 0.1, z: 0, vx: 0, vy: 0, vz: 0, ticksLeft: 1 });
    step(state, new Map(), events, BODEGA);
    expect(state.smokes).toHaveLength(1);
    expect(state.smokes[0]!.ticksLeft).toBe(SMOKE_TICKS);
    expect(smokeBlocks(state.smokes, -5, 1, 0, 5, 1, 0)).toBe(true);
    expect(smokeBlocks(state.smokes, -5, 1, 6, 5, 1, 6)).toBe(false);
    for (let i = 0; i < SMOKE_TICKS - 1; i++) step(state, new Map(), events, BODEGA);
    expect(state.smokes).toHaveLength(1);
    step(state, new Map(), events, BODEGA);
    expect(state.smokes).toHaveLength(0);
    void SMOKE_FUSE_TICKS;
    void USP;
  });
});
