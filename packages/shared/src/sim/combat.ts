import {
  ACT_SLOT_0,
  ACT_SLOT_2,
  CROUCH_TICKS,
  HEAD_HEIGHT,
  KILL_REWARD,
  KNIFE_KILL_REWARD,
  LAG_COMP_MAX_TICKS,
  LEG_HEIGHT,
  MAX_MONEY,
  PLAYER_HALF_W,
  TRAIL_LENGTH,
  ZONE_BODY,
  ZONE_HEAD,
  ZONE_LEGS,
  ZONE_MULT,
} from "../constants.js";
import { hashUnit, lerp, viewDir, type Vec3 } from "../math.js";
import { rayAabb, raycastBoxes } from "../map/raycast.js";
import type { GameMap } from "../map/types.js";
import { KNIFE, SLOT_KNIFE, weapon, type WeaponDef } from "../weapons.js";
import { eyeHeightOf, heightOf } from "./movement.js";
import { dropWeaponAt } from "./inventory.js";
import { HIT_BODY, HIT_HEAD, HIT_NONE, HIT_WORLD, type GameState, type PlayerInput, type PlayerState, type SimEvent } from "./types.js";

/** Hasta dónde llega un tiro. */
const MAX_RANGE = 200;
/** Cada cuántos ticks sin disparar baja un punto el retroceso (un cargador entero tarda ~1,5 s en volver). */
const RECOIL_COOL_TICKS = 3;
/** Dispersión con la mira puesta: casi nada. */
const SCOPED_SPREAD = 0.0008;
/** Lo que agrega estar en el aire. */
const AIR_SPREAD = 0.1;

/**
 * Cambia de ranura si la acción lo pide y hay algo ahí. Compartido con la
 * predicción: de esto depende qué arma dispara.
 */
export function applySlotAction(p: PlayerState, act: number): void {
  if (act < ACT_SLOT_0 || act > ACT_SLOT_2) return;
  const slot = act - ACT_SLOT_0;
  if (slot === p.active) return;
  if ((p.slots[slot] ?? -1) < 0) return;
  switchTo(p, slot);
}

export function switchTo(p: PlayerState, slot: number): void {
  p.active = slot;
  p.drawCd = weapon(p.slots[slot] ?? KNIFE).drawTicks;
  p.reloadCd = 0;
  p.reloading = false;
  p.scoped = false;
  p.recoil = 0;
}

/** La ranura con algo, de la principal al cuchillo, cuando la actual queda vacía. */
export function firstUsableSlot(p: PlayerState): number {
  for (let s = 0; s < 3; s++) if ((p.slots[s] ?? -1) >= 0) return s;
  return SLOT_KNIFE;
}

/**
 * El estado del arma en un tick: cadencia, recarga, retroceso, mira, y si con
 * este input sale un tiro. Devuelve el id del arma que disparó o -1. Corre
 * igual en el cliente y en el servidor: así el cliente dibuja su tiro al
 * instante y el servidor llega al mismo resultado.
 *
 * `canAct` es falso en el tiempo de compra.
 */
export function stepWeaponState(p: PlayerState, input: PlayerInput, canAct: boolean): number {
  if (p.fireCd > 0) p.fireCd--;
  if (p.drawCd > 0) p.drawCd--;
  if (p.reloadCd > 0) {
    p.reloadCd--;
    if (p.reloadCd === 0 && p.reloading) {
      p.reloading = false;
      const w = weapon(p.slots[p.active] ?? KNIFE);
      const need = w.mag - (p.ammo[p.active] ?? 0);
      const take = Math.min(need, p.reserve[p.active] ?? 0);
      p.ammo[p.active] = (p.ammo[p.active] ?? 0) + take;
      p.reserve[p.active] = (p.reserve[p.active] ?? 0) - take;
    }
  }

  const wid = p.slots[p.active] ?? KNIFE;
  const w = weapon(wid);

  // La mira: se mantiene apretada (click derecho).
  p.scoped = w.zoom > 0 && input.scope && p.drawCd === 0 && !p.reloading;

  // El retroceso baja solo cuando se deja de disparar.
  if (p.fireCd === 0 && p.recoil > 0) {
    if (++p.recoilCool >= RECOIL_COOL_TICKS) {
      p.recoilCool = 0;
      p.recoil--;
    }
  }

  if (!p.alive) {
    p.shootHeld = input.shoot;
    return -1;
  }

  const ammo = p.ammo[p.active] ?? 0;
  const reserve = p.reserve[p.active] ?? 0;
  const ready = p.fireCd === 0 && p.drawCd === 0 && !p.reloading;

  // Recargar: apretando R, o al apretar el gatillo con el cargador vacío.
  const wantsReload = input.reload || (input.shoot && ammo === 0 && w.mag > 0);
  if (wantsReload && ready && w.mag > 0 && ammo < w.mag && reserve > 0) {
    p.reloading = true;
    p.reloadCd = w.reloadTicks;
    p.scoped = false;
    p.shootHeld = input.shoot;
    return -1;
  }

  let fired = -1;
  const trigger = input.shoot && (w.auto || !p.shootHeld);
  if (canAct && trigger && ready && (w.mag === 0 || ammo > 0)) {
    if (w.mag > 0) p.ammo[p.active] = ammo - 1;
    p.fireCd = w.fireTicks;
    p.recoil++;
    p.recoilCool = 0;
    fired = wid;
  }
  p.shootHeld = input.shoot;
  return fired;
}

