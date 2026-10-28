import {
  ACT_BUY_BASE,
  ACT_NONE,
  ACT_SLOT_0,
  ACT_SLOT_1,
  HEAD_HEIGHT,
  TEAM_CT,
  TEAM_T,
  TICK_RATE,
} from "../constants.js";
import { mulberry32, wrapAngle } from "../math.js";
import { segmentClear } from "../map/raycast.js";
import type { GameMap } from "../map/types.js";
import { BUY_ITEMS, SLOT_KNIFE, SLOT_PRIMARY, SLOT_SECONDARY, weapon } from "../weapons.js";
import { eyeHeightOf, heightOf } from "./movement.js";
import { findPath, navGridFor, randomWalkableIn } from "./nav.js";
import type { GameState, PlayerInput, PlayerState } from "./types.js";

/**
 * Qué tan bueno es un bot. `react` son los ticks que tarda en empezar a
 * disparar cuando te ve; `aimErr` cuánto tiembla la puntería (radianes);
 * `turn` qué fracción del giro hace por tick; `burst` tiros seguidos antes
 * de soltar `pause` ticks; `head` con qué probabilidad apunta a la cabeza;
 * `sight` hasta dónde ve.
 */
export interface BotSkill {
  name: string;
  react: [number, number];
  aimErr: number;
  turn: number;
  burst: number;
  pause: number;
  head: number;
  sight: number;
  /** Medio ángulo de visión (radianes). */
  fov: number;
}

export const BOT_SKILLS: readonly BotSkill[] = [
  { name: "Fácil", react: [14, 24], aimErr: 0.07, turn: 0.18, burst: 3, pause: 10, head: 0, sight: 30, fov: 1.2 },
  { name: "Normal", react: [6, 12], aimErr: 0.03, turn: 0.33, burst: 5, pause: 6, head: 0.15, sight: 45, fov: 1.4 },
  { name: "Difícil", react: [2, 5], aimErr: 0.012, turn: 0.6, burst: 8, pause: 3, head: 0.45, sight: 60, fov: 1.6 },
];

export interface BotMemory {
  skill: number;
  rng: () => number;
  yaw: number;
  pitch: number;
  path: { x: number; z: number }[];
  goal: { x: number; z: number } | null;
  repathAt: number;
  target: number;
  seenAt: number;
  lastKnown: { x: number; y: number; z: number } | null;
  reactLeft: number;
  errYaw: number;
  errPitch: number;
  burstLeft: number;
  pauseLeft: number;
  strafe: number;
  strafeUntil: number;
  boughtRound: number;
  holdUntil: number;
  stuckTicks: number;
  lastX: number;
  lastZ: number;
  crouchUntil: number;
  seq: number;
}

export function createBotMemory(seed: number, skill: number): BotMemory {
  return {
    skill,
    rng: mulberry32(seed),
    yaw: 0,
    pitch: 0,
    path: [],
    goal: null,
    repathAt: 0,
    target: -1,
    seenAt: -1000,
    lastKnown: null,
    reactLeft: 0,
    errYaw: 0,
    errPitch: 0,
    burstLeft: 0,
    pauseLeft: 0,
    strafe: 0,
    strafeUntil: 0,
    boughtRound: -1,
    holdUntil: 0,
    stuckTicks: 0,
    lastX: 0,
    lastZ: 0,
    crouchUntil: 0,
    seq: 1,
  };
}

/** Le pasaron cerca o le pegaron: ahora sabe por dónde anda el otro. */
export function botAlert(mem: BotMemory, x: number, y: number, z: number, tick: number): void {
  mem.lastKnown = { x, y, z };
  mem.seenAt = Math.max(mem.seenAt, tick - 10);
}

function blank(seq: number, yaw: number, pitch: number): PlayerInput {
  return { seq, fwd: 0, side: 0, yaw, pitch, shoot: false, reload: false, jump: false, crouch: false, walk: false, scope: false, act: ACT_NONE, view: -1 };
}

