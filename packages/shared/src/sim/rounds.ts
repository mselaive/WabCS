import {
  ARMS_LADDER,
  ARMS_RESPAWN_TICKS,
  MODE_ARMS,
  MODE_AWP,
  ENDED_TICKS,
  FREEZE_TICKS,
  LOSS_BASE,
  LOSS_MAX_STREAK,
  LOSS_STEP,
  MAX_HP,
  MAX_MONEY,
  MODE_BOMB,
  MODE_ELIM,
  ROUND_OVER_TICKS,
  ROUND_TICKS,
  START_MONEY,
  TEAM_CT,
  TEAM_T,
  WIN_REWARD,
} from "../constants.js";
import { mulberry32 } from "../math.js";
import type { GameMap } from "../map/types.js";
import { AWP, defaultPistol, KNIFE, SLOT_KNIFE, SLOT_PRIMARY, SLOT_SECONDARY, weapon } from "../weapons.js";
import { giveBomb } from "./bomb.js";
import { resetTrail } from "./combat.js";
import type { GameState, PlayerState, SimEvent } from "./types.js";

/** Le da a alguien lo de arranque según el modo: pistola del equipo y cuchillo; AWP y cuchillo; o el arma de su nivel. */
export function giveStartingKit(p: PlayerState, mode = MODE_ELIM): void {
  if (mode === MODE_ARMS) {
    giveLevelKit(p);
    return;
  }
  p.grenades = [0, 0, 0];
  p.kit = false;
  p.hasBomb = false;
  if (mode === MODE_AWP) {
    p.slots = [AWP, -1, KNIFE, -1];
    p.ammo = [weapon(AWP).mag, 0, 0, 0];
    p.reserve = [weapon(AWP).reserve, 0, 0, 0];
    p.active = SLOT_PRIMARY;
    p.armor = 100;
    p.helmet = true;
    return;
  }
  const pistol = defaultPistol(p.team);
  p.slots = [-1, pistol, KNIFE, -1];
  p.ammo = [0, weapon(pistol).mag, 0, 0];
  p.reserve = [0, weapon(pistol).reserve, 0, 0];
  p.active = SLOT_SECONDARY;
  p.armor = 0;
  p.helmet = false;
}

/** El nivel en la carrera de armas: una baja, un escalón; el último es el cuchillo. */
export function armsLevel(p: PlayerState): number {
  return Math.min(p.kills, ARMS_LADDER.length - 1);
}

/** El arma del nivel (y cuchillo, chaleco y casco), nada más. */
export function giveLevelKit(p: PlayerState): void {
  const w = ARMS_LADDER[armsLevel(p)] ?? KNIFE;
  p.slots = [-1, -1, KNIFE, -1];
  p.ammo = [0, 0, 0, 0];
  p.reserve = [0, 0, 0, 0];
  p.active = SLOT_KNIFE;
  if (w !== KNIFE) {
    const slot = weapon(w).slot;
    p.slots[slot] = w;
    p.ammo[slot] = weapon(w).mag;
    p.reserve[slot] = weapon(w).reserve;
    p.active = slot;
  }
  p.armor = 100;
  p.helmet = true;
  p.grenades = [0, 0, 0];
  p.kit = false;
  p.hasBomb = false;
  p.reloading = false;
  p.reloadCd = 0;
  p.drawCd = weapon(p.slots[p.active] ?? KNIFE).drawTicks;
  p.scoped = false;
}

/** Arranca el partido: dinero inicial para todos y la primera ronda. */
export function startMatch(state: GameState, seed: number, map: GameMap, winRounds: number, events: SimEvent[], mode = MODE_ELIM): void {
  state.phase = "playing";
  state.phaseTicksLeft = 0;
  state.seed = seed;
  state.mode = mode;
  state.rng = mulberry32(seed);
  state.winnerTeam = -1;
  state.tick = 0;
  state.drops = [];
  state.round = {
    number: 1,
    phase: "freeze",
    ticksLeft: FREEZE_TICKS,
    score: [0, 0],
    lossStreak: [0, 0],
    // En la carrera de armas "a N" es el largo de la escalera: el marcador muestra el nivel más alto de cada equipo.
    winRounds: mode === MODE_ARMS ? ARMS_LADDER.length : winRounds,
    winner: -1,
    reason: "",
    swapped: false,
  };
  for (const p of state.players) {
    p.money = START_MONEY;
    p.kills = 0;
    p.deaths = 0;
    p.damage = 0;
    p.alive = false;
    giveStartingKit(p, mode);
  }
  startRound(state, map, events);
}