/** Hasta dónde llega un tiro de esta arma: el alcance del cuchillo, o el máximo. */
export function shotRange(w: WeaponDef): number {
  return w.melee > 0 ? w.melee : MAX_RANGE;
}

/** Dispersión (radianes) del próximo tiro, con el retroceso de los anteriores. */
export function spreadOf(p: PlayerState, w: WeaponDef, recoilBefore: number): number {
  if (w.melee > 0) return 0;
  if (p.scoped) return SCOPED_SPREAD + w.spreadShot * recoilBefore * 0.25;
  let s = w.spread;
  if (p.crouch >= CROUCH_TICKS) s *= 0.6;
  s += w.spreadShot * recoilBefore;
  const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  s += w.spreadMove * Math.min(1, speed / Math.max(0.1, w.speed));
  if (!p.onGround) s += AIR_SPREAD;
  return s;
}

/**
 * El patrón de retroceso: a dónde se va el tiro número `n` del cargador
 * seguido (0 el primero), en radianes respecto de la mira. Sube rápido los
 * primeros tiros y después zigzaguea a los costados. Es fijo por arma: el que
 * lo aprende lo compensa tirando el mouse hacia abajo y en contra.
 */
export function recoilOffset(w: WeaponDef, n: number): { x: number; y: number } {
  if (n <= 0 || w.recoilUp === 0) return { x: 0, y: 0 };
  // Sube con una curva que se aplana a los ~8 tiros.
  const climb = 1 - Math.exp(-n / 4);
  const y = w.recoilUp * climb;
  // El zigzag arranca a partir del tercero y va para un lado y para el otro.
  const side = n < 3 ? 0 : Math.sin((n - 2) * 0.8) * Math.min(1, (n - 2) / 4);
  return { x: w.recoilSide * side, y };
}

/**
 * Hacia dónde sale cada perdigón de un tiro. Determinista a partir de quién
 * dispara, el seq del input y el número de perdigón: el cliente y el servidor
 * sacan lo mismo sin compartir ningún generador.
 */
export function shotDirections(p: PlayerState, wid: number, seq: number): Vec3[] {
  const w = weapon(wid);
  const fwd = viewDir(p.yaw, p.pitch, { x: 0, y: 0, z: 0 });
  // Derecha y arriba de la cámara (arriba = derecha x adelante).
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const ux = -rz * fwd.y;
  const uy = rz * fwd.x - rx * fwd.z;
  const uz = rx * fwd.y;
  const n = Math.max(0, p.recoil - 1);
  const spread = spreadOf(p, w, n);
  const recoil = p.scoped ? { x: 0, y: 0 } : recoilOffset(w, n);
  const out: Vec3[] = [];
  for (let i = 0; i < w.pellets; i++) {
    const u = hashUnit(p.id, seq, i * 2 + 1);
    const v = hashUnit(p.id, seq, i * 2 + 2);
    const r = spread * Math.sqrt(u);
    const a = v * Math.PI * 2;
    const ox = Math.cos(a) * r + recoil.x;
    const oy = Math.sin(a) * r + recoil.y;
    let dx = fwd.x + rx * ox + ux * oy;
    let dy = fwd.y + uy * oy;
    let dz = fwd.z + rz * ox + uz * oy;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= len;
    dy /= len;
    dz /= len;
    out.push({ x: dx, y: dy, z: dz });
  }
  return out;
}

// ------------------------------------------------------------ compensación de lag

function trailSlot(tick: number): number {
  return (((tick % TRAIL_LENGTH) + TRAIL_LENGTH) % TRAIL_LENGTH) * 3;
}

export function recordTrail(p: PlayerState, tick: number): void {
  const i = trailSlot(tick);
  p.trail[i] = p.x;
  p.trail[i + 1] = p.y;
  p.trail[i + 2] = p.z;
}

export function resetTrail(p: PlayerState): void {
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    p.trail[i * 3] = p.x;
    p.trail[i * 3 + 1] = p.y;
    p.trail[i * 3 + 2] = p.z;
  }
}

/** Dónde estaba `p` hace `rewind` ticks (con fracción), interpolando. */
export function pastPosition(p: PlayerState, tick: number, rewind: number, out: Vec3): Vec3 {
  if (rewind <= 0) {
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    return out;
  }
  const t = tick - rewind;
  const t0 = Math.floor(t);
  const f = t - t0;
  const a = trailSlot(t0);
  const b = trailSlot(t0 + 1);
  out.x = lerp(p.trail[a]!, p.trail[b]!, f);
  out.y = lerp(p.trail[a + 1]!, p.trail[b + 1]!, f);
  out.z = lerp(p.trail[a + 2]!, p.trail[b + 2]!, f);
  return out;
}

