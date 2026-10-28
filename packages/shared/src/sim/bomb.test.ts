import { describe, expect, it } from "vitest";
import { BODEGA } from "../map/bodega.js";
import {
  ACT_BUY_BASE,
  BOMB_DEFUSE_KIT_TICKS,
  BOMB_DEFUSE_TICKS,
  BOMB_PLANT_TICKS,
  BOMB_TIMER_TICKS,
  FREEZE_TICKS,
  MODE_BOMB,
  ROUND_OVER_TICKS,
  TEAM_CT,
  TEAM_T,
} from "../constants.js";
import { BUY_ITEMS } from "../weapons.js";
import { startMatch } from "./rounds.js";
import { createGameState, createPlayer, step } from "./step.js";
import type { PlayerInput, SimEvent } from "./types.js";

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, fwd: 0, side: 0, yaw: 0, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, walk: false, scope: false, use: false, act: 0, view: -1,
  ...over,
});

function match() {
  const state = createGameState();
  const t = createPlayer(1, TEAM_T);
  const ct = createPlayer(2, TEAM_CT);
  state.players.push(t, ct);
  const events: SimEvent[] = [];
  startMatch(state, 5, BODEGA, 8, events, MODE_BOMB);
  for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map(), events, BODEGA);
  events.length = 0;
  return { state, t, ct, events };
}

const siteA = BODEGA.sites[0]!;
const inA = { x: (siteA.minX + siteA.maxX) / 2, z: (siteA.minZ + siteA.maxZ) / 2 };

