import type { DropState, GameState, GrenadeState, PlayerState, SmokeState } from "../sim/types.js";
import {
  FLAG_ALIVE,
  FLAG_CONNECTED,
  FLAG_HELMET,
  FLAG_ON_GROUND,
  FLAG_RELOADING,
  FLAG_SCOPED,
  FLAG_SHOOT_HELD,
  SP_ACTIVE,
  SP_ARMOR,
  SP_CROUCH,
  SP_FLAGS,
  SP_HP,
  SP_ID,
  SP_LAST_SEQ,
  SP_OWN,
  SP_PITCH,
  SP_SLOTS,
  SP_TEAM,
  SP_VX,
  SP_VZ,
  SP_X,
  SP_Y,
  SP_YAW,
  SP_Z,
  type ClientMsg,
  type ServerMsg,
  type SnapBomb,
  type SnapDrop,
  type SnapGrenade,
  type SnapPlayer,
  type SnapRound,
  type SnapSmoke,
  type SnapStanding,
} from "./messages.js";

/**
 * Toda la (de)serialización pasa por acá. Hoy es JSON: Cloudflare cobra por
 * CANTIDAD de mensajes, no por tamaño, así que JSON no cuesta plata. Si algún
 * día molesta el ancho de banda, se reemplaza por DataView sin tocar nada más.
 */

/** Posiciones a 1 cm. */
const P = 100;
/** Ángulos en milirradianes. */
const A = 1000;

export const packAngle = (rad: number): number => Math.round(rad * A);
export const unpackAngle = (mrad: number): number => mrad / A;

