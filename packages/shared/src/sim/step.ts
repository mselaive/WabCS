import { ACT_BUY_BASE, ACT_DROP, ACT_NONE, ACT_PICKUP, MAX_HP, START_MONEY, TEAM_T, TRAIL_LENGTH } from "../constants.js";
import type { GameMap } from "../map/types.js";
import { KNIFE, SLOT_GRENADE, SLOT_SECONDARY, grenadeKind } from "../weapons.js";
import { applySlotAction, firstUsableSlot, recordTrail, resolveShot, shotRewind, stepWeaponState, switchTo } from "./combat.js";
import { stepGrenades, throwGrenade } from "./grenade.js";
import { dropActive, tryBuy, tryPickup } from "./inventory.js";
import { stepPlayerMovement } from "./movement.js";
import { stepRound } from "./rounds.js";
import type { GameState, PlayerInput, PlayerState, SimEvent } from "./types.js";

export function createPlayer(id: number, team = TEAM_T): PlayerState {
  return {
    id,
    team,
    alive: false,
    connected: true,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: true,
    crouch: 0,
    hp: MAX_HP,
    armor: 0,
    helmet: false,
    slots: [-1, -1, KNIFE, -1],
    ammo: [0, 0, 0, 0],
    reserve: [0, 0, 0, 0],
    active: SLOT_SECONDARY,
    grenades: [0, 0, 0],
    blindTicks: 0,
    fireCd: 0,
    reloadCd: 0,
    drawCd: 0,
    reloading: false,
    recoil: 0,
    recoilCool: 0,
    shootHeld: false,
    scoped: false,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    damage: 0,
    trail: new Array<number>(TRAIL_LENGTH * 3).fill(0),
    lastSeq: 0,
    diedAtTick: -1,
    killerId: -1,
  };
}

export function createGameState(): GameState {
  return {
    tick: 0,
    phase: "lobby",
    phaseTicksLeft: 0,
    players: [],
    drops: [],
    nextDropId: 1,
    grenades: [],
    smokes: [],
    nextGrenadeId: 1,
    round: {
      number: 0,
      phase: "freeze",
      ticksLeft: 0,
      score: [0, 0],
      lossStreak: [0, 0],
      winRounds: 8,
      winner: -1,
      reason: "",
      swapped: false,
    },
    winnerTeam: -1,
    seed: 1,
    mapIndex: 0,
  };
}

export function findPlayer(state: GameState, id: number): PlayerState | undefined {
  for (const p of state.players) if (p.id === id) return p;
  return undefined;
}

/** ¿Se puede caminar y disparar? No durante el tiempo de compra. */
export function canAct(state: GameState): boolean {
  return state.phase === "playing" && state.round.phase !== "freeze";
}

/**
 * Después de tirar una granada: una menos de ese tipo, y si no quedan de ese
 * tipo se pasa a otro tipo que quede, o al arma de antes. Compartido con la
 * predicción, que también tiene que saber con qué se queda en la mano.
 */
export function afterThrow(p: PlayerState, kind: number): void {
  p.grenades[kind] = Math.max(0, (p.grenades[kind] ?? 0) - 1);
  if ((p.grenades[kind] ?? 0) > 0) return;
  const other = p.grenades.findIndex((n) => n > 0);
  if (other >= 0) {
    p.slots[SLOT_GRENADE] = 9 + other;
    switchTo(p, SLOT_GRENADE);
    return;
  }
  p.slots[SLOT_GRENADE] = -1;
  switchTo(p, firstUsableSlot(p));
}

/**
 * Lo que un input hace en el servidor con un jugador: moverse, la acción
 * puntual, el arma y, si disparó, el tiro contra el mundo y los demás (o la
 * granada que sale de la mano).
 */
function stepPlayerInput(state: GameState, p: PlayerState, input: PlayerInput, map: GameMap, events: SimEvent[], acting: boolean): void {
  p.lastSeq = input.seq;
  stepPlayerMovement(p, input, map, acting);
  if (!p.alive) return;

  if (input.act !== ACT_NONE) {
    if (input.act >= ACT_BUY_BASE) tryBuy(state, p, input.act - ACT_BUY_BASE, map, events);
    else if (input.act === ACT_PICKUP) tryPickup(state, p, map, events);
    else if (input.act === ACT_DROP) dropActive(state, p, map, events);
    else applySlotAction(p, input.act);
  }

  const wasReloading = p.reloading;
  const fired = stepWeaponState(p, input, acting);
  if (!wasReloading && p.reloading) events.push({ t: "reload", byId: p.id, x: p.x, y: p.y, z: p.z });
  if (fired < 0) return;
  const kind = grenadeKind(fired);
  if (kind >= 0) {
    throwGrenade(state, p, kind, events, input.seq);
    afterThrow(p, kind);
  } else {
    resolveShot(state, p, fired, input.seq, shotRewind(state.tick, input.view), map, events);
  }
}

/**
 * El tick autoritativo. `inputs` trae, por jugador, los inputs a procesar en
 * este tick (ninguno, uno o dos), cada uno exactamente una vez y en orden.
 */
export function step(state: GameState, inputs: ReadonlyMap<number, PlayerInput[]>, events: SimEvent[], map: GameMap): void {
  state.tick++;

  if (state.phase === "countdown" || state.phase === "ended") {
    state.phaseTicksLeft--;
    return;
  }
  if (state.phase !== "playing") return;

  const acting = canAct(state);
  for (const p of state.players) {
    if (!p.connected) continue;
    const batch = inputs.get(p.id);
    if (!batch) continue;
    for (const input of batch) stepPlayerInput(state, p, input, map, events, acting);
  }

  for (let i = state.drops.length - 1; i >= 0; i--) {
    if (--state.drops[i]!.ticksLeft <= 0) state.drops.splice(i, 1);
  }

  stepGrenades(state, map, events);

  for (const p of state.players) if (p.alive) recordTrail(p, state.tick);

  stepRound(state, map, events);
}
