import type { Box } from "./types.js";

export interface RayHit {
  /** Distancia a lo largo del rayo. */
  t: number;
  /** Distancia a la que el rayo sale de la caja (para saber cuánto grosor atraviesa). */
  exit: number;
  /** Normal de la cara que se pegó (-1, 0 o 1 en un solo eje). */
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Rayo contra una caja (método de los planos). Devuelve la distancia de
 * entrada o -1 si no la toca dentro de [0, maxT]. Un origen adentro de la caja
 * cuenta como impacto a distancia 0.
 */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: Box, maxT: number, out?: RayHit,
): number {
  let tmin = 0;
  let tmax = maxT;
  let axis = -1;
  let sign = 0;

  // X
  if (dx !== 0) {
    const inv = 1 / dx;
    let t1 = (b.minX - ox) * inv;
    let t2 = (b.maxX - ox) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  } else if (ox < b.minX || ox > b.maxX) return -1;
  // Y
  if (dy !== 0) {
    const inv = 1 / dy;
    let t1 = (b.minY - oy) * inv;
    let t2 = (b.maxY - oy) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  } else if (oy < b.minY || oy > b.maxY) return -1;
  // Z
  if (dz !== 0) {
    const inv = 1 / dz;
    let t1 = (b.minZ - oz) * inv;
    let t2 = (b.maxZ - oz) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  } else if (oz < b.minZ || oz > b.maxZ) return -1;

  if (out) {
    out.t = tmin;
    out.exit = tmax;
    out.nx = axis === 0 ? sign : 0;
    out.ny = axis === 1 ? sign : 0;
    out.nz = axis === 2 ? sign : 0;
  }
  return tmin;
}

/** La caja más cercana que toca el rayo, o -1. `dir` tiene que estar normalizado. */
export function raycastBoxes(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  boxes: readonly Box[], maxT: number, out?: RayHit,
): number {
  let best = -1;
  const scratch: RayHit = { t: 0, exit: 0, nx: 0, ny: 0, nz: 0 };
  for (const b of boxes) {
    if (b.decal) continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, b, best < 0 ? maxT : best, scratch);
    if (t >= 0 && (best < 0 || t < best)) {
      best = t;
      if (out) {
        out.t = scratch.t;
        out.exit = scratch.exit;
        out.nx = scratch.nx;
        out.ny = scratch.ny;
        out.nz = scratch.nz;
      }
    }
  }
  return best;
}

/** ¿Se ve de un punto a otro sin ninguna caja en el medio? */
export function segmentClear(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  boxes: readonly Box[],
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  // Un poco menos que el largo, para que el punto de llegada apoyado contra una
  // pared no cuente como tapado por esa misma pared.
  return raycastBoxes(ax, ay, az, dx / len, dy / len, dz / len, boxes, len - 0.01) < 0;
}

/**
 * ¿Un rayo toca este prisma (centro, mitades)? Para las cajas de impacto de
 * los jugadores, que no son `Box` del mapa.
 */
export function rayAabb(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  maxT: number,
): number {
  return rayBox(ox, oy, oz, dx, dy, dz, { minX: cx - hx, minY: cy - hy, minZ: cz - hz, maxX: cx + hx, maxY: cy + hy, maxZ: cz + hz, tex: 0 }, maxT);
}
