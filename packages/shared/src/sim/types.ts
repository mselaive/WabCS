export type MatchPhase = "lobby" | "countdown" | "playing" | "ended";
export type RoundPhase = "freeze" | "live" | "over";

export interface PlayerInput {
  seq: number;
  /** Adelante/atrás y derecha/izquierda: -1, 0 o 1. Enteros para que dé lo mismo en ambos lados. */
  fwd: number;
  side: number;
  /** Hacia dónde mira, en radianes (ya redondeados a milirradianes, como viajan). */
  yaw: number;
  pitch: number;
  shoot: boolean;
  reload: boolean;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
  scope: boolean;
  /** Acción puntual del tick (ver ACT_*). */
  act: number;
  /**
   * Tick del servidor que el jugador tenía en pantalla al mandar este input,
   * con fracción. Es lo que usa la compensación de lag. -1 si no se sabe.
   */
  view: number;
}

export interface PlayerState {
  id: number;
  /** TEAM_T o TEAM_CT. */
  team: number;
  alive: boolean;
  /** Falso cuando se fue: su muñeco desaparece y no cuenta para la ronda. */
  connected: boolean;

  /** Posición de los pies. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  /** 0 de pie, CROUCH_TICKS agachado del todo; la altura se interpola. */
  crouch: number;

  hp: number;
  armor: number;
  helmet: boolean;

  /** Arma por ranura (id) o -1. La 2 siempre es el cuchillo. */
  slots: [number, number, number];
  ammo: [number, number, number];
  reserve: [number, number, number];
  active: number;
  /** Ticks hasta poder disparar / terminar de recargar / terminar de sacar el arma. */
  fireCd: number;
  reloadCd: number;
  drawCd: number;
  reloading: boolean;
  /** Tiros seguidos: sube la dispersión. Baja solo al dejar de disparar. */
  recoil: number;
  recoilCool: number;
  /** El gatillo venía apretado en el input anterior (para las semiautomáticas). */
  shootHeld: boolean;
  scoped: boolean;

  money: number;
  kills: number;
  deaths: number;
  damage: number;

  /** Dónde estuvo en los últimos ticks (x, y, z por tick), para rebobinar los tiros. */
  trail: number[];
  lastSeq: number;
  diedAtTick: number;
  killerId: number;
}

/** Un arma tirada en el piso. */
export interface DropState {
  id: number;
  weapon: number;
  ammo: number;
  reserve: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  ticksLeft: number;
}

export interface RoundState {
  /** Desde 1. */
  number: number;
  phase: RoundPhase;
  ticksLeft: number;
  /** Rondas ganadas por equipo: [T, CT]. */
  score: [number, number];
  lossStreak: [number, number];
  winRounds: number;
  /** Quién ganó la ronda que se está terminando, o -1. */
  winner: number;
  reason: "elim" | "time" | "";
  swapped: boolean;
}

export interface GameState {
  tick: number;
  phase: MatchPhase;
  phaseTicksLeft: number;
  players: PlayerState[];
  drops: DropState[];
  nextDropId: number;
  round: RoundState;
  /** Equipo que ganó el partido, o -1. */
  winnerTeam: number;
  /** Semilla de la partida (para lo que sea aleatorio de verdad en el servidor). */
  seed: number;
  mapIndex: number;
}

export interface PlayerMeta {
  id: number;
  name: string;
  team: number;
  ready: boolean;
  /** Se le cortó la conexión y el servidor le está guardando el lugar. */
  away?: boolean;
  bot?: boolean;
  /** Marcador de la sala: partidos jugados y ganados, kills sumadas. */
  played?: number;
  wins?: number;
  totalKills?: number;
}

/** Qué pegó un perdigón (en `hits` del evento `shot`). */
export const HIT_NONE = 0;
export const HIT_WORLD = 1;
export const HIT_BODY = 2;
export const HIT_HEAD = 3;

export type SimEvent =
  | {
      t: "shot";
      byId: number;
      seq: number;
      weapon: number;
      /** De dónde salió (los ojos). */
      x: number;
      y: number;
      z: number;
      /** Por perdigón: x, y, z donde terminó y qué pegó (HIT_*). Plano, de a cuatro. */
      hits: number[];
    }
  | {
      t: "hit";
      targetId: number;
      byId: number;
      amount: number;
      zone: number;
      x: number;
      y: number;
      z: number;
    }
  | { t: "kill"; targetId: number; byId: number; weapon: number; headshot: boolean }
  | {
      t: "round";
      phase: RoundPhase;
      number: number;
      winner: number;
      reason: string;
      score: [number, number];
    }
  | { t: "swap" }
  | { t: "match"; winner: number }
  | { t: "buy"; byId: number; item: number }
  | { t: "pickup"; byId: number; weapon: number }
  | { t: "drop"; byId: number; weapon: number }
  | { t: "reload"; byId: number; x: number; y: number; z: number }
  | { t: "steps"; byId: number; x: number; y: number; z: number };