describe("la bomba", () => {
  it("la lleva un T desde el arranque; en eliminación nadie", () => {
    const { state, t } = match();
    expect(state.bomb.carrier).toBe(1);
    expect(t.hasBomb).toBe(true);
    const elim = createGameState();
    elim.players.push(createPlayer(1, TEAM_T), createPlayer(2, TEAM_CT));
    startMatch(elim, 5, BODEGA, 8, []);
    expect(elim.bomb.carrier).toBe(-1);
  });

  it("se planta sosteniendo E dentro del sitio, no afuera, y no caminando", () => {
    const { state, t, events } = match();
    // Afuera del sitio no pasa nada.
    for (let i = 0; i < BOMB_PLANT_TICKS + 5; i++) step(state, new Map([[1, [input({ use: true })]]]), events, BODEGA);
    expect(state.bomb.planted).toBeNull();
    t.x = inA.x;
    t.z = inA.z;
    for (let i = 0; i < BOMB_PLANT_TICKS - 1; i++) step(state, new Map([[1, [input({ use: true, fwd: 1 })]]]), events, BODEGA);
    expect(state.bomb.planting).not.toBeNull();
    // Mientras planta no se mueve aunque apriete adelante.
    expect(t.x).toBeCloseTo(inA.x, 2);
    // Soltar E cancela y arranca de cero.
    step(state, new Map([[1, [input()]]]), events, BODEGA);
    expect(state.bomb.planting).toBeNull();
    for (let i = 0; i < BOMB_PLANT_TICKS; i++) step(state, new Map([[1, [input({ use: true })]]]), events, BODEGA);
    expect(state.bomb.planted).not.toBeNull();
    expect(state.bomb.planted!.site).toBe("A");
    expect(t.hasBomb).toBe(false);
    expect(events.some((e) => e.t === "bomb" && e.what === "planted")).toBe(true);
  });

  it("plantada, el reloj de la ronda se congela y estalla a los 40 s: ganan los T", () => {
    const { state, t, ct, events } = match();
    t.x = inA.x;
    t.z = inA.z;
    for (let i = 0; i < BOMB_PLANT_TICKS; i++) step(state, new Map([[1, [input({ use: true })]]]), events, BODEGA);
    const left = state.round.ticksLeft;
    // Matar al T: con la bomba plantada los CT no ganan por eliminación.
    t.alive = false;
    ct.x = 0;
    ct.z = 12;
    for (let i = 0; i < BOMB_TIMER_TICKS - 1; i++) step(state, new Map(), events, BODEGA);
    expect(state.round.phase).toBe("live");
    expect(state.round.ticksLeft).toBe(left);
    step(state, new Map(), events, BODEGA);
    expect(events.some((e) => e.t === "bomb" && e.what === "exploded")).toBe(true);
    expect(state.round.phase).toBe("over");
    expect(state.round.winner).toBe(TEAM_T);
    expect(state.round.reason).toBe("bomb");
    // El CT estaba lejos: vivo.
    expect(ct.alive).toBe(true);
  });

  it("la explosión mata al que está cerca, a través de la pared", () => {
    const { state, t, ct, events } = match();
    t.x = inA.x;
    t.z = inA.z;
    for (let i = 0; i < BOMB_PLANT_TICKS; i++) step(state, new Map([[1, [input({ use: true })]]]), events, BODEGA);
    // El CT justo afuera de la pared del garaje, a 3 m.
    ct.x = inA.x;
    ct.z = -8.5;
    t.x = 0;
    t.z = 12;
    for (let i = 0; i < BOMB_TIMER_TICKS; i++) step(state, new Map(), events, BODEGA);
    expect(ct.alive).toBe(false);
    expect(events.some((e) => e.t === "kill" && e.targetId === 2)).toBe(true);
  });

  it("un CT la desactiva sosteniendo E al lado, en 10 s (5 con kit): ganan los CT", () => {
    const { state, t, ct, events } = match();
    t.x = inA.x;
    t.z = inA.z;
    for (let i = 0; i < BOMB_PLANT_TICKS; i++) step(state, new Map([[1, [input({ use: true })]]]), events, BODEGA);
    t.x = 0;
    t.z = 12;
    ct.x = inA.x + 0.5;
    ct.z = inA.z;
    for (let i = 0; i < BOMB_DEFUSE_TICKS - 1; i++) step(state, new Map([[2, [input({ use: true })]]]), events, BODEGA);
    expect(state.bomb.planted).not.toBeNull();
    step(state, new Map([[2, [input({ use: true })]]]), events, BODEGA);
    expect(state.bomb.planted).toBeNull();
    expect(events.some((e) => e.t === "bomb" && e.what === "defused")).toBe(true);
    expect(state.round.phase).toBe("over");
    expect(state.round.winner).toBe(TEAM_CT);
    expect(state.round.reason).toBe("defuse");
    expect(BOMB_DEFUSE_KIT_TICKS).toBeLessThan(BOMB_DEFUSE_TICKS);
  });

  it("el kit se compra y acorta la desactivación", () => {
    const { state, t, ct, events } = match();
    state.round.phase = "freeze";
    ct.money = 1000;
    ct.x = 0;
    ct.z = -12.5;
    step(state, new Map([[2, [input({ act: ACT_BUY_BASE + BUY_ITEMS.findIndex((b) => b.key === "kit") })]]]), events, BODEGA);
    expect(ct.kit).toBe(true);
    expect(ct.money).toBe(600);
    // Un T no puede.
    t.money = 1000;
    step(state, new Map([[1, [input({ act: ACT_BUY_BASE + BUY_ITEMS.findIndex((b) => b.key === "kit") })]]]), events, BODEGA);
    expect(t.kit).toBe(false);
    state.round.phase = "live";
    t.x = inA.x;
    t.z = inA.z;
    for (let i = 0; i < BOMB_PLANT_TICKS; i++) step(state, new Map([[1, [input({ use: true })]]]), events, BODEGA);
    t.x = 0;
    t.z = 12;
    ct.x = inA.x + 0.5;
    ct.z = inA.z;
    for (let i = 0; i < BOMB_DEFUSE_KIT_TICKS; i++) step(state, new Map([[2, [input({ use: true })]]]), events, BODEGA);
    expect(state.bomb.planted).toBeNull();
  });

  it("al morir el portador la bomba queda en el piso y otro T la levanta", () => {
    const { state, t, events } = match();
    const t2 = createPlayer(3, TEAM_T);
    t2.alive = true;
    t2.x = 5;
    t2.z = 12;
    state.players.push(t2);
    t.hp = 0;
    t.alive = false;
    t.hasBomb = false;
    state.bomb.carrier = -1;
    state.bomb.dropped = { x: t.x, y: 0, z: t.z };
    // Lejos no la levanta; al lado sí, de pasada.
    step(state, new Map([[3, [input()]]]), events, BODEGA);
    expect(t2.hasBomb).toBe(false);
    t2.x = t.x + 0.5;
    t2.z = t.z;
    step(state, new Map([[3, [input()]]]), events, BODEGA);
    expect(t2.hasBomb).toBe(true);
    expect(state.bomb.carrier).toBe(3);
    expect(state.bomb.dropped).toBeNull();
    expect(events.some((e) => e.t === "bomb" && e.what === "picked")).toBe(true);
  });

  it("en la ronda siguiente la bomba vuelve a salir", () => {
    const { state, t, ct, events } = match();
    ct.alive = false;
    step(state, new Map(), events, BODEGA);
    expect(state.round.winner).toBe(TEAM_T);
    for (let i = 0; i < ROUND_OVER_TICKS; i++) step(state, new Map(), events, BODEGA);
    expect(state.round.number).toBe(2);
    expect(state.bomb.carrier).toBe(1);
    expect(t.hasBomb).toBe(true);
    expect(state.bomb.planted).toBeNull();
  });
});
