import {
  TEX_ASPHALT,
  TEX_BARREL,
  TEX_BRICK,
  TEX_CONCRETE,
  TEX_CRATE,
  TEX_CT,
  TEX_FLOOR,
  TEX_METAL,
  TEX_PAVERS,
  TEX_PLASTER,
  TEX_ROOF,
  TEX_SANDBAG,
  TEX_SITE,
  TEX_T,
  TEX_WOOD,
  type BombSite,
  type Box,
  type GameMap,
  type Spawn,
} from "./types.js";

/**
 * "Patio": una plaza de 44 x 32 m con una fuente escalonada en el medio y
 * dos tiendas enfrentadas, una calle larga y abierta a la izquierda (para
 * francotiradores, con sacos de arena de cobertura) y un túnel techado y
 * oscuro a la derecha (para escopetas y subfusiles). Los sitios de la bomba:
 * A adentro de la tienda CT, B al final de la calle larga.
 *
 * Como Bodega, simétrico por un giro de 180° alrededor del centro.
 */

const HALF_X = 22;
const HALF_Z = 16;
const WALL_H = 6;
const WALL_T = 0.5;

const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, tex: number): Box => ({
  minX: Math.min(minX, maxX),
  minY: Math.min(minY, maxY),
  minZ: Math.min(minZ, maxZ),
  maxX: Math.max(minX, maxX),
  maxY: Math.max(minY, maxY),
  maxZ: Math.max(minZ, maxZ),
  tex,
});

const mirror = (b: Box): Box => ({ ...box(-b.maxX, b.minY, -b.maxZ, -b.minX, b.maxY, -b.minZ, b.tex), ...(b.decal ? { decal: true } : {}), ...(b.shape ? { shape: b.shape } : {}) });
const crate = (x: number, z: number, s = 1.2, y = 0, tex = TEX_CRATE): Box => box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, tex);
const barrel = (x: number, z: number, y = 0): Box => ({ ...box(x - 0.3, y, z - 0.3, x + 0.3, y + 0.9, z + 0.3, TEX_BARREL), shape: "cyl" });
const pillar = (x: number, z: number, h = 3.4): Box => box(x - 0.35, 0, z - 0.35, x + 0.35, h, z + 0.35, TEX_CONCRETE);
const sandbags = (minX: number, minZ: number, maxX: number, maxZ: number): Box => box(minX, 0, minZ, maxX, 0.9, maxZ, TEX_SANDBAG);

