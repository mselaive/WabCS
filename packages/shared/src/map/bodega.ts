import {
  TEX_ASPHALT,
  TEX_BARREL,
  TEX_BRICK,
  TEX_CONCRETE,
  TEX_CONTAINER_BLUE,
  TEX_CONTAINER_RED,
  TEX_CRATE,
  TEX_CT,
  TEX_FLOOR,
  TEX_METAL,
  TEX_PLASTER,
  TEX_ROOF,
  TEX_SANDBAG,
  TEX_T,
  TEX_WOOD,
  type Box,
  type GameMap,
  type Spawn,
} from "./types.js";

/**
 * "Bodega": un depósito de 44 x 32 m con tres caminos entre los dos spawns.
 *
 *   - Mid: una casita de hormigón con cuatro puertas, para pelear de cerca,
 *     con sacos de arena en las esquinas y dos pilares a los costados.
 *   - Izquierda (x negativo): un garaje con puerta, ventana y techo al que se
 *     sube por una escalera pegada al muro: el puesto de francotirador, con un
 *     parapeto. Abajo, un pasillo de asfalto con cajones y sacos.
 *   - Derecha (x positivo): dos contenedores en zigzag, una plataforma baja a
 *     la que se sube caminando, barriles y cajones apilados.
 *
 * Los T aparecen al sur (+Z) y los CT al norte (-Z). El mapa es simétrico por
 * un giro de 180° alrededor del centro: se dibuja la mitad de los T y se gira
 * para los CT, así nadie tiene ventaja de mapa (sólo de lado, que se cambia
 * a la mitad del partido). Lo que es de los dos (la casita, los pilares) se
 * dibuja una vez, simétrico de por sí.
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

/** Una caja girada 180° alrededor del centro: (x, z) -> (-x, -z). */
const mirror = (b: Box): Box => ({ ...box(-b.maxX, b.minY, -b.maxZ, -b.minX, b.maxY, -b.minZ, b.tex), ...(b.decal ? { decal: true } : {}), ...(b.shape ? { shape: b.shape } : {}) });

/** Un cajón de `s` metros de lado apoyado en el piso (o sobre `y`). */
const crate = (x: number, z: number, s = 1.2, y = 0, tex = TEX_CRATE): Box =>
  box(x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, tex);

/** Un barril de 60 cm de diámetro y 90 de alto. */
const barrel = (x: number, z: number, y = 0): Box => ({ ...box(x - 0.3, y, z - 0.3, x + 0.3, y + 0.9, z + 0.3, TEX_BARREL), shape: "cyl" });

/** Un pilar de hormigón. */
const pillar = (x: number, z: number, h = 3.4): Box => box(x - 0.35, 0, z - 0.35, x + 0.35, h, z + 0.35, TEX_CONCRETE);

/** Sacos de arena apilados: una pared baja de 90 cm. */
const sandbags = (minX: number, minZ: number, maxX: number, maxZ: number): Box => box(minX, 0, minZ, maxX, 0.9, maxZ, TEX_SANDBAG);

