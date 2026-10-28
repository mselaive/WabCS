import { PLAYER_HALF_W, PLAYER_HEIGHT, STEP_HEIGHT } from "../constants.js";
import type { Box, GameMap } from "../map/types.js";

/**
 * Una grilla de caminos para los bots: celdas de medio metro, y en cada celda
 * uno o más "nodos", uno por nivel donde un jugador parado no choca con nada
 * (el piso del garaje y el techo del garaje son dos nodos de la misma celda).
 * De un nodo se pasa al de la celda vecina si se sube un escalón como mucho o
 * se baja hasta MAX_DROP (caerse de un techo vale, cuesta un poco más).
 */
export interface NavGrid {
  cell: number;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** Nodos por celda, en formato CSR: los de la celda i van de start[i] a start[i+1]. */
  start: Int32Array;
  /** Altura del piso de cada nodo. */
  nodeFloor: Float32Array;
  /** Celda de cada nodo. */
  nodeCell: Int32Array;
  /** 1 si se puede estar parado en la celda (en algún nivel). */
  walk: Uint8Array;
  /** Altura del piso más bajo de la celda (NaN si no se puede). */
  floor: Float32Array;
}

/** Hasta dónde se deja caer un bot sin pensarlo dos veces. */
const MAX_DROP = 3.6;
/** Lo que cuesta de más (en celdas) un tramo en el que se cae más que un escalón. */
const DROP_COST = 6;

const cache = new WeakMap<GameMap, NavGrid>();

function blockedAt(boxes: readonly Box[], x: number, y: number, z: number): boolean {
  const top = y + PLAYER_HEIGHT;
  for (const b of boxes) {
    if (b.decal) continue;
    if (x + PLAYER_HALF_W > b.minX && x - PLAYER_HALF_W < b.maxX && y < b.maxY && top > b.minY && z + PLAYER_HALF_W > b.minZ && z - PLAYER_HALF_W < b.maxZ)
      return true;
  }
  return false;
}

/** Las alturas donde alguien parado en (x, z) apoya los pies sin chocar, de abajo para arriba. */
function floorsAt(boxes: readonly Box[], x: number, z: number): number[] {
  const tops: number[] = [];
  for (const b of boxes) {
    if (b.decal) continue;
    if (x + PLAYER_HALF_W > b.minX && x - PLAYER_HALF_W < b.maxX && z + PLAYER_HALF_W > b.minZ && z - PLAYER_HALF_W < b.maxZ) {
      if (!tops.some((t) => Math.abs(t - b.maxY) < 0.01)) tops.push(b.maxY);
    }
  }
  tops.sort((a, b) => a - b);
  return tops.filter((t) => !blockedAt(boxes, x, t + 0.02, z));
}

