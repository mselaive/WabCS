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
  /**
   * Cómo se dibuja: una caja, o un cilindro vertical inscripto en ella (los
   * barriles). La colisión y las balas siguen usando la caja: en un barril de
   * 60 cm la diferencia en las esquinas es de 12 cm y no se nota.
   */
  shape?: "box" | "cyl";
}

export interface Spawn {
  x: number;
  y: number;
  z: number;
  /** Hacia dónde mira al aparecer (radianes). */
  yaw: number;
}

/** Un sitio donde plantar la bomba: un rectángulo del piso. */
export interface BombSite {
  name: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface GameMap {
  name: string;
  boxes: Box[];
  /** Puntos de aparición por equipo: [T, CT]. */
  spawns: [Spawn[], Spawn[]];
  /** Los sitios de la bomba (A y B), del lado de los CT. */
  sites: BombSite[];
  /** Centro de cada zona de compra: [T, CT]. */
  buyCenter: [{ x: number; z: number }, { x: number; z: number }];
  /** Hasta dónde llega el mundo (para la cámara libre y para no caerse al infinito). */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  /** Color del cielo, para el cliente. */
  sky: number;
}

/** Texturas: cada una se genera por código en el cliente (render/textures.ts). */
export const TEX_FLOOR = 0;
export const TEX_WALL = 1;
export const TEX_CRATE = 2;
export const TEX_METAL = 3;
export const TEX_T = 4;
export const TEX_CT = 5;
export const TEX_CONCRETE = 6;
export const TEX_WOOD = 7;
export const TEX_ROOF = 8;
export const TEX_ASPHALT = 9;
export const TEX_BRICK = 10;
export const TEX_PLASTER = 11;
export const TEX_CONTAINER_BLUE = 12;
export const TEX_CONTAINER_RED = 13;
export const TEX_SANDBAG = 14;
export const TEX_BARREL = 15;
/** Rayas amarillas y negras: el piso de los sitios de la bomba. */
export const TEX_SITE = 16;
/** Adoquines grises: el piso de una plaza. */
export const TEX_PAVERS = 17;
export const TEX_COUNT = 18;
