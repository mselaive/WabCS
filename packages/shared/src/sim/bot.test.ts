import { describe, expect, it } from "vitest";
import { BODEGA } from "../map/bodega.js";
import { ACT_BUY_BASE, FREEZE_TICKS, MODE_BOMB, TEAM_CT, TEAM_T } from "../constants.js";
import { wrapAngle } from "../math.js";
import { AK47, BUY_ITEMS, USP } from "../weapons.js";
import { botInput, createBotMemory } from "./bot.js";
import { findPath, navGridFor, walkable, cellOf } from "./nav.js";
import { startMatch } from "./rounds.js";
import { createGameState, createPlayer, step } from "./step.js";
import type { PlayerInput, SimEvent } from "./types.js";

describe("la grilla de caminos", () => {
  const grid = navGridFor(BODEGA);

  it("sabe por dónde se camina: spawns sí, paredes no", () => {
    expect(walkable(grid, ...cellOf(grid, 0, 12.5))).toBe(true);
    expect(walkable(grid, ...cellOf(grid, 0, -12.5))).toBe(true);
    // Adentro de la pared de la casita del mid.
    expect(walkable(grid, ...cellOf(grid, -3, 3.75))).toBe(false);
    // Adentro del garaje se camina por el piso (el nivel más bajo de la celda); el techo es otro nodo.
    const [gc, gr] = cellOf(grid, -17, 4.5);
    expect(walkable(grid, gc, gr)).toBe(true);
    expect(grid.floor[gr * grid.cols + gc]).toBe(0);
    expect(grid.start[gr * grid.cols + gc + 1]! - grid.start[gr * grid.cols + gc]!).toBe(2);
    // Arriba de la plataforma de la derecha (0,8 m) sí se puede estar.
    const [pc, pr] = cellOf(grid, 20, 2.5);
    expect(grid.floor[pr * grid.cols + pc]).toBeCloseTo(0.8, 2);
  });

  it("encuentra el camino de un spawn al otro y por los dos lados", () => {
    const path = findPath(grid, 0, 12.5, 0, -12.5);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(3);
    for (const p of path!) expect(walkable(grid, ...cellOf(grid, p.x, p.z))).toBe(true);
    const last = path![path!.length - 1]!;
    expect(Math.hypot(last.x - 0, last.z + 12.5)).toBeLessThan(0.8);
    // Al garaje por adentro, y a la plataforma de la derecha.
    expect(findPath(grid, 0, 12.5, -16, 4.5)).not.toBeNull();
    expect(findPath(grid, 0, 12.5, 20, 2.5)).not.toBeNull();
  });

  it("sube al techo del garaje por la escalera y baja por donde subió", () => {
    const up = findPath(grid, 0, 12.5, -17, 4.5, 0, 3.25);
    expect(up).not.toBeNull();
    const top = up![up!.length - 1]!;
    expect(top.y).toBeCloseTo(3.25, 2);
    // Sube por la escalera (pegada al muro oeste, z 7,2..12), no por el aire.
    for (const p of up!) {
      if (p.y > 0.1 && p.y < 3.2) {
        expect(p.x).toBeLessThan(-20.0);
        expect(p.z).toBeGreaterThan(7);
        expect(p.z).toBeLessThan(12.6);
      }
    }
    // Y desde arriba vuelve a encontrar camino al spawn CT.
    const down = findPath(grid, -17, 4.5, 0, -12.5, 3.25, 0);
    expect(down).not.toBeNull();
    expect(down![down!.length - 1]!.y).toBeCloseTo(0, 2);
  });

  it("no cruza paredes: cada tramo del camino está libre", () => {
    const path = findPath(grid, -14, 13, 14, -13)!;
    let prev = { x: -14, z: 13 };
    for (const p of path) {
      // Cada paso es corto (celdas vecinas, simplificadas en rectas): no salta nada.
      const steps = Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.25);
      for (let i = 1; i <= steps; i++) {
        const x = prev.x + ((p.x - prev.x) * i) / steps;
        const z = prev.z + ((p.z - prev.z) * i) / steps;
        expect(walkable(grid, ...cellOf(grid, x, z)), `${x},${z}`).toBe(true);
      }
      prev = p;
    }
  });
});