function build(): GameMap {
  const boxes: Box[] = [];

  // ---- Piso, calles y muro.
  // Adoquines en la plaza; asfalto en las calles; baldosas adentro de las tiendas.
  boxes.push(box(-HALF_X, -0.5, -HALF_Z, HALF_X, 0, HALF_Z, TEX_PAVERS));
  boxes.push({ ...box(-HALF_X, 0, -HALF_Z, -13, 0.01, HALF_Z, TEX_ASPHALT), decal: true });
  boxes.push({ ...box(13, 0, -HALF_Z, HALF_X, 0.01, HALF_Z, TEX_ASPHALT), decal: true });
  boxes.push(box(-HALF_X - WALL_T, 0, -HALF_Z - WALL_T, HALF_X + WALL_T, WALL_H, -HALF_Z, TEX_BRICK));
  boxes.push(box(-HALF_X - WALL_T, 0, HALF_Z, HALF_X + WALL_T, WALL_H, HALF_Z + WALL_T, TEX_BRICK));
  boxes.push(box(-HALF_X - WALL_T, 0, -HALF_Z, -HALF_X, WALL_H, HALF_Z, TEX_BRICK));
  boxes.push(box(HALF_X, 0, -HALF_Z, HALF_X + WALL_T, WALL_H, HALF_Z, TEX_BRICK));

  // ---- La fuente: dos escalones (0,4 y 0,8) con un pilar corto en el medio.
  boxes.push(box(-3, 0, -3, 3, 0.4, 3, TEX_CONCRETE));
  boxes.push(box(-2, 0.4, -2, 2, 0.8, 2, TEX_CONCRETE));
  boxes.push(box(-0.5, 0.8, -0.5, 0.5, 2.2, 0.5, TEX_METAL));
  // Pilares alrededor de la plaza.
  boxes.push(pillar(-6, 4));
  boxes.push(pillar(6, -4));
  boxes.push(pillar(6, 4));
  boxes.push(pillar(-6, -4));

  // ---- Mitad de los T (z > 0), girada para los CT.
  const half: Box[] = [];

  // Fachada del spawn: de x -12,5 a -4 y de 4 a 13; el hueco al medio y las calles a los costados.
  half.push(box(-12.5, 0, 8, -4, 3.4, 8.5, TEX_PLASTER));
  half.push(box(4, 0, 8, 13, 3.4, 8.5, TEX_PLASTER));
  half.push(box(-4, 2.6, 8, 4, 3.4, 8.5, TEX_PLASTER));
  half.push({ ...box(-5, 0, 10.5, 5, 0.02, 14.5, TEX_T), decal: true });
  half.push(sandbags(-1.3, 6.2, 1.3, 6.8));

  // La tienda T (x -11..-6, z 3..7): puerta a la plaza (lado este, z 4..5,8) y ventana a la calle (oeste).
  half.push(box(-11, 0, 6.7, -6, 3, 7, TEX_PLASTER));
  half.push(box(-11, 0, 3, -6, 3, 3.3, TEX_PLASTER));
  half.push(box(-6.3, 0, 3, -6, 3, 4, TEX_PLASTER));
  half.push(box(-6.3, 0, 5.8, -6, 3, 7, TEX_PLASTER));
  half.push(box(-6.3, 2.3, 4, -6, 3, 5.8, TEX_PLASTER));
  half.push(box(-11, 0, 3, -10.7, 1.1, 7, TEX_PLASTER));
  half.push(box(-11, 2.0, 3, -10.7, 3, 7, TEX_PLASTER));
  half.push(box(-11, 1.1, 3, -10.7, 2.0, 4.2, TEX_PLASTER));
  half.push(box(-11, 1.1, 5.8, -10.7, 2.0, 7, TEX_PLASTER));
  half.push(box(-11.2, 3, 2.8, -5.8, 3.25, 7.2, TEX_ROOF));
  half.push({ ...box(-10.7, 0, 3.3, -6.3, 0.008, 6.7, TEX_FLOOR), decal: true });
  half.push(crate(-9.5, 6, 1.0, 0, TEX_WOOD));

  // El tabique que separa la calle larga de la plaza (x -13..-12,5), con una puerta en z 1..3.
  half.push(box(-13, 0, 3, -12.5, 3.5, 8, TEX_CONCRETE));
  half.push(box(-13, 2.3, 1, -12.5, 3.5, 3, TEX_CONCRETE));
  half.push(box(-13, 0, 0, -12.5, 3.5, 1, TEX_CONCRETE));
  // La calle larga: sacos para cubrirse y un cajón.
  half.push(sandbags(-19, 4, -16, 4.6));
  half.push(crate(-14.5, 11, 1.2));
  half.push(barrel(-21.3, 13.8));
  half.push(barrel(-20.6, 14.3));

  // El túnel (x 13..22, z -8..8): pared hacia la plaza con dos entradas, y techo.
  half.push(box(13, 0, 5, 13.5, 2.6, 8, TEX_CONCRETE));
  half.push(box(13, 0, 0, 13.5, 2.6, 3, TEX_CONCRETE));
  half.push(box(13, 2.0, 3, 13.5, 2.6, 5, TEX_CONCRETE));
  half.push(box(13, 2.6, 0, 22, 2.9, 8, TEX_ROOF));
  half.push(crate(17.5, 2.5, 1.2));
  half.push(crate(20.5, 6, 1.2));
  half.push(crate(20.5, 6, 1.0, 1.2, TEX_WOOD));
  // A la salida del túnel, del lado del spawn: barriles.
  half.push(barrel(15, 11));
  half.push(barrel(15.7, 11.4));

  // Bancos y canteros en la plaza: cobertura baja (los bancos se suben de un paso).
  half.push(box(-1.2, 0, 4.8, 1.2, 0.44, 5.3, TEX_WOOD));
  half.push(box(8.4, 0, -0.6, 9.6, 0.9, 0.6, TEX_BRICK));
  half.push(box(-9.2, 0, 1.2, -8.7, 0.44, 3.6, TEX_WOOD));

  // Cajones en la plaza.
  half.push(crate(-3.5, 5.5, 1.2));
  half.push(crate(9.5, 2.5, 1.2));
  half.push(crate(9.5, 2.5, 1.0, 1.2, TEX_WOOD));

  for (const b of half) {
    boxes.push(b);
    boxes.push(mirror(b));
  }
  const ctMark = boxes.find((b) => b.tex === TEX_T && b.minZ < 0);
  if (ctMark) ctMark.tex = TEX_CT;

  // Sitios: A adentro de la tienda CT (la tienda T girada), B al final de la calle larga del lado CT.
  const sites: BombSite[] = [
    { name: "A", minX: 6.3, minZ: -6.7, maxX: 10.7, maxZ: -3.3 },
    { name: "B", minX: -21, minZ: -15, maxX: -14, maxZ: -10 },
  ];
  for (const s of sites) boxes.push({ ...box(s.minX, 0, s.minZ, s.maxX, 0.012, s.maxZ, TEX_SITE), decal: true });

  const tSpawns: Spawn[] = [];
  const ctSpawns: Spawn[] = [];
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 2;
    tSpawns.push({ x, y: 0, z: 12.5, yaw: 0 });
    ctSpawns.push({ x: -x, y: 0, z: -12.5, yaw: Math.PI });
  }

  return {
    name: "Patio",
    boxes,
    spawns: [tSpawns, ctSpawns],
    sites,
    buyCenter: [
      { x: 0, z: 12.5 },
      { x: 0, z: -12.5 },
    ],
    bounds: { minX: -HALF_X, minZ: -HALF_Z, maxX: HALF_X, maxZ: HALF_Z },
    sky: 0xb8c6d9,
  };
}

export const PATIO: GameMap = build();
