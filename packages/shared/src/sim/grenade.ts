import {
  DT,
  FLASH_BACK_TICKS,
  FLASH_FULL_TICKS,
  FLASH_RANGE,
  FLASH_SIDE_TICKS,
  GRAVITY,
  GRENADE_BOUNCE,
  GRENADE_FUSE_TICKS,
  GRENADE_RADIUS,
  GRENADE_THROW_SPEED,
  HE_DAMAGE,
  HE_RADIUS,
  SMOKE_FUSE_TICKS,
  SMOKE_RADIUS,
  SMOKE_TICKS,
  ZONE_BODY,
} from "../constants.js";
import { viewDir } from "../math.js";
import { segmentClear } from "../map/raycast.js";
import type { Box, GameMap } from "../map/types.js";
import { HE_GRENADE } from "../weapons.js";
import { applyArmor, damagePlayer } from "./combat.js";
import { eyeHeightOf, heightOf } from "./movement.js";
import type { GameState, GrenadeState, PlayerState, SimEvent, SmokeState } from "./types.js";

export const GRENADE_HE = 0;
export const GRENADE_FLASH = 1;
export const GRENADE_SMOKE = 2;

/**
 * Sale de la mano: desde los ojos, hacia donde mira, con un poco hacia arriba
 * y la velocidad del que la tira sumada. Determinista: el cliente la puede
 * predecir igual que una bala.
 */
export function throwGrenade(state: GameState, p: PlayerState, kind: number, events: SimEvent[], seq: number): GrenadeState {
  const dir = viewDir(p.yaw, p.pitch + 0.12, { x: 0, y: 0, z: 0 });
  const g: GrenadeState = {
    id: state.nextGrenadeId++,
    kind,
    ownerId: p.id,
    team: p.team,
    x: p.x + dir.x * 0.4,
    y: p.y + eyeHeightOf(p) - 0.1 + dir.y * 0.4,
    z: p.z + dir.z * 0.4,
    vx: dir.x * GRENADE_THROW_SPEED + p.vx * 0.5,
    vy: dir.y * GRENADE_THROW_SPEED + p.vy * 0.3,
    vz: dir.z * GRENADE_THROW_SPEED + p.vz * 0.5,
    ticksLeft: kind === GRENADE_SMOKE ? SMOKE_FUSE_TICKS : GRENADE_FUSE_TICKS,
  };
  state.grenades.push(g);
  events.push({ t: "throw", byId: p.id, seq, kind, id: g.id });
  return g;
}

function overlaps(b: Box, x: number, y: number, z: number, r: number): boolean {
  return x + r > b.minX && x - r < b.maxX && y + r > b.minY && y - r < b.maxY && z + r > b.minZ && z - r < b.maxZ;
}

/**
 * Un paso de la física de una granada: gravedad, y contra cada caja rebota
 * por el eje que la metió adentro (de a un eje, como el jugador). En el piso
 * va perdiendo velocidad hasta quedarse quieta.
 */
export function advanceGrenade(g: GrenadeState, boxes: readonly Box[]): void {
  g.vy -= GRAVITY * DT;
  const r = GRENADE_RADIUS;
  let onGround = false;

  g.x += g.vx * DT;
  for (const b of boxes) {
    if (b.decal || !overlaps(b, g.x, g.y, g.z, r)) continue;
    g.x = g.vx > 0 ? b.minX - r : b.maxX + r;
    g.vx = -g.vx * GRENADE_BOUNCE;
  }
  g.z += g.vz * DT;
  for (const b of boxes) {
    if (b.decal || !overlaps(b, g.x, g.y, g.z, r)) continue;
    g.z = g.vz > 0 ? b.minZ - r : b.maxZ + r;
    g.vz = -g.vz * GRENADE_BOUNCE;
  }
  g.y += g.vy * DT;
  for (const b of boxes) {
    if (b.decal || !overlaps(b, g.x, g.y, g.z, r)) continue;
    if (g.vy <= 0) {
      g.y = b.maxY + r;
      // Rebote chico contra el piso, y después se queda.
      g.vy = Math.abs(g.vy) > 2 ? -g.vy * GRENADE_BOUNCE : 0;
      onGround = true;
    } else {
      g.y = b.minY - r;
      g.vy = -g.vy * GRENADE_BOUNCE;
    }
  }
  if (onGround) {
    g.vx *= 0.8;
    g.vz *= 0.8;
    if (Math.abs(g.vx) < 0.05) g.vx = 0;
    if (Math.abs(g.vz) < 0.05) g.vz = 0;
  }
  if (g.y < -5) {
    g.y = 0.1;
    g.vy = 0;
  }
}