/** Pone a todos en su spawn y abre el tiempo de compra. Los vivos conservan lo suyo. */
export function startRound(state: GameState, map: GameMap, events: SimEvent[]): void {
  const r = state.round;
  r.phase = "freeze";
  r.ticksLeft = FREEZE_TICKS;
  r.winner = -1;
  r.reason = "";
  state.drops = [];
  state.grenades = [];
  state.smokes = [];

  for (const team of [TEAM_T, TEAM_CT]) {
    const spawns = map.spawns[team as 0 | 1];
    const members = state.players.filter((p) => p.connected && p.team === team).sort((a, b) => a.id - b.id);
    members.forEach((p, i) => {
      const s = spawns[i % spawns.length]!;
      const fixedKit = state.mode === MODE_AWP || state.mode === MODE_ARMS;
      // El que no estaba vivo arranca de cero; el que sobrevivió sigue con lo suyo (salvo que el modo reparta siempre lo mismo).
      if (!p.alive || fixedKit) giveStartingKit(p, state.mode);
      // Siempre con una pistola: la que tiró o le sacaron, se repone.
      if (!fixedKit && (p.slots[SLOT_SECONDARY] ?? -1) < 0) {
        const pistol = defaultPistol(p.team);
        p.slots[SLOT_SECONDARY] = pistol;
        p.ammo[SLOT_SECONDARY] = weapon(pistol).mag;
        p.reserve[SLOT_SECONDARY] = weapon(pistol).reserve;
      }
      placeAtSpawn(p, s);
    });
  }
  // Un T al azar se lleva la bomba (los CT pierden el kit si murieron: ya lo hizo giveStartingKit).
  giveBomb(state, state.rng ?? Math.random);
  events.push({ t: "round", phase: "freeze", number: r.number, winner: -1, reason: "", score: [r.score[0], r.score[1]] });
}

/** Vivo, entero y quieto en un punto de aparición, con lo que tenga en las manos. */
function placeAtSpawn(p: PlayerState, s: { x: number; y: number; z: number; yaw: number }): void {
  p.alive = true;
  p.hp = MAX_HP;
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.yaw = s.yaw;
  p.pitch = 0;
  p.onGround = true;
  p.crouch = 0;
  p.fireCd = 0;
  p.reloadCd = 0;
  p.drawCd = 0;
  p.reloading = false;
  p.recoil = 0;
  p.recoilCool = 0;
  p.scoped = false;
  p.blindTicks = 0;
  p.tagged = 0;
  p.fallImpact = 0;
  p.diedAtTick = -1;
  p.killerId = -1;
  // Cada ronda arranca con las armas cargadas y la reserva llena, también para el que sobrevivió.
  for (let slot = 0; slot < p.slots.length; slot++) {
    const w = p.slots[slot] ?? -1;
    if (w < 0) continue;
    p.ammo[slot] = weapon(w).mag;
    p.reserve[slot] = weapon(w).reserve;
  }
  // Si no tiene nada en la mano (se le fue la principal), que agarre algo.
  if ((p.slots[p.active] ?? -1) < 0) p.active = (p.slots[0] ?? -1) >= 0 ? 0 : (p.slots[SLOT_SECONDARY] ?? -1) >= 0 ? SLOT_SECONDARY : SLOT_KNIFE;
  resetTrail(p);
}

/**
 * Un tick de la carrera de armas: los muertos reaparecen a los 3 s en un
 * spawn de su equipo, cada baja cambia el arma por la siguiente, y la baja
 * con el cuchillo termina el partido. El marcador lleva el nivel más alto
 * de cada equipo.
 */