export function buildNavGrid(map: GameMap, cell = 0.5): NavGrid {
  const minX = map.bounds.minX;
  const minZ = map.bounds.minZ;
  const cols = Math.ceil((map.bounds.maxX - minX) / cell);
  const rows = Math.ceil((map.bounds.maxZ - minZ) / cell);
  const cells = cols * rows;
  const start = new Int32Array(cells + 1);
  const floors: number[] = [];
  const cellOfNode: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      start[i] = floors.length;
      const x = minX + (c + 0.5) * cell;
      const z = minZ + (r + 0.5) * cell;
      for (const f of floorsAt(map.boxes, x, z)) {
        floors.push(f);
        cellOfNode.push(i);
      }
    }
  }
  start[cells] = floors.length;
  const grid: NavGrid = {
    cell, minX, minZ, cols, rows, start,
    nodeFloor: Float32Array.from(floors),
    nodeCell: Int32Array.from(cellOfNode),
    walk: new Uint8Array(cells),
    floor: new Float32Array(cells).fill(NaN),
  };

  // Sólo lo que se alcanza desde los spawns: la tapa de un barril es "piso"
  // para la cuenta de arriba, pero nadie sube ahí sin saltar, y el techo de la
  // casita del mid no tiene escalera. Un bot que elige una isla como destino
  // se queda sin camino.
  const n = floors.length;
  const reached = new Uint8Array(n);
  const queue: number[] = [];
  for (const team of map.spawns) {
    for (const s of team) {
      const node = nodeAt(grid, s.x, s.y, s.z);
      if (node >= 0 && !reached[node]) {
        reached[node] = 1;
        queue.push(node);
      }
    }
  }
  while (queue.length > 0) {
    const a = queue.pop()!;
    forEachNeighbor(grid, a, (b) => {
      if (!reached[b]) {
        reached[b] = 1;
        queue.push(b);
      }
    });
  }
  // Los nodos que no se alcanzan se borran (compactando el CSR).
  const keepFloors: number[] = [];
  const keepCells: number[] = [];
  const newStart = new Int32Array(cells + 1);
  for (let i = 0; i < cells; i++) {
    newStart[i] = keepFloors.length;
    for (let k = start[i]!; k < start[i + 1]!; k++) {
      if (!reached[k]) continue;
      keepFloors.push(floors[k]!);
      keepCells.push(i);
    }
    if (keepFloors.length > newStart[i]!) {
      grid.walk[i] = 1;
      grid.floor[i] = keepFloors[newStart[i]!]!;
    }
  }
  newStart[cells] = keepFloors.length;
  grid.start = newStart;
  grid.nodeFloor = Float32Array.from(keepFloors);
  grid.nodeCell = Int32Array.from(keepCells);
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

/**
 * El nodo de la celda `cell` al que se llega desde un piso a altura `from`:
 * subiendo un escalón como mucho, bajando hasta `maxDrop`. Si hay varios, el
 * más cercano en altura. -1 si ninguno.
 */
function nodeFrom(g: NavGrid, cell: number, from: number, maxDrop: number): number {
  let best = -1;
  let bestDiff = Infinity;
  for (let k = g.start[cell]!; k < g.start[cell + 1]!; k++) {
    const f = g.nodeFloor[k]!;
    const climb = f - from;
    if (climb > STEP_HEIGHT + 0.01 || -climb > maxDrop) continue;
    const diff = Math.abs(climb);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

/** El nodo de la celda de (x, z) con el piso más cercano a `y`, o -1 si la celda no tiene. */
export function nodeAt(g: NavGrid, x: number, y: number, z: number): number {
  const [c, r] = cellOf(g, x, z);
  const cell = r * g.cols + c;
  let best = -1;
  let bestDiff = Infinity;
  for (let k = g.start[cell]!; k < g.start[cell + 1]!; k++) {
    const diff = Math.abs(g.nodeFloor[k]! - y);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  }
  return best;
}

/**
 * Los vecinos de un nodo: ocho celdas alrededor; en diagonal sólo si en las dos
 * ortogonales también hay un nodo al que se pasa, para no cortar esquinas
 * contra una pared ni caerse por el borde de un techo en diagonal.
 */
function forEachNeighbor(g: NavGrid, a: number, fn: (b: number, cost: number) => void): void {
  const cell = g.nodeCell[a]!;
  const c = cell % g.cols;
  const r = (cell - c) / g.cols;
  const from = g.nodeFloor[a]!;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const diagonal = dc !== 0 && dr !== 0;
      if (diagonal && (nodeFrom(g, r * g.cols + (c + dc), from, STEP_HEIGHT) < 0 || nodeFrom(g, (r + dr) * g.cols + c, from, STEP_HEIGHT) < 0)) continue;
      const b = nodeFrom(g, nr * g.cols + nc, from, MAX_DROP);
      if (b < 0) continue;
      const drop = from - g.nodeFloor[b]!;
      fn(b, (diagonal ? 1.41 : 1) + (drop > STEP_HEIGHT + 0.01 ? DROP_COST : 0));
    }
  }
}

/** El nodo más cercano a (x, y, z), buscando en espiral por las celdas. */
function nearestNode(g: NavGrid, x: number, y: number, z: number): number {
  const direct = nodeAt(g, x, y, z);
  if (direct >= 0) return direct;
  const [c0, r0] = cellOf(g, x, z);
  for (let radius = 1; radius < 8; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (!walkable(g, c, r)) continue;
        const center = cellCenter(g, c, r);
        return nodeAt(g, center.x, y, center.z);
      }
    }
  }
  return -1;
}

