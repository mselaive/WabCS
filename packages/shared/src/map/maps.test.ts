import { describe, expect, it } from "vitest";
import { PLAYER_HALF_W, PLAYER_HEIGHT, STEP_HEIGHT } from "../constants.js";
import { standsFree } from "../sim/movement.js";
import { findPath, navGridFor } from "../sim/nav.js";
import { MAPS } from "./index.js";
import type { Box, GameMap } from "./types.js";

/** Lo que tiene que cumplir cualquier mapa para que se pueda jugar. */

function solidOf(map: GameMap): Box[] {
  return map.boxes.filter((b) => !b.decal);
}

function blocked(solid: readonly Box[], x: number, y: number, z: number): boolean {
  for (const b of solid) {
    if (
      x - PLAYER_HALF_W < b.maxX &&
      x + PLAYER_HALF_W > b.minX &&
      y < b.maxY &&
      y + PLAYER_HEIGHT > b.minY &&
      z - PLAYER_HALF_W < b.maxZ &&
      z + PLAYER_HALF_W > b.minZ
    )
      return true;
  }
  return false;
}

function floorAt(solid: readonly Box[], x: number, z: number, below: number): number {
  let best = -Infinity;
  for (const b of solid) {
    if (x + PLAYER_HALF_W > b.minX && x - PLAYER_HALF_W < b.maxX && z + PLAYER_HALF_W > b.minZ && z - PLAYER_HALF_W < b.maxZ && b.maxY <= below + 0.01 && b.maxY > best)
      best = b.maxY;
  }
  return best;
}

/** Celdas de medio metro alcanzables caminando (subiendo escalones, bajando lo que sea). */
function reachable(map: GameMap, fromX: number, fromZ: number): Set<string> {
  const solid = solidOf(map);
  const step = 0.5;
  const key = (x: number, z: number, y: number) => `${x.toFixed(1)},${z.toFixed(1)},${y.toFixed(2)}`;
  const seen = new Set<string>();
  const queue: [number, number, number][] = [[fromX, fromZ, 0]];
  seen.add(key(fromX, fromZ, 0));
  const dirs: [number, number][] = [
    [step, 0],
    [-step, 0],
    [0, step],
    [0, -step],
  ];
  while (queue.length) {
    const [x, z, y] = queue.shift()!;
    for (const [dx, dz] of dirs) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < map.bounds.minX + 0.5 || nx > map.bounds.maxX - 0.5 || nz < map.bounds.minZ + 0.5 || nz > map.bounds.maxZ - 0.5) continue;
      for (const ny of [y, y + STEP_HEIGHT]) {
        if (blocked(solid, nx, ny + 0.01, nz)) continue;
        const ground = floorAt(solid, nx, nz, ny + 0.01);
        if (ground === -Infinity) continue;
        if (ny - ground > STEP_HEIGHT + 0.01 && ny !== y) continue;
        if (blocked(solid, nx, ground + 0.01, nz)) continue;
        const k = key(nx, nz, ground);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([nx, nz, ground]);
        break;
      }
    }
  }
  return seen;
}

describe.each(MAPS.map((m) => [m.name, m] as const))("el mapa %s", (_name, map) => {
  const solid = solidOf(map);

  it("es simétrico por un giro de 180° (salvo los sitios de la bomba)", () => {
    const sig = (b: Box) => `${b.minY},${b.maxY},${b.tex === 4 || b.tex === 5 ? "mark" : b.tex},${b.shape ?? "box"}`;
    for (const b of map.boxes.filter((b) => b.tex !== 16)) {
      const twin = map.boxes.find(
        (o) =>
          Math.abs(o.minX + b.maxX) < 1e-6 &&
          Math.abs(o.maxX + b.minX) < 1e-6 &&
          Math.abs(o.minZ + b.maxZ) < 1e-6 &&
          Math.abs(o.maxZ + b.minZ) < 1e-6 &&
          sig(o) === sig(b),
      );
      expect(twin, `sin gemela: ${JSON.stringify(b)}`).toBeDefined();
    }
  });

  it("los spawns están libres y en el piso, y los sitios del lado CT", () => {
    for (const team of map.spawns) {
      for (const s of team) {
        expect(standsFree(s.x, s.y, s.z, map), `spawn ${s.x},${s.z}`).toBe(true);
        expect(floorAt(solid, s.x, s.z, 0.01)).toBe(0);
      }
    }
    expect(map.sites.length).toBe(2);
    for (const s of map.sites) expect(s.maxZ).toBeLessThan(0);
  });

  it("del spawn T se llega al spawn CT y a los dos sitios", () => {
    const from = reachable(map, 0, 12.5);
    const at = (x: number, z: number) => [...from].some((k) => k.startsWith(`${x.toFixed(1)},${z.toFixed(1)},`));
    expect(at(0, -12.5), "spawn CT").toBe(true);
    for (const s of map.sites) {
      const cx = Math.round(((s.minX + s.maxX) / 2) * 2) / 2;
      const cz = Math.round(((s.minZ + s.maxZ) / 2) * 2) / 2;
      expect(at(cx, cz), `sitio ${s.name}`).toBe(true);
    }
  });

  it("los bots encuentran camino de un spawn al otro y a los sitios", () => {
    const grid = navGridFor(map);
    expect(findPath(grid, 0, 12.5, 0, -12.5)).not.toBeNull();
    for (const s of map.sites) expect(findPath(grid, 0, 12.5, (s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2), `sitio ${s.name}`).not.toBeNull();
  });

  it("nada flota: las cajas apoyan en algo o cuelgan de una pared", () => {
    for (const b of solid) {
      if (b.minY <= 0.001) continue;
      const support = solid.some((o) => o !== b && Math.abs(o.maxY - b.minY) < 0.02 && o.minX < b.maxX && o.maxX > b.minX && o.minZ < b.maxZ && o.maxZ > b.minZ);
      const hangs = solid.some(
        (o) =>
          o !== b &&
          o.maxY >= b.maxY &&
          o.minY <= b.minY &&
          (Math.abs(o.maxX - b.minX) < 0.02 || Math.abs(o.minX - b.maxX) < 0.02 || Math.abs(o.maxZ - b.minZ) < 0.02 || Math.abs(o.minZ - b.maxZ) < 0.02),
      );
      expect(support || hangs, `flota: ${JSON.stringify(b)}`).toBe(true);
    }
  });
});
