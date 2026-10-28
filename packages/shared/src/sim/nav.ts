import { PLAYER_HALF_W, PLAYER_HEIGHT, STEP_HEIGHT } from "../constants.js";
import type { Box, GameMap } from "../map/types.js";

/**
 * Una grilla de caminos para los bots: celdas de medio metro, cada una con la
 * altura del piso y si un jugador parado ahí no choca con nada. Se puede pasar
 * de una celda a la vecina si se sube un escalón como mucho (o se baja lo que
 * sea). Los techos altos no entran (los bots no suben al garaje): los puestos
 * de francotirador son para la gente.
 */
export interface NavGrid {
  cell: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** 1 si se puede estar parado en la celda. */
  walk: Uint8Array;
  /** Altura del piso en la celda (NaN si no se puede). */
  floor: Float32Array;
}

/** Más alto que esto no es piso para un bot: es un techo o una plataforma alta. */
const MAX_FLOOR = 1.0;

const cache = new WeakMap<GameMap, NavGrid>();

function floorUnder(boxes: readonly Box[], x: number, z: number): number {
  let best = -Infinity;
  for (const b of boxes) {
    if (b.decal) continue;
    if (x + PLAYER_HALF_W > b.minX && x - PLAYER_HALF_W < b.maxX && z + PLAYER_HALF_W > b.minZ && z - PLAYER_HALF_W < b.maxZ) {
      if (b.maxY <= MAX_FLOOR + 0.01 && b.maxY > best) best = b.maxY;
    }
  }
  return best;
}

function blockedAt(boxes: readonly Box[], x: number, y: number, z: number): boolean {
  const top = y + PLAYER_HEIGHT;
  for (const b of boxes) {
    if (b.decal) continue;
    if (x + PLAYER_HALF_W > b.minX && x - PLAYER_HALF_W < b.maxX && y < b.maxY && top > b.minY && z + PLAYER_HALF_W > b.minZ && z - PLAYER_HALF_W < b.maxZ)
      return true;
  }
  return false;
}

export function buildNavGrid(map: GameMap, cell = 0.5): NavGrid {
  const minX = map.bounds.minX;
  const minZ = map.bounds.minZ;
  const cols = Math.ceil((map.bounds.maxX - minX) / cell);
  const rows = Math.ceil((map.bounds.maxZ - minZ) / cell);
  const walk = new Uint8Array(cols * rows);
  const floor = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * cell;
      const z = minZ + (r + 0.5) * cell;
      const f = floorUnder(map.boxes, x, z);
      const i = r * cols + c;
      if (f === -Infinity || blockedAt(map.boxes, x, f + 0.02, z)) {
        walk[i] = 0;
        floor[i] = NaN;
      } else {
        walk[i] = 1;
        floor[i] = f;
      }
    }
  }
  const grid: NavGrid = { cell, minX, minZ, cols, rows, walk, floor };

  // Sólo lo que se alcanza caminando desde los spawns: la tapa de un barril o
  // de los sacos es "piso" para la cuenta de arriba, pero nadie sube ahí sin
  // saltar, y un bot que elige una isla como destino se queda sin camino.
  const reached = new Uint8Array(cols * rows);
  const queue: number[] = [];
  for (const team of map.spawns) {
    for (const s of team) {
      const [c, r] = cellOf(grid, s.x, s.z);
      const i = r * cols + c;
      if (walk[i] && !reached[i]) {
        reached[i] = 1;
        queue.push(i);
      }
    }
  }
  while (queue.length > 0) {
    const i = queue.pop()!;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!walkable(grid, nc, nr)) continue;
        const ni = nr * cols + nc;
        if (reached[ni]) continue;
        // Entre dos celdas se pasa en los dos sentidos si ninguna sube más que un escalón.
        if (!canStep(grid, i, ni) && !canStep(grid, ni, i)) continue;
        // Si sólo se puede bajar, igual vale: el bot puede bajar de un salto.
        if (!canStep(grid, i, ni)) continue;
        reached[ni] = 1;
        queue.push(ni);
      }
    }
  }
  for (let i = 0; i < cols * rows; i++) {
    if (!reached[i]) {
      walk[i] = 0;
      floor[i] = NaN;
    }
  }
  return grid;
}

export function navGridFor(map: GameMap): NavGrid {
  let g = cache.get(map);
  if (!g) {
    g = buildNavGrid(map);
    cache.set(map, g);
  }
  return g;
}

export function cellOf(g: NavGrid, x: number, z: number): [number, number] {
  return [
    Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.minX) / g.cell))),
    Math.max(0, Math.min(g.rows - 1, Math.floor((z - g.minZ) / g.cell))),
  ];
}

export function cellCenter(g: NavGrid, c: number, r: number): { x: number; z: number } {
  return { x: g.minX + (c + 0.5) * g.cell, z: g.minZ + (r + 0.5) * g.cell };
}

