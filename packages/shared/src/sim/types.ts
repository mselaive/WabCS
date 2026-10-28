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
  /** E sostenida: plantar o desactivar. */
  use: boolean;
  /** Acción puntual del tick (ver ACT_*). */
  act: number;
  /**
   * Tick del servidor que el jugador tenía en pantalla al mandar este input,
   * con fracción. Es lo que usa la compensación de lag. -1 si no se sabe.
   */
  view: number;
}

/** Cuatro ranuras: principal, pistola, cuchillo, y la granada en la mano. */
export type Slots = [number, number, number, number];

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

  /** Arma por ranura (id) o -1. La 2 siempre es el cuchillo; la 3, la granada que tiene en la mano. */
  slots: Slots;
  ammo: Slots;
  reserve: Slots;
  active: number;
  /** Cuántas granadas lleva de cada tipo: [HE, flash, humo]. */
  grenades: [number, number, number];
  /** Ticks que le quedan ciego por una flash. */
  blindTicks: number;
  /** Lleva la bomba (modo bomba, un T). */
  hasBomb: boolean;
  /** Kit de desactivación (CT). */
  kit: boolean;
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

/** Una granada en el aire (o rodando), hasta que estalla. */
export interface GrenadeState {
  id: number;
  /** 0 HE, 1 flash, 2 humo. */
  kind: number;
  ownerId: number;
  team: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ticksLeft: number;
}

/** Una nube de humo: tapa la vista (no las balas) mientras dure. */
export interface SmokeState {
  id: number;
  x: number;
  y: number;
  z: number;
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
  reason: "elim" | "time" | "bomb" | "defuse" | "";
  swapped: boolean;
}

/** La bomba (modo bomba): dónde está y qué le está pasando. */
export interface BombState {
  /** Quién la lleva, o -1. */
  carrier: number;
  /** Tirada en el piso (el portador murió), o null. */
  dropped: { x: number; y: number; z: number } | null;
  /** Plantada: dónde, en qué sitio y cuánto le falta para estallar. */
  planted: { x: number; y: number; z: number; site: string; ticksLeft: number } | null;
  /** Alguien plantando o desactivando: quién y cuánto le falta. */
  planting: { id: number; ticksLeft: number; total: number } | null;
  defusing: { id: number; ticksLeft: number; total: number } | null;
  /** Ya estalló o se desactivó en esta ronda. */
  done: boolean;
}

export interface GameState {
  tick: number;
  phase: MatchPhase;
  phaseTicksLeft: number;
  players: PlayerState[];
  drops: DropState[];
  nextDropId: number;
  grenades: GrenadeState[];
  smokes: SmokeState[];
  nextGrenadeId: number;
  round: RoundState;
  /** MODE_ELIM o MODE_BOMB. */
  mode: number;
  bomb: BombState;
  /** Equipo que ganó el partido, o -1. */
  winnerTeam: number;
  /** Semilla de la partida (para lo que sea aleatorio de verdad en el servidor). */
  seed: number;
  /** El generador de la partida (quién lleva la bomba). Sólo en el servidor. */
  rng?: () => number;
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
  | { t: "steps"; byId: number; x: number; y: number; z: number }
  /** Alguien tiró una granada (para el sonido y para emparejar la predicción). */
  | { t: "throw"; byId: number; seq: number; kind: number; id: number }
  /** Estalló: HE (daño ya aplicado por `hit`), flash (los `blindTicks` van en el snapshot) o humo. */
  | { t: "explode"; id: number; kind: number; x: number; y: number; z: number }
  /** La bomba: la plantaron, la desactivaron, estalló, cayó al piso, la levantaron. */
  | { t: "bomb"; what: "planted" | "defused" | "exploded" | "dropped" | "picked"; byId: number; x: number; y: number; z: number; site: string };
