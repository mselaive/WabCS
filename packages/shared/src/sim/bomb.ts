import {
  BOMB_DAMAGE,
  BOMB_DEFUSE_KIT_TICKS,
  BOMB_DEFUSE_TICKS,
  BOMB_PICKUP_RANGE,
  BOMB_PLANT_TICKS,
  BOMB_RADIUS,
  BOMB_TIMER_TICKS,
  BOMB_USE_RANGE,
  MODE_BOMB,
  TEAM_CT,
  TEAM_T,
  ZONE_BODY,
} from "../constants.js";
import type { BombSite, GameMap } from "../map/types.js";
import { damagePlayer } from "./combat.js";
import { heightOf } from "./movement.js";
import type { BombState, GameState, PlayerInput, PlayerState, SimEvent } from "./types.js";

/** El id de "arma" con que mata la bomba en el kill feed. */
export const BOMB_WEAPON = 12;

export function createBombState(): BombState {
  return { carrier: -1, dropped: null, planted: null, planting: null, defusing: null, done: false };
}

/** En qué sitio está parado alguien, o null. */
export function siteAt(map: GameMap, x: number, z: number): BombSite | null {
  for (const s of map.sites) if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) return s;
  return null;
}

/** Al empezar la ronda: la bomba a un T al azar (el de menor id si no hay azar). */
export function giveBomb(state: GameState, rng: () => number): void {
  const b = state.bomb;
  b.carrier = -1;
  b.dropped = null;
  b.planted = null;
  b.planting = null;
  b.defusing = null;
  b.done = false;
  for (const p of state.players) p.hasBomb = false;
  if (state.mode !== MODE_BOMB) return;
  const ts = state.players.filter((p) => p.connected && p.alive && p.team === TEAM_T);
  if (ts.length === 0) return;
  const who = ts[Math.floor(rng() * ts.length)]!;
  who.hasBomb = true;
  b.carrier = who.id;
}

/** Murió el portador: la bomba queda en el piso donde cayó. */
export function dropBomb(state: GameState, p: PlayerState, events: SimEvent[]): void {
  if (!p.hasBomb) return;
  p.hasBomb = false;
  state.bomb.carrier = -1;
  state.bomb.dropped = { x: p.x, y: p.y, z: p.z };
  if (state.bomb.planting?.id === p.id) state.bomb.planting = null;
  events.push({ t: "bomb", what: "dropped", byId: p.id, x: p.x, y: p.y, z: p.z, site: "" });
}

/** ¿Está alguien plantando o desactivando? No se mueve mientras tanto. */
export function busyWithBomb(state: GameState, id: number): boolean {
  return state.bomb.planting?.id === id || state.bomb.defusing?.id === id;
}

/**
 * Lo que un input hace con la bomba: un T que pasa por encima la levanta; el
 * portador con E sostenida dentro de un sitio la planta; un CT con E
 * sostenida al lado de la plantada la desactiva. Soltar E cancela.
 */
export function stepBombInput(state: GameState, p: PlayerState, input: PlayerInput, map: GameMap, events: SimEvent[]): void {
  if (state.mode !== MODE_BOMB || !p.alive) return;
  const b = state.bomb;

  // Levantarla del piso (los T, de pasada).
  if (b.dropped && p.team === TEAM_T && b.carrier < 0) {
    const d = Math.hypot(b.dropped.x - p.x, b.dropped.y - p.y, b.dropped.z - p.z);
    if (d <= BOMB_PICKUP_RANGE + 0.3) {
      p.hasBomb = true;
      b.carrier = p.id;
      b.dropped = null;
      events.push({ t: "bomb", what: "picked", byId: p.id, x: p.x, y: p.y, z: p.z, site: "" });
    }
  }

  // Plantar.
  if (p.hasBomb && !b.planted) {
    const site = siteAt(map, p.x, p.z);
    if (input.use && site && p.onGround) {
      if (!b.planting || b.planting.id !== p.id) b.planting = { id: p.id, ticksLeft: BOMB_PLANT_TICKS, total: BOMB_PLANT_TICKS };
      if (--b.planting.ticksLeft <= 0) {
        b.planting = null;
        p.hasBomb = false;
        b.carrier = -1;
        // +1 porque la mecha ya descuenta en este mismo tick (stepBomb corre después).
        b.planted = { x: p.x, y: p.y, z: p.z, site: site.name, ticksLeft: BOMB_TIMER_TICKS + 1 };
        events.push({ t: "bomb", what: "planted", byId: p.id, x: p.x, y: p.y, z: p.z, site: site.name });
      }
    } else if (b.planting?.id === p.id) {
      b.planting = null;
    }
  }

  // Desactivar.
  if (b.planted && p.team === TEAM_CT) {
    const d = Math.hypot(b.planted.x - p.x, b.planted.z - p.z);
    if (input.use && d <= BOMB_USE_RANGE && Math.abs(b.planted.y - p.y) < 1.2 && p.onGround) {
      const total = p.kit ? BOMB_DEFUSE_KIT_TICKS : BOMB_DEFUSE_TICKS;
      if (!b.defusing || b.defusing.id !== p.id) b.defusing = { id: p.id, ticksLeft: total, total };
      if (--b.defusing.ticksLeft <= 0) {
        b.defusing = null;
        b.done = true;
        events.push({ t: "bomb", what: "defused", byId: p.id, x: b.planted.x, y: b.planted.y, z: b.planted.z, site: b.planted.site });
        b.planted = null;
        state.round.reason = "defuse";
      }
    } else if (b.defusing?.id === p.id) {
      b.defusing = null;
    }
  }
}

/** Un tick de la bomba plantada: la mecha, y el que estaba desactivando y se murió. */
export function stepBomb(state: GameState, map: GameMap, events: SimEvent[]): void {
  const b = state.bomb;
  if (state.mode !== MODE_BOMB) return;
  if (b.planting) {
    const who = state.players.find((p) => p.id === b.planting!.id);
    if (!who?.alive) b.planting = null;
  }
  if (b.defusing) {
    const who = state.players.find((p) => p.id === b.defusing!.id);
    if (!who?.alive) b.defusing = null;
  }
  if (!b.planted) return;
  if (--b.planted.ticksLeft > 0) return;
  // ¡Bum! A todos los que estén cerca, atravesando paredes (es una bomba).
  const at = b.planted;
  b.done = true;
  b.planted = null;
  b.defusing = null;
  state.round.reason = "bomb";
  events.push({ t: "bomb", what: "exploded", byId: -1, x: at.x, y: at.y, z: at.z, site: at.site });
  const planter = state.players.find((p) => p.team === TEAM_T && p.connected) ?? null;
  for (const q of state.players) {
    if (!q.alive || !q.connected) continue;
    const h = heightOf(q);
    const dist = Math.hypot(q.x - at.x, q.y + h / 2 - at.y, q.z - at.z);
    if (dist > BOMB_RADIUS) continue;
    const dmg = Math.max(1, Math.round(BOMB_DAMAGE * (1 - dist / BOMB_RADIUS)));
    damagePlayer(state, q, planter ?? q, dmg, ZONE_BODY, BOMB_WEAPON, q.x, q.y + h / 2, q.z, map, events);
  }
}