export function walkable(g: NavGrid, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.walk[r * g.cols + c] === 1;
}

/** ¿Se puede pasar de una celda a la vecina? Subir un escalón como mucho; bajar, lo que sea. */
function canStep(g: NavGrid, from: number, to: number): boolean {
  const a = g.floor[from]!;
  const b = g.floor[to]!;
  return b - a <= STEP_HEIGHT + 0.01;
}

/** La celda caminable más cercana a (x, z), buscando en espiral. */
export function nearestWalkable(g: NavGrid, x: number, z: number): [number, number] | null {
  const [c0, r0] = cellOf(g, x, z);
  if (walkable(g, c0, r0)) return [c0, r0];
  for (let radius = 1; radius < 8; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        if (walkable(g, c0 + dc, r0 + dr)) return [c0 + dc, r0 + dr];
      }
    }
  }
  return null;
}

/**
 * A* de (fromX, fromZ) a (toX, toZ). Devuelve los puntos del camino (centros
 * de celda, sin el de partida), simplificado quitando los colineales; null si
 * no hay camino. Ocho vecinos; en diagonal sólo si las dos ortogonales están
 * libres, para no cortar esquinas contra una pared.
 */
export function findPath(g: NavGrid, fromX: number, fromZ: number, toX: number, toZ: number): { x: number; z: number }[] | null {
  const start = nearestWalkable(g, fromX, fromZ);
  const goal = nearestWalkable(g, toX, toZ);
  if (!start || !goal) return null;
  const si = start[1] * g.cols + start[0];
  const gi = goal[1] * g.cols + goal[0];
  if (si === gi) return [cellCenter(g, goal[0], goal[1])];

  const n = g.cols * g.rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  gScore[si] = 0;
  // Un montón binario simple sobre (f, índice).
  const heapF: number[] = [];
  const heapI: number[] = [];
  const push = (f: number, i: number) => {
    heapF.push(f);
    heapI.push(i);
    let k = heapF.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! <= heapF[k]!) break;
      [heapF[p], heapF[k]] = [heapF[k]!, heapF[p]!];
      [heapI[p], heapI[k]] = [heapI[k]!, heapI[p]!];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heapI[0]!;
    const lastF = heapF.pop()!;
    const lastI = heapI.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lastF;
      heapI[0] = lastI;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heapF.length && heapF[l]! < heapF[m]!) m = l;
        if (r < heapF.length && heapF[r]! < heapF[m]!) m = r;
        if (m === k) break;
        [heapF[m], heapF[k]] = [heapF[k]!, heapF[m]!];
        [heapI[m], heapI[k]] = [heapI[k]!, heapI[m]!];
        k = m;
      }
    }
    return top;
  };
  const gc = goal[0];
  const gr = goal[1];
  const h = (i: number) => {
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    const dx = Math.abs(c - gc);
    const dz = Math.abs(r - gr);
    return Math.max(dx, dz) + 0.41 * Math.min(dx, dz);
  };
  push(h(si), si);

  let found = false;
  while (heapF.length > 0) {
    const cur = pop();
    if (cur === gi) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % g.cols;
    const r = (cur - c) / g.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!walkable(g, nc, nr)) continue;
        if (dc !== 0 && dr !== 0 && (!walkable(g, c + dc, r) || !walkable(g, c, r + dr))) continue;
        const ni = nr * g.cols + nc;
        if (closed[ni] || !canStep(g, cur, ni)) continue;
        const cost = gScore[cur]! + (dc !== 0 && dr !== 0 ? 1.41 : 1);
        if (cost < gScore[ni]!) {
          gScore[ni] = cost;
          came[ni] = cur;
          push(cost + h(ni), ni);
        }
      }
    }
  }
  if (!found) return null;

  const cells: number[] = [];
  for (let i = gi; i !== si && i !== -1; i = came[i]!) cells.push(i);
  cells.reverse();
  const out: { x: number; z: number }[] = [];
  let prevDir = "";
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k]!;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    const prev = k === 0 ? si : cells[k - 1]!;
    const pc = prev % g.cols;
    const pr = (prev - pc) / g.cols;
    const dir = `${c - pc},${r - pr}`;
    // Quedarse con los puntos donde cambia la dirección (y el último).
    if (dir !== prevDir && out.length > 0) {
      // El anterior era el final de un tramo recto: se deja.
    } else if (dir === prevDir && out.length > 0) {
      out.pop();
    }
    out.push(cellCenter(g, c, r));
    prevDir = dir;
  }
  return out;
}

/** Una celda caminable al azar dentro de un rectángulo del mundo. */
export function randomWalkableIn(g: NavGrid, minX: number, minZ: number, maxX: number, maxZ: number, rng: () => number): { x: number; z: number } | null {
  for (let tries = 0; tries < 40; tries++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ);
    const [c, r] = cellOf(g, x, z);
    if (walkable(g, c, r)) return cellCenter(g, c, r);
  }
  return null;
}