function stepArms(state: GameState, map: GameMap, events: SimEvent[]): void {
  const r = state.round;
  const rng = state.rng ?? Math.random;
  let best: [number, number] = [0, 0];
  let champion: PlayerState | null = null;
  for (const p of state.players) {
    if (!p.connected) continue;
    if (p.kills >= ARMS_LADDER.length) champion = p;
    best[p.team as 0 | 1] = Math.max(best[p.team as 0 | 1]!, armsLevel(p));
    if (!p.alive) {
      if (p.diedAtTick >= 0 && state.tick - p.diedAtTick < ARMS_RESPAWN_TICKS) continue;
      const spawns = map.spawns[p.team as 0 | 1];
      giveLevelKit(p);
      placeAtSpawn(p, spawns[Math.floor(rng() * spawns.length)] ?? spawns[0]!);
      continue;
    }
    // Subió de nivel: el arma nueva en la mano, cargada.
    const want = ARMS_LADDER[armsLevel(p)] ?? KNIFE;
    if (!p.slots.includes(want) || (want === KNIFE && ((p.slots[0] ?? -1) >= 0 || (p.slots[1] ?? -1) >= 0))) giveLevelKit(p);
  }
  r.score = best;
  const tLeft = connectedCount(state, TEAM_T);
  const ctLeft = connectedCount(state, TEAM_CT);
  if (champion || tLeft === 0 || ctLeft === 0) {
    state.phase = "ended";
    state.phaseTicksLeft = ENDED_TICKS;
    state.winnerTeam = champion ? champion.team : tLeft === 0 ? TEAM_CT : TEAM_T;
    for (const p of state.players) p.alive = false;
    events.push({ t: "match", winner: state.winnerTeam });
  }
}

function aliveCount(state: GameState, team: number): number {
  let n = 0;
  for (const p of state.players) if (p.connected && p.alive && p.team === team) n++;
  return n;
}

function connectedCount(state: GameState, team: number): number {
  let n = 0;
  for (const p of state.players) if (p.connected && p.team === team) n++;
  return n;
}

/** Un tick de la máquina de rondas. Decide quién ganó, paga y arranca la siguiente. */
export function stepRound(state: GameState, map: GameMap, events: SimEvent[]): void {
  const r = state.round;

  if (r.phase === "freeze") {
    if (--r.ticksLeft <= 0) {
      r.phase = "live";
      // La carrera de armas no tiene reloj: termina cuando alguien llega al cuchillo.
      r.ticksLeft = state.mode === MODE_ARMS ? 1_000_000 : ROUND_TICKS;
      events.push({ t: "round", phase: "live", number: r.number, winner: -1, reason: "", score: [r.score[0], r.score[1]] });
    }
    return;
  }

  if (r.phase === "live") {
    if (state.mode === MODE_ARMS) {
      stepArms(state, map, events);
      return;
    }
    const planted = state.bomb.planted !== null;
    // Con la bomba plantada el reloj de la ronda se congela: manda la mecha.
    if (!planted) r.ticksLeft--;
    const tAlive = aliveCount(state, TEAM_T);
    const ctAlive = aliveCount(state, TEAM_CT);
    let winner = -1;
    let reason: "elim" | "time" | "bomb" | "defuse" = "elim";
    if (state.mode === MODE_BOMB && state.bomb.done) {
      // Estalló (ganan los T) o la desactivaron (ganan los CT).
      winner = r.reason === "bomb" ? TEAM_T : TEAM_CT;
      reason = r.reason === "bomb" ? "bomb" : "defuse";
    } else if (ctAlive === 0 && tAlive > 0) winner = TEAM_T;
    else if (tAlive === 0 && ctAlive > 0 && !planted) winner = TEAM_CT;
    else if (tAlive === 0 && ctAlive === 0 && !planted) {
      // Los dos equipos se fueron o murieron a la vez: la ronda es de los CT, como por tiempo.
      winner = TEAM_CT;
      reason = "time";
    } else if (r.ticksLeft <= 0 && !planted) {
      winner = TEAM_CT;
      reason = "time";
    }
    if (winner >= 0) endRound(state, winner, reason, events);
    return;
  }

  // over
  if (--r.ticksLeft <= 0) nextRound(state, map, events);
}