function build(): GameMap {
  const boxes: Box[] = [];

  // ---- Piso, calles y muro del perímetro (ladrillo).
  boxes.push(box(-HALF_X, -0.5, -HALF_Z, HALF_X, 0, HALF_Z, TEX_FLOOR));
  boxes.push({ ...box(-HALF_X, 0, -HALF_Z, -10, 0.01, HALF_Z, TEX_ASPHALT), decal: true });
  boxes.push({ ...box(10, 0, -HALF_Z, HALF_X, 0.01, HALF_Z, TEX_ASPHALT), decal: true });
  boxes.push(box(-HALF_X - WALL_T, 0, -HALF_Z - WALL_T, HALF_X + WALL_T, WALL_H, -HALF_Z, TEX_BRICK));
  boxes.push(box(-HALF_X - WALL_T, 0, HALF_Z, HALF_X + WALL_T, WALL_H, HALF_Z + WALL_T, TEX_BRICK));
  boxes.push(box(-HALF_X - WALL_T, 0, -HALF_Z, -HALF_X, WALL_H, HALF_Z, TEX_BRICK));
  boxes.push(box(HALF_X, 0, -HALF_Z, HALF_X + WALL_T, WALL_H, HALF_Z, TEX_BRICK));

  // ---- Mid: la casita. Paredes con una puerta en el medio de cada lado y techo.
  const H = 3.2;
  for (const z of [4, -4]) {
    const z0 = z > 0 ? z - WALL_T : z;
    const z1 = z > 0 ? z : z + WALL_T;
    boxes.push(box(-5, 0, z0, -1, H, z1, TEX_CONCRETE));
    boxes.push(box(1, 0, z0, 5, H, z1, TEX_CONCRETE));
    boxes.push(box(-1, 2.3, z0, 1, H, z1, TEX_CONCRETE));
  }
  for (const x of [5, -5]) {
    const x0 = x > 0 ? x - WALL_T : x;
    const x1 = x > 0 ? x : x + WALL_T;
    boxes.push(box(x0, 0, -4, x1, H, -1, TEX_CONCRETE));
    boxes.push(box(x0, 0, 1, x1, H, 4, TEX_CONCRETE));
    boxes.push(box(x0, 2.3, -1, x1, H, 1, TEX_CONCRETE));
  }
  boxes.push(box(-5.2, H, -4.2, 5.2, H + 0.3, 4.2, TEX_ROOF));
  // Adentro: un cajón y dos barriles, para esconderse.
  boxes.push(crate(2.4, -2.2, 1.2, 0, TEX_WOOD));
  boxes.push(crate(-2.4, 2.2, 1.2, 0, TEX_WOOD));
  boxes.push(barrel(-3.6, -2.8));
  boxes.push(barrel(3.6, 2.8));
  // Pilares a los costados del mid: cortan la vista de punta a punta.
  boxes.push(pillar(-8, 0));
  boxes.push(pillar(8, 0));
  // Cajones sueltos al lado de los pilares, apilables.
  boxes.push(crate(-7.6, 2.2, 1.2));
  boxes.push(crate(-7.6, 2.2, 1.0, 1.2, TEX_WOOD));
  boxes.push(crate(7.6, -2.2, 1.2));
  boxes.push(crate(7.6, -2.2, 1.0, 1.2, TEX_WOOD));

  // ---- Mitad de los T (z > 0). Se gira para los CT.
  const half: Box[] = [];

  // Fachada que separa el spawn del resto: revoque, con el portón al mid (x -2..2)
  // y las salidas a las calles (|x| > 10).
  half.push(box(-10, 0, 8, -2, 3.4, 8.5, TEX_PLASTER));
  half.push(box(2, 0, 8, 10, 3.4, 8.5, TEX_PLASTER));
  half.push(box(-2, 2.6, 8, 2, 3.4, 8.5, TEX_PLASTER));
  // Marca del equipo en el piso del spawn: se ve, no choca.
  half.push({ ...box(-5, 0, 10.5, 5, 0.02, 14.5, TEX_T), decal: true });
  // Sacos de arena delante del portón y cajones para cubrirse al salir.
  half.push(sandbags(-1.3, 6, 1.3, 6.6));
  half.push(crate(-3.6, 6.2, 1.2));
  half.push(crate(3.8, 6.4, 1.2));
  half.push(crate(3.8, 6.4, 1.0, 1.2, TEX_WOOD));
  // Sacos en las esquinas de afuera de la casita.
  half.push(sandbags(-6.6, 4.4, -5.4, 5.4));
  half.push(sandbags(5.4, 4.4, 6.6, 5.4));

  // Calle izquierda: el garaje (x -21.9..-12, z 2..7), paredes de 0,3 y 3 m.
  const GX0 = -21.9;
  const GX1 = -12;
  const GZ0 = 2;
  const GZ1 = 7;
  const GH = 3;
  // Pared sur (hacia el spawn T), con la puerta en x -15.2..-13.4.
  half.push(box(GX0, 0, GZ1 - 0.3, -15.2, GH, GZ1, TEX_PLASTER));
  half.push(box(-13.4, 0, GZ1 - 0.3, GX1, GH, GZ1, TEX_PLASTER));
  half.push(box(-15.2, 2.3, GZ1 - 0.3, -13.4, GH, GZ1, TEX_PLASTER));
  // Pared norte (hacia los CT), con una ventana en x -18..-15.5, y 1.1..2.
  half.push(box(GX0, 0, GZ0, -18, GH, GZ0 + 0.3, TEX_PLASTER));
  half.push(box(-15.5, 0, GZ0, GX1, GH, GZ0 + 0.3, TEX_PLASTER));
  half.push(box(-18, 0, GZ0, -15.5, 1.1, GZ0 + 0.3, TEX_PLASTER));
  half.push(box(-18, 2.0, GZ0, -15.5, GH, GZ0 + 0.3, TEX_PLASTER));
  // Pared este (hacia el mid), con la puerta en z 3.4..5.2.
  half.push(box(GX1 - 0.3, 0, GZ0, GX1, GH, 3.4, TEX_PLASTER));
  half.push(box(GX1 - 0.3, 0, 5.2, GX1, GH, GZ1, TEX_PLASTER));
  half.push(box(GX1 - 0.3, 2.3, 3.4, GX1, GH, 5.2, TEX_PLASTER));
  // Techo caminable (con un alero hacia la escalera) y parapeto en los bordes
  // que dan al mid y a los CT.
  half.push(box(GX0, GH, GZ0, GX1, GH + 0.25, GZ1 + 0.3, TEX_ROOF));
  half.push(box(GX1 - 0.5, GH + 0.25, GZ0, GX1, GH + 0.8, GZ1, TEX_CONCRETE));
  half.push(box(GX0, GH + 0.25, GZ0, GX1 - 0.5, GH + 0.8, GZ0 + 0.5, TEX_CONCRETE));
  // Adentro: un cajón y barriles.
  half.push(crate(-19.2, 4.5, 1.2));
  half.push(barrel(-13.3, 3.1));
  half.push(barrel(-13.9, 3.6));
  // La escalera al techo, pegada al muro, de z 12 a z 7.2: 8 escalones de 60 x 37,5 cm.
  for (let i = 0; i < 8; i++) {
    half.push(box(GX0, 0, 12 - 0.6 * (i + 1), -20.4, 0.375 * (i + 1) + 0.05, 12 - 0.6 * i, TEX_METAL));
  }
  // Baranda de la escalera del lado de la calle, para no caerse (y cubrirse).
  half.push(box(-20.4, 0, 7.2, -20.25, 2.2, 12, TEX_METAL));
  // La calle: cajones apilados y sacos.
  half.push(crate(-13, 11.5, 1.4));
  half.push(crate(-13, 11.5, 1.2, 1.4, TEX_WOOD));
  half.push(sandbags(-18.5, 10.2, -15.5, 10.8));
  half.push(barrel(-11.3, 9.7));

  // Calle derecha: dos contenedores en zigzag.
  half.push(box(10, 0, 3.5, 16.5, 2.6, 6, TEX_CONTAINER_BLUE));
  half.push(box(15.2, 0, 9.4, 21.9, 2.6, 11.9, TEX_CONTAINER_RED));
  // Plataforma a 0,8 m con un escalón de 0,4: se sube caminando.
  half.push(box(18, 0, 1, 22, 0.8, 4.5, TEX_METAL));
  half.push(box(18, 0, 4.5, 22, 0.4, 5.5, TEX_METAL));
  // Barriles y cajones.
  half.push(barrel(20, 7.5));
  half.push(barrel(20.7, 8));
  half.push(barrel(19.5, 8.2));
  half.push(crate(12.5, 8.2, 1.2));
  half.push(crate(12.5, 8.2, 1.2, 1.2));
  half.push(crate(13.8, 8.2, 1.0));
  half.push(crate(19.2, 2.6, 1.0, 0.8, TEX_WOOD));
  half.push(barrel(21.5, 13.5));
  half.push(barrel(12.2, 13.2));

  for (const b of half) {
    boxes.push(b);
    boxes.push(mirror(b));
  }

  // La marca del piso de los CT.
  const ctMark = boxes.find((b) => b.tex === TEX_T && b.minZ < 0);
  if (ctMark) ctMark.tex = TEX_CT;

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