describe("el bot", () => {
  function match() {
    const state = createGameState();
    const bot = createPlayer(1, TEAM_T);
    const human = createPlayer(2, TEAM_CT);
    state.players.push(bot, human);
    const events: SimEvent[] = [];
    startMatch(state, 7, BODEGA, 8, events);
    const mem = createBotMemory(42, 1);
    return { state, bot, human, events, mem };
  }

  it("compra un rifle en el tiempo de compra si tiene plata", () => {
    const { state, bot, mem } = match();
    bot.money = 4000;
    const input = botInput(state, bot, mem, BODEGA);
    expect(input.act).toBe(ACT_BUY_BASE + BUY_ITEMS.findIndex((b) => b.key === "ak"));
    const inputs = new Map([[1, [input]]]);
    const events: SimEvent[] = [];
    step(state, inputs, events, BODEGA);
    expect(bot.slots[0]).toBe(AK47);
  });

  it("sale del spawn y avanza hacia el lado rival", () => {
    const { state, bot, human, mem, events } = match();
    // El humano, quieto y lejos de la vista: adentro del garaje CT.
    human.x = 17;
    human.z = -4.5;
    for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
    const z0 = bot.z;
    for (let i = 0; i < 8 * 20; i++) step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
    expect(bot.z).toBeLessThan(z0 - 4);
  });

  it("sube de verdad al techo del garaje si ese es su destino", () => {
    const { state, bot, human, mem, events } = match();
    human.x = 17;
    human.z = -4.5;
    for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
    // Lo mandamos arriba del garaje T; sin nadie a la vista, sigue el camino.
    const goUp = () => {
      mem.goal = { x: -17, y: 3.25, z: 4.5 };
      mem.path = [];
      mem.repathAt = 0;
    };
    goUp();
    let top = -1;
    for (let i = 0; i < 25 * 20; i++) {
      if (!mem.goal || mem.goal.y !== 3.25) goUp();
      step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
      top = Math.max(top, bot.y);
      if (bot.y > 3.2 && Math.hypot(bot.x + 17, bot.z - 4.5) < 1.5) break;
    }
    expect(top).toBeGreaterThan(3.2);
    expect(Math.hypot(bot.x + 17, bot.z - 4.5)).toBeLessThan(1.5);
  });

  it("al ver a alguien le apunta y le dispara, con retardo", () => {
    const { state, bot, human, mem, events } = match();
    for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
    // Los dos en la calle izquierda, cara a cara a 10 m, sin nada en el medio.
    bot.x = -16;
    bot.z = 14;
    mem.yaw = 0;
    human.x = -16;
    human.z = 9;
    // Que aguante los 60 ticks: si lo mata, el bot vuelve a patrullar y gira.
    human.hp = 100000;
    let shots = 0;
    let firstShotTick = -1;
    const before = human.hp;
    for (let i = 0; i < 60; i++) {
      const input = botInput(state, bot, mem, BODEGA);
      if (input.shoot && firstShotTick < 0) firstShotTick = i;
      if (input.shoot) shots++;
      step(state, new Map([[1, [input]]]), events, BODEGA);
    }
    expect(shots).toBeGreaterThan(0);
    // Reaccionó, pero no al instante (normal: 6 a 12 ticks).
    expect(firstShotTick).toBeGreaterThanOrEqual(5);
    expect(human.hp).toBeLessThan(before);
    // Se movió de costado mientras tiraba, pero sigue apuntándole.
    const toward = Math.atan2(-(human.x - bot.x), -(human.z - bot.z));
    expect(Math.abs(wrapAngle(mem.yaw - toward))).toBeLessThan(0.25);
    void USP;
  });

  it("con plata compra granadas, y tira una HE a donde vio al otro", () => {
    const { state, bot, human, mem, events } = match();
    bot.money = 16000;
    // Compra todo lo que quiera en el tiempo de compra.
    for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
    expect(bot.slots[0]).toBe(AK47);
    expect(bot.armor).toBe(100);
    expect(bot.grenades[0]).toBe(1);
    expect(bot.grenades[1]).toBe(1);
    // Lo vio hace poco detrás de los sacos de arena de su propio spawn, a 8 m, y ya no lo ve.
    bot.x = 0;
    bot.z = 14;
    mem.yaw = 0;
    human.x = 0;
    human.z = 5.3;
    human.y = 0;
    mem.lastKnown = { x: 0, y: 0, z: 5.3 };
    mem.seenAt = state.tick - 30;
    // Que no lo vea de verdad: lo escondemos del todo (otro lado del mapa) pero el recuerdo queda.
    human.x = 15;
    human.z = -12;
    const before = bot.grenades[0] + bot.grenades[1] + bot.grenades[2];
    let threw = false;
    for (let i = 0; i < 80 && !threw; i++) {
      const input = botInput(state, bot, mem, BODEGA);
      step(state, new Map([[1, [input]]]), events, BODEGA);
      threw = events.some((e) => e.t === "throw" && e.byId === 1);
    }
    expect(threw).toBe(true);
    expect(bot.grenades[0] + bot.grenades[1] + bot.grenades[2]).toBe(before - 1);
    expect(state.grenades.length + state.smokes.length).toBeGreaterThan(0);
  });

  it("en modo bomba el portador va al sitio y planta, y un CT la desactiva", () => {
    const state = createGameState();
    const bot = createPlayer(1, TEAM_T);
    const ct = createPlayer(2, TEAM_CT);
    state.players.push(bot, ct);
    const events: SimEvent[] = [];
    // Semilla negativa a propósito: en el servidor sale de un XOR y puede serlo.
    startMatch(state, -1234567, BODEGA, 8, events, MODE_BOMB);
    const mem = createBotMemory(5, 2);
    const ctMem = createBotMemory(6, 2);
    // El CT, en el rincón de adentro del garaje CT (sitio A), y el bot va al B.
    ct.x = 20.5;
    ct.z = -6.3;
    expect(bot.hasBomb).toBe(true);
    for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
    mem.site = 1;
    mem.goal = null;
    let planted = false;
    for (let i = 0; i < 60 * 20 && !planted; i++) {
      step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
      ct.x = 20.5;
      ct.z = -6.3;
      planted = state.bomb.planted !== null;
    }
    expect(planted).toBe(true);
    // Ahora el CT bot va a buscarla y la desactiva (sin kit tarda 10 s).
    bot.alive = false;
    let defused = false;
    for (let i = 0; i < 60 * 20 && !defused; i++) {
      step(state, new Map([[2, [botInput(state, ct, ctMem, BODEGA)]]]), events, BODEGA);
      defused = events.some((e) => e.t === "bomb" && e.what === "defused");
    }
    expect(defused).toBe(true);
    expect(state.round.winner).toBe(TEAM_CT);
  });

  it("no dispara a través de la pared de la casita", () => {
    const { state, bot, human, mem, events } = match();
    for (let i = 0; i < FREEZE_TICKS; i++) step(state, new Map([[1, [botInput(state, bot, mem, BODEGA)]]]), events, BODEGA);
    bot.x = -3;
    bot.z = 6;
    mem.yaw = 0;
    human.x = -3;
    human.z = -6;
    let shots = 0;
    for (let i = 0; i < 30; i++) {
      const input = botInput(state, bot, mem, BODEGA);
      if (input.shoot) shots++;
      step(state, new Map([[1, [input]]]), events, BODEGA);
    }
    expect(shots).toBe(0);
  });
});

export type { PlayerInput };