function endRound(state: GameState, winner: number, reason: "elim" | "time" | "bomb" | "defuse", events: SimEvent[]): void {
  const r = state.round;
  const loser = winner === TEAM_T ? TEAM_CT : TEAM_T;
  r.phase = "over";
  r.ticksLeft = ROUND_OVER_TICKS;
  r.winner = winner;
  r.reason = reason;
  r.score[winner as 0 | 1]++;
  r.lossStreak[winner as 0 | 1] = 0;
  const lossPay = LOSS_BASE + LOSS_STEP * Math.min(LOSS_MAX_STREAK, r.lossStreak[loser as 0 | 1]);
  r.lossStreak[loser as 0 | 1] = Math.min(LOSS_MAX_STREAK, r.lossStreak[loser as 0 | 1] + 1);
  // Plantar paga aunque se pierda, como en CS; ganar por bomba paga un poco más.
  const plantBonus = state.mode === MODE_BOMB && (state.bomb.planted !== null || state.bomb.done) && reason !== "elim" ? 800 : 0;
  for (const p of state.players) {
    if (!p.connected) continue;
    let pay = p.team === winner ? WIN_REWARD : lossPay;
    if (p.team === TEAM_T && plantBonus > 0 && p.team !== winner) pay += plantBonus;
    if (reason === "bomb" && p.team === winner) pay += 250;
    p.money = Math.min(MAX_MONEY, p.money + pay);
  }
  // La bomba plantada que quedó (los CT ganaron por eliminación no se da: con bomba sigue la ronda).
  state.bomb.planting = null;
  state.bomb.defusing = null;
  events.push({ t: "round", phase: "over", number: r.number, winner, reason, score: [r.score[0], r.score[1]] });
}

function nextRound(state: GameState, map: GameMap, events: SimEvent[]): void {
  const r = state.round;
  const w = r.score[0] >= r.winRounds ? TEAM_T : r.score[1] >= r.winRounds ? TEAM_CT : -1;
  // Si un equipo se quedó sin nadie, el partido se termina: no hay con quién jugar.
  const tLeft = connectedCount(state, TEAM_T);
  const ctLeft = connectedCount(state, TEAM_CT);
  if (w >= 0 || tLeft === 0 || ctLeft === 0) {
    state.phase = "ended";
    state.phaseTicksLeft = ENDED_TICKS;
    state.winnerTeam = w >= 0 ? w : tLeft === 0 ? TEAM_CT : TEAM_T;
    for (const p of state.players) p.alive = false;
    events.push({ t: "match", winner: state.winnerTeam });
    return;
  }

  // A la mitad se cambia de lado: con todo de vuelta a cero, como en CS.
  if (!r.swapped && r.number === r.winRounds - 1) {
    r.swapped = true;
    r.score = [r.score[1], r.score[0]];
    r.lossStreak = [0, 0];
    for (const p of state.players) {
      p.team = p.team === TEAM_T ? TEAM_CT : TEAM_T;
      p.money = START_MONEY;
      p.alive = false;
    }
    events.push({ t: "swap" });
  }

  r.number++;
  startRound(state, map, events);
}

/** Cuántas rondas se juegan como mucho (para el marcador). */
export function maxRounds(winRounds: number): number {
  return winRounds * 2 - 1;
}

/** El equipo con menos gente (para el que entra). Empate: T. */
export function smallerTeam(players: readonly { connected: boolean; team: number }[]): number {
  let t = 0;
  let ct = 0;
  for (const p of players) {
    if (!p.connected) continue;
    if (p.team === TEAM_T) t++;
    else ct++;
  }
  return t <= ct ? TEAM_T : TEAM_CT;
}

export { SLOT_KNIFE };
