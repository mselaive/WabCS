import { MODE_ARMS, MODE_AWP, BUY_RADIUS, BUY_TICKS, DROP_TICKS, GRENADE_MAX, PICKUP_RANGE, ROUND_TICKS, TEAM_CT } from "../constants.js";
import { distXZ } from "../math.js";
import type { GameMap } from "../map/types.js";
import { BUY_ITEMS, KNIFE, SLOT_GRENADE, SLOT_KNIFE, weapon } from "../weapons.js";
import type { DropState, GameState, PlayerState, SimEvent } from "./types.js";

/** Más que esto tirado en el piso y se borra lo más viejo. */
const MAX_DROPS = 24;

/** ¿Se puede comprar ahora, desde donde está? */
export function canBuy(state: GameState, p: PlayerState, map: GameMap): boolean {
  if (state.phase !== "playing" || !p.alive) return false;
  // Sólo AWP y carrera de armas reparten las armas: no hay tienda.
  if (state.mode === MODE_AWP || state.mode === MODE_ARMS) return false;
  const r = state.round;
  if (r.phase === "over") return false;
  if (r.phase === "live" && ROUND_TICKS - r.ticksLeft > BUY_TICKS) return false;
  const c = map.buyCenter[p.team as 0 | 1];
  return distXZ(p.x, p.z, c.x, c.z) <= BUY_RADIUS;
}

/** Ticks que quedan de tiempo de compra, o 0. */
export function buyTicksLeft(state: GameState): number {
  const r = state.round;
  if (state.phase !== "playing" || r.phase === "over") return 0;
  if (r.phase === "freeze") return r.ticksLeft + BUY_TICKS;
  return Math.max(0, BUY_TICKS - (ROUND_TICKS - r.ticksLeft));
}

/** Compra un ítem de BUY_ITEMS si se puede. Devuelve si compró. */
export function tryBuy(state: GameState, p: PlayerState, index: number, map: GameMap, events: SimEvent[]): boolean {
  const item = BUY_ITEMS[index];
  if (!item) return false;
  if (!canBuy(state, p, map)) return false;
  if (item.team !== -1 && item.team !== p.team) return false;

  if (item.armor) {
    let price = item.price;
    if (item.armor === "kevlar") {
      if (p.armor >= 100) return false;
    } else {
      if (p.armor >= 100 && p.helmet) return false;
      // Con el chaleco entero, el casco solo sale la diferencia.
      if (p.armor >= 100) price = 350;
    }
    if (p.money < price) return false;
    p.money -= price;
    p.armor = 100;
    if (item.armor === "helmet") p.helmet = true;
    events.push({ t: "buy", byId: p.id, item: index });
    return true;
  }

  if (item.kit) {
    if (p.team !== TEAM_CT || p.kit || p.money < item.price) return false;
    p.money -= item.price;
    p.kit = true;
    events.push({ t: "buy", byId: p.id, item: index });
    return true;
  }

  if (item.grenade !== undefined) {
    const kind = item.grenade;
    if ((p.grenades[kind] ?? 0) >= (GRENADE_MAX[kind] ?? 1)) return false;
    if (p.money < item.price) return false;
    p.money -= item.price;
    p.grenades[kind] = (p.grenades[kind] ?? 0) + 1;
    events.push({ t: "buy", byId: p.id, item: index });
    return true;
  }

  const w = weapon(item.weapon);
  if (p.money < item.price) return false;
  // La misma arma otra vez no tiene sentido.
  if (p.slots[w.slot] === w.id) return false;
  p.money -= item.price;
  if ((p.slots[w.slot] ?? -1) >= 0) dropWeaponAt(state, p, w.slot, map, 0.5);
  p.slots[w.slot] = w.id;
  p.ammo[w.slot] = w.mag;
  p.reserve[w.slot] = w.reserve;
  switchSlotAfterChange(p, w.slot);
  events.push({ t: "buy", byId: p.id, item: index });
  return true;
}

