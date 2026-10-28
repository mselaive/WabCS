import type { MatchPhase, PlayerMeta, SimEvent } from "../sim/types.js";

/**
 * Contrato cliente/servidor. Los mensajes de control son objetos legibles; los
 * datos "calientes" (snapshots) van como tuplas, que es lo que se manda 20
 * veces por segundo.
 */

// ------------------------------------------------------------ cliente -> servidor

export interface ReadyMsg {
  t: "ready";
  ready: boolean;
}

export interface InputMsg {
  t: "in";
  seq: number;
  /** -1 | 0 | 1 */
  f: number;
  s: number;
  /** Yaw y pitch en milirradianes. */
  yaw: number;
  pit: number;
  /** Bits BTN_*. */
  btn: number;
  /** Acción puntual (ACT_*). */
  act: number;
  /** Tick que tenías en pantalla, en décimas. Para la compensación de lag. */
  vt?: number;
}

export interface PingMsg {
  t: "ping";
  c: number;
}

/** Solo el host: arrancar sin esperar a que todos marquen listo. */
export interface StartMsg {
  t: "start";
}

export interface KickMsg {
  t: "kick";
  id: number;
}

export interface AddBotMsg {
  t: "bot";
}

/** Cambiarse de equipo (en el lobby). */
export interface TeamMsg {
  t: "team";
  team: number;
}

/** El host elige a cuántas rondas se juega. */
export interface RoundsMsg {
  t: "rounds";
  win: number;
}

export interface ChatMsg {
  t: "chat";
  text: string;
}

/** El host elige la dificultad de los bots (índice en BOT_SKILLS). */
export interface BotSkillMsg {
  t: "botSkill";
  skill: number;
}

export type ClientMsg = ReadyMsg | InputMsg | PingMsg | StartMsg | KickMsg | AddBotMsg | TeamMsg | RoundsMsg | ChatMsg | BotSkillMsg;

// ------------------------------------------------------------ servidor -> cliente

export interface WelcomeMsg {
  t: "welcome";
  you: number;
  room: string;
  hostId: number;
  roster: PlayerMeta[];
  phase: MatchPhase;
  winRounds: number;
  map: number;
}

export interface RosterMsg {
  t: "roster";
  roster: PlayerMeta[];
  hostId: number;
  winRounds: number;
  map: number;
  /** Dificultad de los bots de la sala. */
  botSkill: number;
  /** Milisegundos hasta que la próxima partida arranque sola. */
  nextIn?: number;
}

export interface MatchStartMsg {
  t: "start";
  seed: number;
  map: number;
}

/**
 * Un jugador en el snapshot. Posiciones en centímetros, ángulos en
 * milirradianes. Los últimos campos van sólo en la tupla del propio jugador.
 *
 *  0 id, 1 team, 2 x, 3 y, 4 z, 5 yaw, 6 pitch, 7 hp, 8 armor, 9 flags,
 * 10 arma activa, 11 ranuras (s0+1 + (s1+1)*16), 12 lastSeq, 13 crouch,
 * 14 vx, 15 vz (cm/s, para extrapolar al interpolar)
 * --- sólo el propio:
 * 16 ammo0, 17 reserve0, 18 ammo1, 19 reserve1, 20 money, 21 fireCd,
 * 22 reloadCd, 23 drawCd, 24 recoil, 25 vy (cm/s)
 */
export type SnapPlayer = number[];

export const SP_ID = 0;
export const SP_TEAM = 1;
export const SP_X = 2;
export const SP_Y = 3;
export const SP_Z = 4;
export const SP_YAW = 5;
export const SP_PITCH = 6;
export const SP_HP = 7;
export const SP_ARMOR = 8;
export const SP_FLAGS = 9;
export const SP_ACTIVE = 10;
export const SP_SLOTS = 11;
export const SP_LAST_SEQ = 12;
export const SP_CROUCH = 13;
export const SP_VX = 14;
export const SP_VZ = 15;
export const SP_OWN = 16;

export const FLAG_ALIVE = 1;
export const FLAG_CONNECTED = 2;
export const FLAG_HELMET = 4;
export const FLAG_SCOPED = 8;
export const FLAG_RELOADING = 16;
export const FLAG_ON_GROUND = 32;
export const FLAG_SHOOT_HELD = 64;

/** [id, arma, x, y, z, yaw] (cm y mrad). */
export type SnapDrop = [number, number, number, number, number, number];

/** [id, kills, deaths, vivo, team, daño, dinero]. Público: es la tabla. */
export type SnapStanding = [number, number, number, number, number, number, number];

/**
 * La ronda: [número, fase (0 freeze, 1 live, 2 over), ticks que quedan,
 * puntos T, puntos CT, rondas para ganar, ganador de la ronda, lados cambiados].
 */
export type SnapRound = [number, number, number, number, number, number, number, number];

export interface SnapshotMsg {
  t: "s";
  tick: number;
  /** Reloj del servidor (Date.now()), para sincronizar. */
  now: number;
  phase: MatchPhase;
  /** Ticks que quedan de la fase (countdown, ended). */
  left: number;
  rd: SnapRound;
  players: SnapPlayer[];
  drops: SnapDrop[];
  st: SnapStanding[];
  /** Equipo ganador del partido, o -1. */
  winner: number;
  ev?: SimEvent[];
}

export interface ErrMsg {
  t: "err";
  code: "room_full" | "kicked" | "version" | "bad_request";
  message: string;
}

export interface PongMsg {
  t: "pong";
  c: number;
  s: number;
}

export interface ChatOutMsg {
  t: "chat";
  by: number;
  text: string;
}

export type ServerMsg = WelcomeMsg | RosterMsg | MatchStartMsg | SnapshotMsg | ErrMsg | PongMsg | ChatOutMsg;
