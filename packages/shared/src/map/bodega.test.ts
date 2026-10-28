import { describe, expect, it } from "vitest";
import { PLAYER_HALF_W, PLAYER_HEIGHT, STEP_HEIGHT } from "../constants.js";
import { standsFree } from "../sim/movement.js";
import { BODEGA } from "./bodega.js";
import type { Box } from "./types.js";

const solid = BODEGA.boxes.filter((b) => !b.decal);

/** ¿Un jugador parado en (x, y, z) choca con algo? */
function blocked(x: number, y: number, z: number): boolean {
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

/**
 * Altura del piso bajo los pies de alguien parado en (x, z): la cara de arriba
 * más alta, por debajo de `below`, de lo que toque la huella del jugador.
 */
function floorAt(x: number, z: number, below: number): number {
  let best = -Infinity;
  for (const b of solid) {
    if (
      x + PLAYER_HALF_W > b.minX &&
      x - PLAYER_HALF_W < b.maxX &&
      z + PLAYER_HALF_W > b.minZ &&
      z - PLAYER_HALF_W < b.maxZ &&
      b.maxY <= below + 0.01 &&
      b.maxY > best
    )
      best = b.maxY;
  }
  return best;
}

/**
 * Celdas de 0,5 m por las que se puede caminar (incluyendo subir escalones de
 * hasta STEP_HEIGHT y bajar de cualquier altura), desde un punto. Devuelve
 * el conjunto de "x,z,y" alcanzado.
 */
function reachable(fromX: number, fromZ: number): Set<string> {
  const step = 0.5;
  const key = (x: number, z: number, y: number) => `${x.toFixed(1)},${z.toFixed(1)},${y.toFixed(2)}`;
  const seen = new Set<string>();
  const queue: [number, number, number][] = [[fromX, fromZ, 0]];
  seen.add(key(fromX, fromZ, 0));
  while (queue.length) {
    const [x, z, y] = queue.shift()!;
    const dirs: [number, number][] = [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ];
    for (const [dx, dz] of dirs) {
      const nx = x + dx;
      const nz = z + dz;
      if (Math.abs(nx) > 21.5 || Math.abs(nz) > 15.5) continue;
      // Probar a la misma altura, subiendo un escalón, o cayendo.
      for (const ny of [y, y + STEP_HEIGHT]) {
        if (blocked(nx, ny + 0.01, nz)) continue;
        const ground = floorAt(nx, nz, ny + 0.01);
        if (ground === -Infinity) continue;
        if (ny - ground > STEP_HEIGHT + 0.01 && ny !== y) continue;
        const landY = ground;
        if (blocked(nx, landY + 0.01, nz)) continue;
        const k = key(nx, nz, landY);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push([nx, nz, landY]);
        break;
      }
    }
  }
  return seen;
}

describe("Bodega", () => {
  it("es simétrica por un giro de 180°", () => {
    const sig = (b: Box) => `${b.minY},${b.maxY},${b.tex === 4 || b.tex === 5 ? "mark" : b.tex},${b.shape ?? "box"}`;
    // Los sitios de la bomba son sólo del lado CT: no tienen gemela.
    for (const b of solid.concat(BODEGA.boxes.filter((b) => b.decal && b.tex !== 16))) {
      const twin = BODEGA.boxes.find(
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

  it("todos los spawns están libres y en el piso", () => {
    for (const team of BODEGA.spawns) {
      for (const s of team) {
        expect(standsFree(s.x, s.y, s.z, BODEGA), `spawn ${s.x},${s.z}`).toBe(true);
        expect(floorAt(s.x, s.z, 0.01)).toBe(0);
      }
    }
  });

  it("del spawn T se llega al spawn CT, al techo del garaje y a la plataforma", () => {
    const from = reachable(0, 12.5);
    const at = (x: number, z: number, y: number) => [...from].some((k) => k === `${x.toFixed(1)},${z.toFixed(1)},${y.toFixed(2)}`);
    expect(at(0, -12.5, 0), "spawn CT").toBe(true);
    // El techo del garaje T (y 3,25) y el del garaje CT.
    expect(at(-17, 4.5, 3.25), "techo del garaje T").toBe(true);
    expect(at(17, -4.5, 3.25), "techo del garaje CT").toBe(true);
    // La plataforma de la derecha (0,8) y la de la izquierda espejada.
    expect(at(20, 2.5, 0.8), "plataforma").toBe(true);
    // Adentro de la casita del mid y adentro del garaje.
    expect(at(0, 0, 0), "mid").toBe(true);
    expect(at(-16, 4.5, 0), "adentro del garaje").toBe(true);
  });

  it("los sitios de la bomba están del lado CT y se llega caminando", () => {
    const from = reachable(0, 12.5);
    for (const s of BODEGA.sites) {
      expect(s.maxZ).toBeLessThan(0);
      const cx = Math.round(((s.minX + s.maxX) / 2) * 2) / 2;
      const cz = Math.round(((s.minZ + s.maxZ) / 2) * 2) / 2;
      expect([...from].some((k) => k.startsWith(`${cx.toFixed(1)},${cz.toFixed(1)},`)), `sitio ${s.name}`).toBe(true);
    }
  });

  it("nada flota ni se hunde raro: las cajas apoyan en algo", () => {
    for (const b of solid) {
      if (b.minY <= 0.001) continue;
      const support = solid.some(
        (o) => o !== b && Math.abs(o.maxY - b.minY) < 0.02 && o.minX < b.maxX && o.maxX > b.minX && o.minZ < b.maxZ && o.maxZ > b.minZ,
      );
      // Los dinteles y las partes altas de las paredes con ventana cuelgan de la pared: valen.
      const hangs = solid.some((o) => o !== b && o.maxY >= b.maxY && o.minY <= b.minY && (Math.abs(o.maxX - b.minX) < 0.02 || Math.abs(o.minX - b.maxX) < 0.02 || Math.abs(o.maxZ - b.minZ) < 0.02 || Math.abs(o.minZ - b.maxZ) < 0.02));
      expect(support || hangs, `flota: ${JSON.stringify(b)}`).toBe(true);
    }
  });
});
