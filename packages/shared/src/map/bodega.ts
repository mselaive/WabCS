import {
  TEX_CONCRETE,
  TEX_CRATE,
  TEX_CT,
  TEX_FLOOR,
  TEX_METAL,
  TEX_ROOF,
  TEX_T,
  TEX_WALL,
  TEX_WOOD,
  type Box,
  type GameMap,
  type Spawn,
} from "./types.js";

/**
 * "Bodega": un depósito de 44 x 32 m con tres caminos entre los dos spawns.
 *
 *   - Mid: una casita en el centro con cuatro puertas, para pelear de cerca.
 *   - Izquierda (x negativo): un pasillo largo con cajones, para rifles.
 *   - Derecha (x positivo): una zona con tabiques en zigzag y una plataforma.
 *
 * Los T aparecen al sur (+Z) y los CT al norte (-Z). El mapa es simétrico por
 * un giro de 180° alrededor del centro: se dibuja la mitad de los T y se gira
 * para los CT, así nadie tiene ventaja de mapa (sólo de lado, que se cambia
 * a la mitad del partido).
 */

const HALF_X = 22;
const HALF_Z = 16;
const WALL_H = 5;
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

/** Una caja girada 180° alrededor del centro (x, z) -> (-x, -z). */
const mirror = (b: Box): Box => box(-b.maxX, b.minY, -b.maxZ, -b.minX, b.maxY, -b.minZ, b.tex);

/** Un cajón de `s` metros de lado apoyado en el piso (o sobre `y`). */
const crate = (x: number, z: number, s = 1.2, y = 0, tex = TEX_CRATE): Box =>
  box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, tex);

function build(): GameMap {
  const boxes: Box[] = [];

  // Piso y paredes del perímetro.
  boxes.push(box(-HALF_X, -0.5, -HALF_Z, HALF_X, 0, HALF_Z, TEX_FLOOR));
  boxes.push(box(-HALF_X - WALL_T, 0, -HALF_Z - WALL_T, HALF_X + WALL_T, WALL_H, -HALF_Z, TEX_WALL));
  boxes.push(box(-HALF_X - WALL_T, 0, HALF_Z, HALF_X + WALL_T, WALL_H, HALF_Z + WALL_T, TEX_WALL));
  boxes.push(box(-HALF_X - WALL_T, 0, -HALF_Z, -HALF_X, WALL_H, HALF_Z, TEX_WALL));
  boxes.push(box(HALF_X, 0, -HALF_Z, HALF_X + WALL_T, WALL_H, HALF_Z, TEX_WALL));

  // Mid: la casita. Paredes con una puerta en el medio de cada lado y techo.
  const H = 3.2;
  const roofTex = TEX_ROOF;
  // Pared sur y norte (z = ±4), puertas en x -1..1.
  for (const z of [4, -4]) {
    const z0 = z > 0 ? z - WALL_T : z;
    const z1 = z > 0 ? z : z + WALL_T;
    boxes.push(box(-5, 0, z0, -1, H, z1, TEX_CONCRETE));
    boxes.push(box(1, 0, z0, 5, H, z1, TEX_CONCRETE));
    // Dintel sobre la puerta.
    boxes.push(box(-1, 2.3, z0, 1, H, z1, TEX_CONCRETE));
  }
  // Pared este y oeste (x = ±5), puertas en z -1..1.
  for (const x of [5, -5]) {
    const x0 = x > 0 ? x - WALL_T : x;
    const x1 = x > 0 ? x : x + WALL_T;
    boxes.push(box(x0, 0, -4, x1, H, -1, TEX_CONCRETE));
    boxes.push(box(x0, 0, 1, x1, H, 4, TEX_CONCRETE));
    boxes.push(box(x0, 2.3, -1, x1, H, 1, TEX_CONCRETE));
  }
  boxes.push(box(-5.2, H, -4.2, 5.2, H + 0.3, 4.2, roofTex));
  // Adentro, un cajón para esconderse detrás.
  boxes.push(crate(2.4, -2.2, 1.2, 0, TEX_WOOD));
  boxes.push(crate(-2.4, 2.2, 1.2, 0, TEX_WOOD));

  // ---- Mitad de los T (z > 0). Se gira para los CT.
  const half: Box[] = [];

  // Pared que separa el spawn del resto, con el hueco al mid (x -2..2) y las
  // salidas a los costados (|x| > 10).
  half.push(box(-10, 0, 8, -2, 3, 8.5, TEX_WALL));
  half.push(box(2, 0, 8, 10, 3, 8.5, TEX_WALL));
  // Marca del equipo en el piso del spawn: se ve, no choca.
  half.push({ ...box(-5, 0, 10.5, 5, 0.02, 14.5, TEX_T), decal: true });
  // Cajones delante de la puerta del mid, para cubrirse al salir.
  half.push(crate(-3.2, 6, 1.2));
  half.push(crate(3.4, 6.2, 1.2));
  half.push(crate(3.4, 6.2, 0.8, 1.2, TEX_WOOD));

  // Pasillo izquierdo (x -22..-10): tabique largo que lo separa del mid y cajones.
  half.push(box(-10, 0, 1, -9.5, 3.5, 8, TEX_WALL));
  half.push(crate(-13, 11, 1.4));
  half.push(crate(-17.5, 7.5, 1.2));
  half.push(crate(-17.5, 7.5, 1.2, 1.2));
  half.push(crate(-12.5, 3.5, 1.4));
  // Un escalón bajo para subir a los cajones.
  half.push(box(-14, 0, 10.3, -13, 0.4, 11.7, TEX_METAL));

  // Zona derecha (x 10..22): tabiques en zigzag y una plataforma baja.
  half.push(box(10, 0, 4.5, 17, 2.6, 5, TEX_WALL));
  half.push(box(15, 0, 9.5, 22, 2.6, 10, TEX_WALL));
  // Plataforma a 0,4 m con un escalón: se sube caminando.
  half.push(box(18, 0, 1, 22, 0.8, 4.5, TEX_METAL));
  half.push(box(18, 0, 4.5, 22, 0.4, 5.5, TEX_METAL));
  half.push(crate(12.5, 7.5, 1.2));
  half.push(crate(19, 2.5, 1.0, 0.8, TEX_WOOD));

  for (const b of half) {
    boxes.push(b);
    boxes.push(mirror(b));
  }

  // Lo que es de un solo equipo se arregla a mano: la marca del piso del CT.
  const ctMark = boxes.find((b) => b.tex === TEX_T && b.minZ < 0);
  if (ctMark) ctMark.tex = TEX_CT;

  // Centro del mapa: cajones sueltos a los costados del mid, iguales de los dos lados.
  boxes.push(crate(-7.5, 0, 1.2));
  boxes.push(crate(7.5, 0, 1.2));
  boxes.push(crate(-7.5, 0, 1.0, 1.2, TEX_WOOD));

  const tSpawns: Spawn[] = [];
  const ctSpawns: Spawn[] = [];
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 2;
    tSpawns.push({ x, y: 0, z: 12.5, yaw: 0 });
    ctSpawns.push({ x: -x, y: 0, z: -12.5, yaw: Math.PI });
  }

  return {
    name: "Bodega",
    boxes,
    spawns: [tSpawns, ctSpawns],
    buyCenter: [
      { x: 0, z: 12.5 },
      { x: 0, z: -12.5 },
    ],
    bounds: { minX: -HALF_X, minZ: -HALF_Z, maxX: HALF_X, maxZ: HALF_Z },
    sky: 0x9fb9d8,
  };
}

export const BODEGA: GameMap = build();
