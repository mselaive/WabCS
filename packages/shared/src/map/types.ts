/**
 * Un mapa es una lista de cajas alineadas a los ejes. Con eso alcanza para
 * paredes, cajones, plataformas y escalones, y las colisiones y los rayos
 * salen baratos y deterministas: no hay motor de física, ni hace falta.
 */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Qué textura va (ver TEX_*). Sólo le importa al cliente. */
  tex: number;
  /**
   * Una calcomanía: se dibuja pero no choca ni frena balas (las marcas de
   * color del piso). El cliente la levanta unos milímetros para que no parpadee.
   */
  decal?: boolean;
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  /** Hacia dónde mira al aparecer (radianes). */
  yaw: number;
}

export interface GameMap {
  name: string;
  boxes: Box[];
  /** Puntos de aparición por equipo: [T, CT]. */
  spawns: [Spawn[], Spawn[]];
  /** Centro de cada zona de compra: [T, CT]. */
  buyCenter: [{ x: number; z: number }, { x: number; z: number }];
  /** Hasta dónde llega el mundo (para la cámara libre y para no caerse al infinito). */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Color del cielo, para el cliente. */
  sky: number;
}

/** Texturas de prototipo: cada una es un color con grilla, generada por código. */
export const TEX_FLOOR = 0;
export const TEX_WALL = 1;
export const TEX_CRATE = 2;
export const TEX_METAL = 3;
export const TEX_T = 4;
export const TEX_CT = 5;
export const TEX_CONCRETE = 6;
export const TEX_WOOD = 7;
export const TEX_ROOF = 8;
export const TEX_COUNT = 9;