/** La celda caminable más cercana a (x, z), buscando en espiral. */
export function nearestWalkable(g: NavGrid, x: number, z: number): [number, number] | null {
  const node = nearestNode(g, x, 0, z);
  if (node < 0) return null;
  const cell = g.nodeCell[node]!;
  const c = cell % g.cols;
  return [c, (cell - c) / g.cols];
}

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * A* de (fromX, fromY, fromZ) a (toX, toZ) a la altura `toY` (si es NaN, al
 * nivel más bajo de esa celda). Devuelve los puntos del camino (centros de
 * celda con la altura del piso, sin el de partida), simplificado quitando los
 * colineales del mismo nivel; null si no hay camino.
 */
export function findPath(g: NavGrid, fromX: number, fromZ: number, toX: number, toZ: number, fromY = 0, toY = NaN): NavPoint[] | null {
  const si = nearestNode(g, fromX, fromY, fromZ);
  const gi = nearestNode(g, toX, Number.isNaN(toY) ? -1e6 : toY, toZ);
  if (si < 0 || gi < 0) return null;
  if (si === gi) return [pointOf(g, gi)];

  const n = g.nodeFloor.length;
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
  const gCell = g.nodeCell[gi]!;
  const gc = gCell % g.cols;
  const gr = (gCell - gc) / g.cols;
  const h = (i: number) => {
    const cell = g.nodeCell[i]!;
    const c = cell % g.cols;
    const r = (cell - c) / g.cols;
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
    forEachNeighbor(g, cur, (ni, stepCost) => {
      if (closed[ni]) return;
      const cost = gScore[cur]! + stepCost;
      if (cost < gScore[ni]!) {
        gScore[ni] = cost;
        came[ni] = cur;
        push(cost + h(ni), ni);
      }
    });
  }
  if (!found) return null;

  const nodes: number[] = [];
  for (let i = gi; i !== si && i !== -1; i = came[i]!) nodes.push(i);
  nodes.reverse();
  const out: NavPoint[] = [];
  let prevDir = "";
  for (let k = 0; k < nodes.length; k++) {
    const i = nodes[k]!;
    const cell = g.nodeCell[i]!;
    const c = cell % g.cols;
    const r = (cell - c) / g.cols;
    const prev = k === 0 ? si : nodes[k - 1]!;
    const pCell = g.nodeCell[prev]!;
    const pc = pCell % g.cols;
    const pr = (pCell - pc) / g.cols;
    // Un cambio de nivel cuenta como cambio de dirección: el punto de la subida se deja.
    const dir = `${c - pc},${r - pr},${Math.abs(g.nodeFloor[i]! - g.nodeFloor[prev]!) > 0.01 ? "^" : ""}`;
    if (dir === prevDir && out.length > 0) out.pop();
    out.push(pointOf(g, i));
    prevDir = dir;
  }
  return out;
}

function pointOf(g: NavGrid, node: number): NavPoint {
  const cell = g.nodeCell[node]!;
  const c = cell % g.cols;
  const r = (cell - c) / g.cols;
  const { x, z } = cellCenter(g, c, r);
  return { x, y: g.nodeFloor[node]!, z };
}

/** Un nodo al azar dentro de un rectángulo del mundo (en cualquier nivel: los techos también). */
export function randomWalkableIn(g: NavGrid, minX: number, minZ: number, maxX: number, maxZ: number, rng: () => number): NavPoint | null {
  for (let tries = 0; tries < 40; tries++) {
    const x = minX + rng() * (maxX - minX);
    const z = minZ + rng() * (maxZ - minZ);
    const [c, r] = cellOf(g, x, z);
    const cell = r * g.cols + c;
    const count = g.start[cell + 1]! - g.start[cell]!;
    if (count === 0) continue;
    return pointOf(g, g.start[cell]! + Math.floor(rng() * count));
  }
  return null;
}