/** ¿El bot ve a `q`? De sus ojos al pecho o la cabeza, dentro de su campo de visión y alcance. */
function canSee(me: PlayerState, q: PlayerState, map: GameMap, skill: BotSkill, yaw: number): boolean {
  const dx = q.x - me.x;
  const dz = q.z - me.z;
  const dist = Math.hypot(dx, dz);
  if (dist > skill.sight) return false;
  const toward = Math.atan2(-dx, -dz);
  if (Math.abs(wrapAngle(toward - yaw)) > skill.fov) return false;
  const ex = me.x;
  const ey = me.y + eyeHeightOf(me);
  const ez = me.z;
  const h = heightOf(q);
  return (
    segmentClear(ex, ey, ez, q.x, q.y + h * 0.55, q.z, map.boxes) ||
    segmentClear(ex, ey, ez, q.x, q.y + h - 0.15, q.z, map.boxes) ||
    segmentClear(ex, ey, ez, q.x, q.y + 0.3, q.z, map.boxes)
  );
}

/** Qué comprar con lo que hay. Devuelve el índice en BUY_ITEMS o -1. */
function shopping(me: PlayerState, rng: () => number): number {
  const has = (slot: number) => (me.slots[slot] ?? -1) >= 0;
  const idx = (key: string) => BUY_ITEMS.findIndex((b) => b.key === key);
  if (!has(SLOT_PRIMARY)) {
    if (me.money >= 4750 + 650 && rng() < 0.25) return idx("awp");
    if (me.money >= (me.team === TEAM_T ? 2700 : 3100) + 650) return idx(me.team === TEAM_T ? "ak" : "m4");
    if (me.money >= 1500 + 650) return idx("mp5");
    if (me.money >= 1050 + 650 && rng() < 0.4) return idx("nova");
  }
  if (me.armor < 50) {
    if (me.money >= 1000) return idx("helmet");
    if (me.money >= 650) return idx("kevlar");
  }
  if (!has(SLOT_PRIMARY) && me.slots[SLOT_SECONDARY] !== 3 && me.money >= 700 + 650) return idx("deagle");
  return -1;
}

/**
 * El input de un bot para este tick. Compra en el tiempo de compra, patrulla
 * hacia el lado del rival (los CT aguantan un rato en su mitad), caza al
 * último que vio, y cuando ve a alguien se frena, apunta con error y retardo,
 * tira en ráfagas, recarga cuando se queda sin balas y se mueve de costado.
 */
