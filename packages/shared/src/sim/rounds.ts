import {
  ENDED_TICKS,
  FREEZE_TICKS,
  LOSS_BASE,
  LOSS_MAX_STREAK,
  LOSS_STEP,
  MAX_HP,
  MAX_MONEY,
  ROUND_OVER_TICKS,
  ROUND_TICKS,
  START_MONEY,
  TEAM_CT,
  TEAM_T,
  WIN_REWARD,
} from "../constants.js";
import type { GameMap } from "../map/types.js";
import { defaultPistol, KNIFE, SLOT_KNIFE, SLOT_SECONDARY, weapon } from "../weapons.js";
import { resetTrail } from "./combat.js";
import type { GameState, PlayerState, SimEvent } from "./types.js";

/** Le da a alguien lo de arranque: pistola del equipo, cuchillo, sin chaleco. */
export function giveStartingKit(p: PlayerState): void {
  const pistol = defaultPistol(p.team);
  p.slots = [-1, pistol, KNIFE, -1];
  p.ammo = [0, weapon(pistol).mag, 0, 0];
  p.reserve = [0, weapon(pistol).reserve, 0, 0];
  p.active = SLOT_SECONDARY;
  p.armor = 0;
  p.helmet = false;
  p.grenades = [0, 0, 0];
}

/** Arranca el partido: dinero inicial para todos y la primera ronda. */
export function startMatch(state: GameState, seed: number, map: GameMap, winRounds: number, events: SimEvent[]): void {
  state.phase = "playing";
  state.phaseTicksLeft = 0;
  state.seed = seed;
  state.winnerTeam = -1;
  state.tick = 0;
  state.drops = [];
  state.round = {
    number: 1,
    phase: "freeze",
    ticksLeft: FREEZE_TICKS,
    score: [0, 0],
    lossStreak: [0, 0],
    winRounds,
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
    giveStartingKit(p);
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
      // El que no estaba vivo arranca de cero; el que sobrevivió sigue con lo suyo.
      if (!p.alive) giveStartingKit(p);
      // Siempre con una pistola: la que tiró o le sacaron, se repone.
      if ((p.slots[SLOT_SECONDARY] ?? -1) < 0) {
        const pistol = defaultPistol(p.team);
        p.slots[SLOT_SECONDARY] = pistol;
        p.ammo[SLOT_SECONDARY] = weapon(pistol).mag;
        p.reserve[SLOT_SECONDARY] = weapon(pistol).reserve;
      }
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
      p.diedAtTick = -1;
      p.killerId = -1;
      // Si no tiene nada en la mano (se le fue la principal), que agarre algo.
      if ((p.slots[p.active] ?? -1) < 0) p.active = (p.slots[0] ?? -1) >= 0 ? 0 : SLOT_SECONDARY;
      resetTrail(p);
    });
  }
  events.push({ t: "round", phase: "freeze", number: r.number, winner: -1, reason: "", score: [r.score[0], r.score[1]] });
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
      r.ticksLeft = ROUND_TICKS;
      events.push({ t: "round", phase: "live", number: r.number, winner: -1, reason: "", score: [r.score[0], r.score[1]] });
    }
    return;
  }

  if (r.phase === "live") {
    r.ticksLeft--;
    const tAlive = aliveCount(state, TEAM_T);
    const ctAlive = aliveCount(state, TEAM_CT);
    let winner = -1;
    let reason: "elim" | "time" = "elim";
    if (ctAlive === 0 && tAlive > 0) winner = TEAM_T;
    else if (tAlive === 0 && ctAlive > 0) winner = TEAM_CT;
    else if (tAlive === 0 && ctAlive === 0) {
      // Los dos equipos se fueron o murieron a la vez: la ronda es de los CT, como por tiempo.
      winner = TEAM_CT;
      reason = "time";
    } else if (r.ticksLeft <= 0) {
      winner = TEAM_CT;
      reason = "time";
    }
    if (winner >= 0) endRound(state, winner, reason, events);
    return;
  }

  // over
  if (--r.ticksLeft <= 0) nextRound(state, map, events);
}

function endRound(state: GameState, winner: number, reason: "elim" | "time", events: SimEvent[]): void {
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
  for (const p of state.players) {
    if (!p.connected) continue;
    p.money = Math.min(MAX_MONEY, p.money + (p.team === winner ? WIN_REWARD : lossPay));
  }
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