export function encodeClient(msg: ClientMsg): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMsg | null {
  try {
    const v = JSON.parse(raw) as ClientMsg;
    return v && typeof v === "object" && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

export function encodeServer(msg: ServerMsg): string {
  return JSON.stringify(msg);
}

export function decodeServer(raw: string): ServerMsg | null {
  try {
    const v = JSON.parse(raw) as ServerMsg;
    return v && typeof v === "object" && typeof v.t === "string" ? v : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ snapshots

export function packPlayer(p: PlayerState, own: boolean): SnapPlayer {
  let flags = 0;
  if (p.alive) flags |= FLAG_ALIVE;
  if (p.connected) flags |= FLAG_CONNECTED;
  if (p.helmet) flags |= FLAG_HELMET;
  if (p.scoped) flags |= FLAG_SCOPED;
  if (p.reloading) flags |= FLAG_RELOADING;
  if (p.onGround) flags |= FLAG_ON_GROUND;
  if (p.shootHeld) flags |= FLAG_SHOOT_HELD;
  const out: SnapPlayer = [
    p.id,
    p.team,
    Math.round(p.x * P),
    Math.round(p.y * P),
    Math.round(p.z * P),
    packAngle(p.yaw),
    packAngle(p.pitch),
    Math.ceil(p.hp),
    p.armor,
    flags,
    p.slots[p.active] ?? 0,
    (p.slots[0] ?? -1) + 1 + ((p.slots[1] ?? -1) + 1) * 16,
    p.lastSeq,
    p.crouch,
    Math.round(p.vx * P),
    Math.round(p.vz * P),
  ];
  if (own) {
    out.push(
      p.ammo[0] ?? 0,
      p.reserve[0] ?? 0,
      p.ammo[1] ?? 0,
      p.reserve[1] ?? 0,
      p.money,
      p.fireCd,
      p.reloadCd,
      p.drawCd,
      p.recoil,
      Math.round(p.vy * P),
      (p.grenades[0] ?? 0) + (p.grenades[1] ?? 0) * 4 + (p.grenades[2] ?? 0) * 16,
      p.blindTicks,
      (p.hasBomb ? 1 : 0) + (p.kit ? 2 : 0),
    );
  }
  return out;
}

export interface UnpackedPlayer {
  id: number;
  team: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  armor: number;
  alive: boolean;
  connected: boolean;
  helmet: boolean;
  scoped: boolean;
  reloading: boolean;
  onGround: boolean;
  shootHeld: boolean;
  /** Id del arma en la mano. */
  weapon: number;
  slots: [number, number, number, number];
  active: number;
  lastSeq: number;
  crouch: number;
  vx: number;
  vz: number;
  /** Sólo en la tupla propia. */
  own: {
    ammo: [number, number, number, number];
    reserve: [number, number, number, number];
    money: number;
    fireCd: number;
    reloadCd: number;
    drawCd: number;
    recoil: number;
    vy: number;
    grenades: [number, number, number];
    blindTicks: number;
    hasBomb: boolean;
    kit: boolean;
  } | null;
}

export function unpackPlayer(t: SnapPlayer): UnpackedPlayer {
  const flags = t[SP_FLAGS] ?? 0;
  const slotsPacked = t[SP_SLOTS] ?? 0;
  const s0 = (slotsPacked % 16) - 1;
  const s1 = Math.floor(slotsPacked / 16) - 1;
  const weapon = t[SP_ACTIVE] ?? 0;
  const isGrenade = weapon >= 9 && weapon <= 11;
  const slots: [number, number, number, number] = [s0, s1, 0, isGrenade ? weapon : -1];
  const active = isGrenade ? 3 : weapon === s0 && s0 >= 0 ? 0 : weapon === s1 && s1 >= 0 ? 1 : 2;
  const gpacked = t[SP_OWN + 10] ?? 0;
  const own =
    t.length > SP_OWN
      ? {
          ammo: [t[SP_OWN] ?? 0, t[SP_OWN + 2] ?? 0, 0, 0] as [number, number, number, number],
          reserve: [t[SP_OWN + 1] ?? 0, t[SP_OWN + 3] ?? 0, 0, 0] as [number, number, number, number],
          money: t[SP_OWN + 4] ?? 0,
          fireCd: t[SP_OWN + 5] ?? 0,
          reloadCd: t[SP_OWN + 6] ?? 0,
          drawCd: t[SP_OWN + 7] ?? 0,
          recoil: t[SP_OWN + 8] ?? 0,
          vy: (t[SP_OWN + 9] ?? 0) / P,
          grenades: [gpacked % 4, Math.floor(gpacked / 4) % 4, Math.floor(gpacked / 16) % 4] as [number, number, number],
          blindTicks: t[SP_OWN + 11] ?? 0,
          hasBomb: ((t[SP_OWN + 12] ?? 0) & 1) !== 0,
          kit: ((t[SP_OWN + 12] ?? 0) & 2) !== 0,
        }
      : null;
  return {
    id: t[SP_ID] ?? 0,
    team: t[SP_TEAM] ?? 0,
    x: (t[SP_X] ?? 0) / P,
    y: (t[SP_Y] ?? 0) / P,
    z: (t[SP_Z] ?? 0) / P,
    yaw: unpackAngle(t[SP_YAW] ?? 0),
    pitch: unpackAngle(t[SP_PITCH] ?? 0),
    hp: t[SP_HP] ?? 0,
    armor: t[SP_ARMOR] ?? 0,
    alive: (flags & FLAG_ALIVE) !== 0,
    connected: (flags & FLAG_CONNECTED) !== 0,
    helmet: (flags & FLAG_HELMET) !== 0,
    scoped: (flags & FLAG_SCOPED) !== 0,
    reloading: (flags & FLAG_RELOADING) !== 0,
    onGround: (flags & FLAG_ON_GROUND) !== 0,
    shootHeld: (flags & FLAG_SHOOT_HELD) !== 0,
    weapon,
    slots,
    active,
    lastSeq: t[SP_LAST_SEQ] ?? 0,
    crouch: t[SP_CROUCH] ?? 0,
    vx: (t[SP_VX] ?? 0) / P,
    vz: (t[SP_VZ] ?? 0) / P,
    own,
  };
}

export function packDrop(d: DropState): SnapDrop {
  return [d.id, d.weapon, Math.round(d.x * P), Math.round(d.y * P), Math.round(d.z * P), packAngle(d.yaw)];
}

export interface UnpackedDrop {
  id: number;
  weapon: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function unpackDrop(t: SnapDrop): UnpackedDrop {
  return { id: t[0], weapon: t[1], x: t[2] / P, y: t[3] / P, z: t[4] / P, yaw: unpackAngle(t[5]) };
}

export function packGrenade(g: GrenadeState): SnapGrenade {
  return [g.id, g.kind, Math.round(g.x * P), Math.round(g.y * P), Math.round(g.z * P), Math.round(g.vx * P), Math.round(g.vy * P), Math.round(g.vz * P)];
}

export interface UnpackedGrenade {
  id: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export function unpackGrenade(t: SnapGrenade): UnpackedGrenade {
  return { id: t[0], kind: t[1], x: t[2] / P, y: t[3] / P, z: t[4] / P, vx: t[5] / P, vy: t[6] / P, vz: t[7] / P };
}

export function packSmoke(s: SmokeState): SnapSmoke {
  return [s.id, Math.round(s.x * P), Math.round(s.y * P), Math.round(s.z * P), s.ticksLeft];
}

export function unpackSmoke(t: SnapSmoke): SmokeState {
  return { id: t[0], x: t[1] / P, y: t[2] / P, z: t[3] / P, ticksLeft: t[4] };
}

const REASONS = ["", "elim", "time", "bomb", "defuse"] as const;

export function packRound(state: GameState): SnapRound {
  const r = state.round;
  return [
    r.number,
    r.phase === "freeze" ? 0 : r.phase === "live" ? 1 : 2,
    r.ticksLeft,
    r.score[0],
    r.score[1],
    r.winRounds,
    r.winner,
    r.swapped ? 1 : 0,
    state.mode,
    Math.max(0, REASONS.indexOf(r.reason)),
  ];
}

export interface UnpackedRound {
  number: number;
  phase: "freeze" | "live" | "over";
  ticksLeft: number;
  score: [number, number];
  winRounds: number;
  winner: number;
  swapped: boolean;
  mode: number;
  reason: (typeof REASONS)[number];
}

export function unpackRound(t: SnapRound): UnpackedRound {
  return {
    number: t[0],
    phase: t[1] === 0 ? "freeze" : t[1] === 1 ? "live" : "over",
    ticksLeft: t[2],
    score: [t[3], t[4]],
    winRounds: t[5],
    winner: t[6],
    swapped: t[7] === 1,
    mode: t[8] ?? 0,
    reason: REASONS[t[9] ?? 0] ?? "",
  };
}

export function packBomb(state: GameState): SnapBomb {
  const b = state.bomb;
  const at = b.planted ?? b.dropped;
  const busy = b.planting ?? b.defusing;
  const progress = busy ? Math.round(((busy.total - busy.ticksLeft) / busy.total) * 100) : 0;
  return [
    b.carrier,
    b.planted ? 2 : b.dropped ? 1 : 0,
    at ? Math.round(at.x * P) : 0,
    at ? Math.round(at.y * P) : 0,
    at ? Math.round(at.z * P) : 0,
    b.planted?.ticksLeft ?? 0,
    busy?.id ?? -1,
    progress,
    b.planted?.site ?? "",
  ];
}

export interface UnpackedBomb {
  carrier: number;
  /** 0 nadie la tiene a la vista, 1 en el piso, 2 plantada. */
  state: number;
  x: number;
  y: number;
  z: number;
  ticksLeft: number;
  busyId: number;
  progress: number;
  site: string;
}

export function unpackBomb(t: SnapBomb): UnpackedBomb {
  return { carrier: t[0], state: t[1], x: t[2] / P, y: t[3] / P, z: t[4] / P, ticksLeft: t[5], busyId: t[6], progress: t[7], site: t[8] };
}

/** La tabla: los que están (el que se fue en plena partida ya no cuenta). */
export function packStandings(state: GameState): SnapStanding[] {
  return state.players
    .filter((p) => p.connected)
    .map((p) => [p.id, p.kills, p.deaths, p.alive ? 1 : 0, p.team, Math.round(p.damage), p.money]);
}