export function botInput(state: GameState, me: PlayerState, mem: BotMemory, map: GameMap): PlayerInput {
  const skill = BOT_SKILLS[mem.skill] ?? BOT_SKILLS[1]!;
  const tick = state.tick;
  const rng = mem.rng;
  const grid = navGridFor(map);
  const input = blank(mem.seq++, mem.yaw, mem.pitch);

  // ---- Tiempo de compra: comprar y mirar hacia el centro.
  if (state.round.phase === "freeze") {
    if (mem.boughtRound !== state.round.number) {
      const item = shopping(me, rng);
      if (item >= 0) input.act = ACT_BUY_BASE + item;
      else mem.boughtRound = state.round.number;
      // Al empezar la ronda, de cero: nada de lo anterior sirve.
      mem.path = [];
      mem.goal = null;
      mem.target = -1;
      mem.lastKnown = null;
      mem.holdUntil = me.team === TEAM_CT ? tick + Math.floor((8 + rng() * 14) * TICK_RATE) : 0;
    }
    mem.yaw = Math.atan2(-(0 - me.x), -(0 - me.z));
    input.yaw = mem.yaw;
    // Con el rifle en la mano.
    if ((me.slots[SLOT_PRIMARY] ?? -1) >= 0 && me.active !== SLOT_PRIMARY) input.act = ACT_SLOT_0;
    return input;
  }

  // ---- Ver.
  let target: PlayerState | null = null;
  let bestD = Infinity;
  for (const q of state.players) {
    if (q === me || !q.alive || !q.connected || q.team === me.team) continue;
    const d = Math.hypot(q.x - me.x, q.z - me.z);
    if (d < bestD && canSee(me, q, map, skill, mem.yaw)) {
      bestD = d;
      target = q;
    }
  }
  if (target) {
    if (mem.target !== target.id) {
      mem.target = target.id;
      mem.reactLeft = skill.react[0] + Math.floor(rng() * (skill.react[1] - skill.react[0] + 1));
    }
    mem.seenAt = tick;
    mem.lastKnown = { x: target.x, y: target.y, z: target.z };
  } else if (tick - mem.seenAt > 2) {
    mem.target = -1;
  }

  // ---- Apuntar: hacia el blanco (con error que va variando) o hacia donde camina.
  const w = weapon(me.slots[me.active] ?? 0);
  let wantYaw = mem.yaw;
  let wantPitch = 0;
  if (target) {
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const dist = Math.hypot(dx, dz);
    const aimY = target.y + (rng() < skill.head ? heightOf(target) - HEAD_HEIGHT / 2 : heightOf(target) * 0.55);
    wantYaw = Math.atan2(-dx, -dz);
    wantPitch = Math.atan2(aimY - (me.y + eyeHeightOf(me)), dist);
    // El error se mueve despacio: ni perfecto ni ruido blanco.
    mem.errYaw += (rng() - 0.5) * skill.aimErr * 0.6;
    mem.errPitch += (rng() - 0.5) * skill.aimErr * 0.6;
    mem.errYaw *= 0.9;
    mem.errPitch *= 0.9;
    wantYaw += mem.errYaw;
    wantPitch += mem.errPitch;
  }

  // ---- Moverse.
  let fwd = 0;
  let side = 0;
  const hunting = mem.lastKnown !== null && tick - mem.seenAt < 6 * TICK_RATE;
  if (target) {
    // Parado se tira mejor; de a ratos, de costado.
    if (tick >= mem.strafeUntil) {
      // Para un lado, para el otro, o quieto: nunca una caminata larga de costado.
      if (mem.skill === 0) mem.strafe = 0;
      else if (mem.strafe !== 0) mem.strafe = rng() < 0.7 ? -mem.strafe : 0;
      else mem.strafe = rng() < 0.6 ? (rng() < 0.5 ? -1 : 1) : 0;
      mem.strafeUntil = tick + 4 + Math.floor(rng() * 6);
    }
    side = mem.strafe;
    if (bestD > 18 && w.melee === 0 && mem.skill === 2 && rng() < 0.02) mem.crouchUntil = tick + 30;
    if (w.melee > 0) fwd = bestD > 1.1 ? 1 : 0;
    mem.path = [];
  } else {
    // ¿A dónde? Al último visto, o a patrullar.
    if (hunting && mem.lastKnown) {
      const near = Math.hypot(mem.lastKnown.x - me.x, mem.lastKnown.z - me.z) < 1.5;
      if (near) mem.lastKnown = null;
      else if (!mem.goal || Math.hypot(mem.goal.x - mem.lastKnown.x, mem.goal.z - mem.lastKnown.z) > 1) {
        mem.goal = { x: mem.lastKnown.x, z: mem.lastKnown.z };
        mem.path = [];
      }
    }
    if (!mem.goal || Math.hypot(mem.goal.x - me.x, mem.goal.z - me.z) < 1.2) {
      mem.goal = pickGoal(me, mem, map, tick);
      mem.path = [];
    }
    if (mem.goal && (mem.path.length === 0 || tick >= mem.repathAt)) {
      mem.path = findPath(grid, me.x, me.z, mem.goal.x, mem.goal.z) ?? [];
      mem.repathAt = tick + 2 * TICK_RATE;
      if (mem.path.length === 0) mem.goal = null;
    }
    while (mem.path.length > 0 && Math.hypot(mem.path[0]!.x - me.x, mem.path[0]!.z - me.z) < 0.45) mem.path.shift();
    const next = mem.path[0];
    if (next) {
      const toward = Math.atan2(-(next.x - me.x), -(next.z - me.z));
      wantYaw = toward;
      const diff = wrapAngle(toward - mem.yaw);
      if (Math.abs(diff) < 1.0) fwd = 1;
      // Cazando de cerca, despacio y sin ruido.
      if (hunting && mem.lastKnown && Math.hypot(mem.lastKnown.x - me.x, mem.lastKnown.z - me.z) < 8) input.walk = true;
    }
  }

  // Si quiere moverse y no avanza, un salto y otro camino.
  if (fwd !== 0 || side !== 0) {
    const moved = Math.hypot(me.x - mem.lastX, me.z - mem.lastZ);
    mem.stuckTicks = moved < 0.03 ? mem.stuckTicks + 1 : 0;
    if (mem.stuckTicks > 12) {
      input.jump = true;
      if (mem.stuckTicks > 30) {
        mem.path = [];
        mem.goal = null;
        mem.repathAt = 0;
        mem.stuckTicks = 0;
      }
    }
  } else mem.stuckTicks = 0;
  mem.lastX = me.x;
  mem.lastZ = me.z;

  // ---- Girar hacia donde quiere mirar, de a poco.
  const dYaw = wrapAngle(wantYaw - mem.yaw);
  const turn = target ? skill.turn : Math.min(1, skill.turn * 1.6);
  mem.yaw = wrapAngle(mem.yaw + dYaw * turn);
  mem.pitch += (wantPitch - mem.pitch) * turn;
  input.yaw = Math.round(mem.yaw * 1000) / 1000;
  input.pitch = Math.round(mem.pitch * 1000) / 1000;
  input.fwd = fwd;
  input.side = side;
  input.crouch = tick < mem.crouchUntil;

  // ---- Disparar: con el blanco a la vista, reaccionado, y apuntando cerca.
  const ammo = me.ammo[me.active] ?? 0;
  const reserve = me.reserve[me.active] ?? 0;
  if (target) {
    if (mem.reactLeft > 0) mem.reactLeft--;
    const aimed = Math.abs(dYaw) < 0.12 + 1.5 / Math.max(1, bestD);
    if (w.mag > 0 && ammo === 0) {
      // Sin balas delante de alguien: la pistola si tiene, si no recargar.
      if (me.active === SLOT_PRIMARY && (me.ammo[SLOT_SECONDARY] ?? 0) > 0) input.act = ACT_SLOT_1;
      else if (reserve > 0) input.reload = true;
    } else if (mem.reactLeft === 0 && aimed) {
      if (mem.pauseLeft > 0) mem.pauseLeft--;
      else {
        if (mem.burstLeft <= 0) mem.burstLeft = skill.burst;
        // Las semiautomáticas necesitan soltar el gatillo entre tiro y tiro.
        input.shoot = w.auto ? true : tick % 2 === 0;
        if (input.shoot && me.fireCd === 0) mem.burstLeft--;
        if (mem.burstLeft <= 0) mem.pauseLeft = skill.pause;
      }
      if (w.zoom > 0) input.scope = true;
    }
  } else {
    // Tranquilo: recargar lo que falte y volver al rifle.
    if (w.mag > 0 && ammo < w.mag * 0.5 && reserve > 0 && !me.reloading) input.reload = true;
    if ((me.slots[SLOT_PRIMARY] ?? -1) >= 0 && me.active !== SLOT_PRIMARY && (me.ammo[SLOT_PRIMARY] ?? 0) + (me.reserve[SLOT_PRIMARY] ?? 0) > 0) input.act = ACT_SLOT_0;
    mem.burstLeft = 0;
    mem.pauseLeft = 0;
  }
  void SLOT_KNIFE;
  return input;
}

/** A dónde ir cuando no hay nadie: los T avanzan al lado CT; los CT aguantan y después salen. */
function pickGoal(me: PlayerState, mem: BotMemory, map: GameMap, tick: number): { x: number; z: number } | null {
  const grid = navGridFor(map);
  const b = map.bounds;
  const rng = mem.rng;
  // Los CT aguantan un rato en su mitad (cerca del mid), después van.
  if (me.team === TEAM_CT && tick < mem.holdUntil) {
    return randomWalkableIn(grid, b.minX + 2, b.minZ * 0.5, b.maxX - 2, -1, rng);
  }
  if (me.team === TEAM_T) {
    return randomWalkableIn(grid, b.minX + 2, b.minZ + 2, b.maxX - 2, -2, rng);
  }
  return randomWalkableIn(grid, b.minX + 2, 2, b.maxX - 2, b.maxZ - 2, rng);
}