/** Cuánto rebobinar para un tiro, según el tick que el que disparó tenía en pantalla. */
export function shotRewind(tick: number, view: number): number {
  if (view < 0) return 0;
  const r = tick - view;
  return r < 0 ? 0 : r > LAG_COMP_MAX_TICKS ? LAG_COMP_MAX_TICKS : r;
}

// ------------------------------------------------------------ el tiro

/** Daño que llega al cuerpo después del chaleco, descontando el chaleco. */
export function applyArmor(p: PlayerState, dmg: number, zone: number, pen: number): number {
  if (p.armor <= 0) return dmg;
  if (zone === ZONE_LEGS) return dmg;
  if (zone === ZONE_HEAD && !p.helmet) return dmg;
  const ratio = pen * 0.5;
  let after = dmg * ratio;
  let loss = (dmg - after) * 0.5;
  if (loss > p.armor) {
    after = dmg - p.armor * 2;
    loss = p.armor;
  }
  p.armor = Math.max(0, Math.round(p.armor - loss));
  if (p.armor === 0) p.helmet = false;
  return after;
}

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Resuelve un tiro en el servidor: cada perdigón contra el mapa y contra los
 * rivales tal como los veía el que disparó (rebobinados `rewind` ticks).
 * Agrega el evento `shot` (con dónde terminó cada perdigón) y los `hit`/`kill`.
 */
export function resolveShot(
  state: GameState,
  shooter: PlayerState,
  wid: number,
  seq: number,
  rewind: number,
  map: GameMap,
  events: SimEvent[],
): void {
  const w = weapon(wid);
  const dirs = shotDirections(shooter, wid, seq);
  const ox = shooter.x;
  const oy = shooter.y + eyeHeightOf(shooter);
  const oz = shooter.z;
  const maxRange = shotRange(w);
  const hits: number[] = [];

  for (const d of dirs) {
    let best = raycastBoxes(ox, oy, oz, d.x, d.y, d.z, map.boxes, maxRange);
    let kind = best >= 0 ? HIT_WORLD : HIT_NONE;
    if (best < 0) best = maxRange;
    let target: PlayerState | null = null;
    let zone = ZONE_BODY;

    for (const q of state.players) {
      if (q === shooter || !q.alive || !q.connected || q.team === shooter.team) continue;
      pastPosition(q, state.tick, rewind, scratch);
      const h = heightOf(q);
      const t = rayAabb(ox, oy, oz, d.x, d.y, d.z, scratch.x, scratch.y + h / 2, scratch.z, PLAYER_HALF_W, h / 2, PLAYER_HALF_W, best);
      if (t < 0 || t >= best) continue;
      best = t;
      target = q;
      const hitY = oy + d.y * t;
      const rel = hitY - scratch.y;
      zone = rel > h - HEAD_HEIGHT ? ZONE_HEAD : rel < LEG_HEIGHT ? ZONE_LEGS : ZONE_BODY;
      kind = zone === ZONE_HEAD ? HIT_HEAD : HIT_BODY;
    }

    const ex = ox + d.x * best;
    const ey = oy + d.y * best;
    const ez = oz + d.z * best;
    hits.push(Math.round(ex * 100) / 100, Math.round(ey * 100) / 100, Math.round(ez * 100) / 100, kind);

    if (target) {
      let dmg = w.damage * ZONE_MULT[zone]! * Math.pow(w.range, best / 10);
      dmg = applyArmor(target, dmg, zone, w.pen);
      dmg = Math.max(1, Math.round(dmg));
      damagePlayer(state, target, shooter, dmg, zone, wid, ex, ey, ez, map, events);
    }
  }

  events.push({ t: "shot", byId: shooter.id, seq, weapon: wid, x: Math.round(ox * 100) / 100, y: Math.round(oy * 100) / 100, z: Math.round(oz * 100) / 100, hits });
}

export function damagePlayer(
  state: GameState,
  target: PlayerState,
  by: PlayerState,
  dmg: number,
  zone: number,
  wid: number,
  x: number,
  y: number,
  z: number,
  map: GameMap,
  events: SimEvent[],
): void {
  const applied = Math.min(dmg, target.hp);
  target.hp -= applied;
  by.damage += applied;
  events.push({ t: "hit", targetId: target.id, byId: by.id, amount: applied, zone, x, y, z });
  if (target.hp > 0) return;

  target.hp = 0;
  target.alive = false;
  target.diedAtTick = state.tick;
  target.killerId = by.id;
  target.deaths++;
  target.scoped = false;
  by.kills++;
  by.money = Math.min(MAX_MONEY, by.money + (wid === KNIFE ? KNIFE_KILL_REWARD : KILL_REWARD));
  // Las armas quedan en el piso: el rival (o el compañero) las puede levantar.
  for (let s = 0; s < 2; s++) {
    if ((target.slots[s] ?? -1) >= 0) dropWeaponAt(state, target, s, map, s === 0 ? 0.4 : -0.4);
  }
  events.push({ t: "kill", targetId: target.id, byId: by.id, weapon: wid, headshot: zone === ZONE_HEAD });
}
