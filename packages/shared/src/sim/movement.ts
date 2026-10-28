import {
  AIR_ACCEL,
  CROUCH_FACTOR,
  CROUCH_TICKS,
  DT,
  EYE_CROUCH,
  EYE_STAND,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_SPEED,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HALF_W,
  PLAYER_HEIGHT,
  STEP_HEIGHT,
  WALK_FACTOR,
} from "../constants.js";
import { clamp, forwardXZ, lerp, rightXZ } from "../math.js";
import type { Box, GameMap } from "../map/types.js";
import { weapon } from "../weapons.js";
import type { PlayerInput, PlayerState } from "./types.js";

/** Un pelito de aire entre el muñeco y la pared, para que el redondeo no lo deje adentro. */
const SKIN = 0.001;
/** Más abajo que esto es que se cayó del mundo: se lo vuelve a poner arriba. */
const FALL_LIMIT = -20;

export function heightOf(p: { crouch: number }): number {
  return lerp(PLAYER_HEIGHT, PLAYER_CROUCH_HEIGHT, p.crouch / CROUCH_TICKS);
}

export function eyeHeightOf(p: { crouch: number }): number {
  return lerp(EYE_STAND, EYE_CROUCH, p.crouch / CROUCH_TICKS);
}

/** Velocidad máxima en el piso con lo que lleva en la mano y la postura. */
export function maxSpeedOf(p: PlayerState, input: PlayerInput): number {
  let v = weapon(p.slots[p.active] ?? 0).speed;
  if (p.crouch > 0) v *= CROUCH_FACTOR;
  else if (input.walk) v *= WALK_FACTOR;
  if (p.scoped) v *= 0.6;
  return v;
}

function overlapsAny(x: number, y: number, z: number, height: number, boxes: readonly Box[]): Box | null {
  const minX = x - PLAYER_HALF_W;
  const maxX = x + PLAYER_HALF_W;
  const minZ = z - PLAYER_HALF_W;
  const maxZ = z + PLAYER_HALF_W;
  const maxY = y + height;
  for (const b of boxes) {
    if (b.decal) continue;
    if (minX < b.maxX && maxX > b.minX && y < b.maxY && maxY > b.minY && minZ < b.maxZ && maxZ > b.minZ) return b;
  }
  return null;
}

/** Mueve en X y Z, de a un eje, frenando contra lo que toque. Devuelve si algo lo frenó. */
function moveXZ(p: PlayerState, dx: number, dz: number, height: number, boxes: readonly Box[]): boolean {
  let blocked = false;
  if (dx !== 0) {
    p.x += dx;
    const b = overlapsAny(p.x, p.y, p.z, height, boxes);
    if (b) {
      p.x = dx > 0 ? b.minX - PLAYER_HALF_W - SKIN : b.maxX + PLAYER_HALF_W + SKIN;
      p.vx = 0;
      blocked = true;
    }
  }
  if (dz !== 0) {
    p.z += dz;
    const b = overlapsAny(p.x, p.y, p.z, height, boxes);
    if (b) {
      p.z = dz > 0 ? b.minZ - PLAYER_HALF_W - SKIN : b.maxZ + PLAYER_HALF_W + SKIN;
      p.vz = 0;
      blocked = true;
    }
  }
  return blocked;
}

/** Mueve en Y. Devuelve 1 si apoyó en algo, -1 si pegó con la cabeza, 0 si nada. */
function moveY(p: PlayerState, dy: number, height: number, boxes: readonly Box[]): number {
  if (dy === 0) return 0;
  p.y += dy;
  const b = overlapsAny(p.x, p.y, p.z, height, boxes);
  if (!b) return 0;
  if (dy < 0) {
    p.y = b.maxY + SKIN;
    p.vy = 0;
    return 1;
  }
  p.y = b.minY - height - SKIN;
  p.vy = 0;
  return -1;
}

/**
 * Un tick de movimiento de un jugador. Corre igual en el cliente (predicción)
 * y en el servidor: por eso no toca nada que el cliente no sepa.
 *
 * `canMove` es falso en el tiempo de compra: se mira pero no se camina.
 */