function switchSlotAfterChange(p: PlayerState, slot: number): void {
  p.active = slot;
  p.drawCd = weapon(p.slots[slot] ?? KNIFE).drawTicks;
  p.reloadCd = 0;
  p.reloading = false;
  p.scoped = false;
  p.recoil = 0;
}

/** Tira al piso lo que hay en la ranura, delante del jugador (o a un costado). */
export function dropWeaponAt(state: GameState, p: PlayerState, slot: number, map: GameMap, sideOffset: number): DropState | null {
  const wid = p.slots[slot] ?? -1;
  if (wid < 0 || slot === SLOT_KNIFE) return null;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  // Si delante hay una pared, que caiga a los pies.
  let x = p.x + fx * 0.6 + rx * sideOffset;
  let z = p.z + fz * 0.6 + rz * sideOffset;
  for (const b of map.boxes) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && p.y + 0.1 < b.maxY && p.y + 0.5 > b.minY) {
      x = p.x;
      z = p.z;
      break;
    }
  }
  const drop: DropState = {
    id: state.nextDropId++,
    weapon: wid,
    ammo: p.ammo[slot] ?? 0,
    reserve: p.reserve[slot] ?? 0,
    x,
    y: p.y,
    z,
    yaw: p.yaw,
    ticksLeft: DROP_TICKS,
  };
  state.drops.push(drop);
  while (state.drops.length > MAX_DROPS) state.drops.shift();
  p.slots[slot] = -1;
  p.ammo[slot] = 0;
  p.reserve[slot] = 0;
  return drop;
}

/** Tira el arma que tiene en la mano (no el cuchillo). */
export function dropActive(state: GameState, p: PlayerState, map: GameMap, events: SimEvent[]): boolean {
  if (!p.alive || p.active === SLOT_KNIFE || p.active === SLOT_GRENADE) return false;
  const wid = p.slots[p.active] ?? -1;
  if (wid < 0) return false;
  dropWeaponAt(state, p, p.active, map, 0);
  events.push({ t: "drop", byId: p.id, weapon: wid });
  // Pasa a lo que tenga: la otra arma o el cuchillo.
  let next = SLOT_KNIFE;
  for (let s = 0; s < 2; s++) if ((p.slots[s] ?? -1) >= 0) { next = s; break; }
  switchSlotAfterChange(p, next);
  return true;
}

/** Levanta el arma más cercana que tenga a mano. */
export function tryPickup(state: GameState, p: PlayerState, map: GameMap, events: SimEvent[]): boolean {
  if (!p.alive) return false;
  let best: DropState | null = null;
  let bestD = PICKUP_RANGE;
  for (const d of state.drops) {
    const dist = Math.sqrt((d.x - p.x) ** 2 + (d.y - p.y) ** 2 + (d.z - p.z) ** 2);
    if (dist <= bestD) {
      bestD = dist;
      best = d;
    }
  }
  if (!best) return false;
  const w = weapon(best.weapon);
  const idx = state.drops.indexOf(best);
  state.drops.splice(idx, 1);
  if ((p.slots[w.slot] ?? -1) >= 0) {
    const dropped = dropWeaponAt(state, p, w.slot, map, 0);
    // Lo que se suelta queda donde estaba lo que se levantó: se intercambian.
    if (dropped) {
      dropped.x = best.x;
      dropped.y = best.y;
      dropped.z = best.z;
    }
  }
  p.slots[w.slot] = w.id;
  p.ammo[w.slot] = best.ammo;
  p.reserve[w.slot] = best.reserve;
  switchSlotAfterChange(p, w.slot);
  events.push({ t: "pickup", byId: p.id, weapon: w.id });
  return true;
}

/** El arma del piso que se levantaría con E, o null. Para el cartel del HUD. */
export function nearestDrop(state: GameState, p: { x: number; y: number; z: number }): DropState | null {
  let best: DropState | null = null;
  let bestD = PICKUP_RANGE;
  for (const d of state.drops) {
    const dist = Math.sqrt((d.x - p.x) ** 2 + (d.y - p.y) ** 2 + (d.z - p.z) ** 2);
    if (dist <= bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}