/** ¿Algún humo tapa el segmento? Distancia del centro al segmento menor que el radio. */
export function smokeBlocks(smokes: readonly SmokeState[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  for (const s of smokes) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 > 0 ? ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - s.x;
    const py = ay + dy * t - s.y;
    const pz = az + dz * t - s.z;
    if (px * px + py * py + pz * pz < SMOKE_RADIUS * SMOKE_RADIUS) return true;
  }
  return false;
}

/** Un tick de todas las granadas y humos; las que estallan hacen lo suyo. */
export function stepGrenades(state: GameState, map: GameMap, events: SimEvent[]): void {
  // Los humos primero: el que nace en este tick dura SMOKE_TICKS enteros.
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (--state.smokes[i]!.ticksLeft <= 0) state.smokes.splice(i, 1);
  }
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i]!;
    advanceGrenade(g, map.boxes);
    if (--g.ticksLeft > 0) continue;
    state.grenades.splice(i, 1);
    events.push({ t: "explode", id: g.id, kind: g.kind, x: Math.round(g.x * 100) / 100, y: Math.round(g.y * 100) / 100, z: Math.round(g.z * 100) / 100 });
    if (g.kind === GRENADE_HE) explodeHE(state, g, map, events);
    else if (g.kind === GRENADE_FLASH) flashAt(state, g, map);
    else state.smokes.push({ id: g.id, x: g.x, y: g.y, z: g.z, ticksLeft: SMOKE_TICKS });
  }
  for (const p of state.players) if (p.blindTicks > 0) p.blindTicks--;
}

/** La HE: daño que cae con la distancia, al que esté a la vista desde donde estalló (también el que la tiró). */
function explodeHE(state: GameState, g: GrenadeState, map: GameMap, events: SimEvent[]): void {
  const owner = state.players.find((p) => p.id === g.ownerId);
  for (const q of state.players) {
    if (!q.alive || !q.connected) continue;
    // A los compañeros no (al que la tiró, sí).
    if (q.team === g.team && q.id !== g.ownerId) continue;
    const h = heightOf(q);
    const cx = q.x;
    const cy = q.y + h * 0.5;
    const cz = q.z;
    const dist = Math.hypot(cx - g.x, cy - g.y, cz - g.z);
    if (dist > HE_RADIUS) continue;
    if (!segmentClear(g.x, g.y, g.z, cx, cy, cz, map.boxes) && !segmentClear(g.x, g.y, g.z, q.x, q.y + 0.3, q.z, map.boxes)) continue;
    let dmg = HE_DAMAGE * (1 - dist / HE_RADIUS);
    dmg = applyArmor(q, dmg, ZONE_BODY, 0.5);
    dmg = Math.max(1, Math.round(dmg));
    damagePlayer(state, q, owner ?? q, dmg, ZONE_BODY, HE_GRENADE, cx, cy, cz, map, events);
  }
}

/** La flash: ciega al que la ve, más cuanto más de frente y más cerca. */
function flashAt(state: GameState, g: GrenadeState, map: GameMap): void {
  for (const q of state.players) {
    if (!q.alive || !q.connected) continue;
    const ex = q.x;
    const ey = q.y + eyeHeightOf(q);
    const ez = q.z;
    const dx = g.x - ex;
    const dy = g.y - ey;
    const dz = g.z - ez;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > FLASH_RANGE || dist < 1e-3) continue;
    if (!segmentClear(ex, ey, ez, g.x, g.y, g.z, map.boxes)) continue;
    const look = viewDir(q.yaw, q.pitch, { x: 0, y: 0, z: 0 });
    const cos = (look.x * dx + look.y * dy + look.z * dz) / dist;
    let ticks = cos > 0.5 ? FLASH_FULL_TICKS : cos > -0.2 ? FLASH_SIDE_TICKS : FLASH_BACK_TICKS;
    // Lejos ciega menos.
    ticks *= 1 - (dist / FLASH_RANGE) * 0.6;
    q.blindTicks = Math.max(q.blindTicks, Math.round(ticks));
  }
}