export function stepPlayerMovement(p: PlayerState, input: PlayerInput, map: GameMap, canMove: boolean): void {
  p.yaw = input.yaw;
  p.pitch = clamp(input.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  if (!p.alive) return;

  const boxes = map.boxes;

  // Agacharse: la altura baja de a poco. Para levantarse hace falta lugar.
  if (input.crouch) {
    if (p.crouch < CROUCH_TICKS) p.crouch++;
  } else if (p.crouch > 0) {
    const taller = heightOf({ crouch: p.crouch - 1 });
    if (!overlapsAny(p.x, p.y, p.z, taller, boxes)) p.crouch--;
  }
  const height = heightOf(p);

  const maxSpeed = maxSpeedOf(p, input);
  let wishX = 0;
  let wishZ = 0;
  if (canMove && (input.fwd !== 0 || input.side !== 0)) {
    const f = forwardXZ(p.yaw);
    const r = rightXZ(p.yaw);
    wishX = f.x * input.fwd + r.x * input.side;
    wishZ = f.z * input.fwd + r.z * input.side;
    const len = Math.sqrt(wishX * wishX + wishZ * wishZ);
    wishX /= len;
    wishZ /= len;
  }
  const wishSpeed = wishX !== 0 || wishZ !== 0 ? maxSpeed : 0;

  if (p.onGround) {
    // Fricción, y después aceleración hacia donde se quiere ir.
    const k = Math.max(0, 1 - GROUND_FRICTION * DT);
    p.vx *= k;
    p.vz *= k;
    if (wishSpeed > 0) {
      const current = p.vx * wishX + p.vz * wishZ;
      const add = wishSpeed - current;
      if (add > 0) {
        const accel = Math.min(GROUND_ACCEL * DT * wishSpeed, add);
        p.vx += wishX * accel;
        p.vz += wishZ * accel;
      }
    }
    if (canMove && input.jump) {
      p.vy = JUMP_SPEED;
      p.onGround = false;
    }
  } else if (wishSpeed > 0) {
    // En el aire casi no se corrige.
    const current = p.vx * wishX + p.vz * wishZ;
    const add = wishSpeed - current;
    if (add > 0) {
      const accel = Math.min(AIR_ACCEL * DT * wishSpeed, add);
      p.vx += wishX * accel;
      p.vz += wishZ * accel;
    }
  }

  // Quieto en el piso con un resto de velocidad: que no se deslice eternamente.
  if (p.onGround && wishSpeed === 0 && p.vx * p.vx + p.vz * p.vz < 0.01) {
    p.vx = 0;
    p.vz = 0;
  }

  p.vy -= GRAVITY * DT;

  // Horizontal, con escalón: si algo lo frena y está en el piso, prueba desde
  // STEP_HEIGHT más arriba y vuelve a bajar. Así se suben cajones bajos.
  const dx = p.vx * DT;
  const dz = p.vz * DT;
  const startX = p.x;
  const startY = p.y;
  const startZ = p.z;
  const savedVx = p.vx;
  const savedVz = p.vz;
  const blocked = moveXZ(p, dx, dz, height, boxes);
  if (blocked && p.onGround) {
    const flatX = p.x;
    const flatZ = p.z;
    const flatVx = p.vx;
    const flatVz = p.vz;
    p.x = startX;
    p.z = startZ;
    p.vx = savedVx;
    p.vz = savedVz;
    p.y = startY + STEP_HEIGHT;
    let ok = !overlapsAny(p.x, p.y, p.z, height, boxes);
    if (ok) {
      moveXZ(p, dx, dz, height, boxes);
      const landed = moveY(p, -STEP_HEIGHT, height, boxes);
      // Tiene que haber apoyado en algo más alto que donde estaba: si no, no
      // era un escalón, era una pared.
      ok = landed === 1 && p.y > startY + 0.01;
    }
    const flatDist = (flatX - startX) ** 2 + (flatZ - startZ) ** 2;
    const stepDist = (p.x - startX) ** 2 + (p.z - startZ) ** 2;
    if (!ok || stepDist <= flatDist) {
      p.x = flatX;
      p.z = flatZ;
      p.y = startY;
      p.vx = flatVx;
      p.vz = flatVz;
    }
  }

  // Vertical.
  p.onGround = false;
  const landed = moveY(p, p.vy * DT, height, boxes);
  if (landed === 1) p.onGround = true;

  if (p.y < FALL_LIMIT) {
    // Se cayó del mundo (no debería pasar): al centro del mapa, arriba.
    p.x = 0;
    p.y = 2;
    p.z = 0;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
  }
}

/** Un lugar sin nada encima donde apoyar a alguien (para aparecer). */
export function standsFree(x: number, y: number, z: number, map: GameMap): boolean {
  return !overlapsAny(x, y + SKIN, z, PLAYER_HEIGHT, map.boxes);
}
