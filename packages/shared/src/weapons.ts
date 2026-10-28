import { TEAM_CT, TEAM_T } from "./constants.js";

/**
 * Ranuras: 0 principal (rifles, subfusil, escopeta, francotirador), 1 pistola,
 * 2 cuchillo, 3 la granada que se tiene en la mano (las cantidades van aparte).
 */
export const SLOT_PRIMARY = 0;
export const SLOT_SECONDARY = 1;
export const SLOT_KNIFE = 2;
export const SLOT_GRENADE = 3;

export interface WeaponDef {
  id: number;
  name: string;
  /** Nombre corto para el HUD y el kill feed. */
  short: string;
  slot: number;
  price: number;
  /** -1 la compran los dos equipos; si no, sólo ese. */
  team: number;
  damage: number;
  /** Factor de daño cada 10 m: 0,98 casi no pierde, 0,45 (escopeta) pierde casi todo. */
  range: number;
  /** Cuánto atraviesa el chaleco (0 a 1, como en CS). */
  pen: number;
  mag: number;
  reserve: number;
  /** Ticks entre tiros (50 ms cada uno). */
  fireTicks: number;
  reloadTicks: number;
  /** Ticks que tarda sacarla al cambiar. */
  drawTicks: number;
  /** Mantener apretado sigue disparando. */
  auto: boolean;
  /** Perdigones por tiro (la escopeta). */
  pellets: number;
  /** Dispersión base (radianes) parado y quieto. */
  spread: number;
  /** Dispersión que agrega cada tiro seguido. */
  spreadShot: number;
  /** Dispersión que agrega moverse a toda velocidad. */
  spreadMove: number;
  /** Grosor de pared (m) que la bala todavía atraviesa; 0, ninguno. */
  wall: number;
  /** Velocidad máxima con ella en la mano (m/s). */
  speed: number;
  /** 0 sin mira; si no, el factor de zoom (la dispersión con mira es casi nula). */
  zoom: number;
  /** Sacudida de la cámara por tiro (radianes), para el cliente. */
  kick: number;
  /**
   * Patrón de retroceso: cuánto sube la bala (radianes) con el cargador
   * seguido, y cuánto zigzaguea a los costados. Es determinista: el que lo
   * aprende lo compensa tirando el mouse hacia abajo, como en CS.
   */
  recoilUp: number;
  recoilSide: number;
  /** Alcance del cuchillo (m); 0 para las armas de fuego. */
  melee: number;
}

const W = (d: WeaponDef): WeaponDef => d;

export const WEAPONS: readonly WeaponDef[] = [
  W({
    id: 0, name: "Cuchillo", short: "Cuchillo", slot: SLOT_KNIFE, price: 0, team: -1,
    damage: 45, range: 1, pen: 0.85, mag: 0, reserve: 0, fireTicks: 10, reloadTicks: 0, drawTicks: 4,
    auto: true, pellets: 1, spread: 0, spreadShot: 0, spreadMove: 0, speed: 5.2, zoom: 0, kick: 0, recoilUp: 0, recoilSide: 0, melee: 1.3, wall: 0,
  }),
  W({
    id: 1, name: "Glock-18", short: "Glock", slot: SLOT_SECONDARY, price: 200, team: TEAM_T,
    damage: 28, range: 0.82, pen: 0.47, mag: 20, reserve: 120, fireTicks: 3, reloadTicks: 44, drawTicks: 6,
    auto: false, pellets: 1, spread: 0.011, spreadShot: 0.006, spreadMove: 0.035, speed: 5.0, zoom: 0, kick: 0.012, recoilUp: 0.03, recoilSide: 0.012, melee: 0, wall: 0.08,
  }),
  W({
    id: 2, name: "USP-S", short: "USP", slot: SLOT_SECONDARY, price: 200, team: TEAM_CT,
    damage: 35, range: 0.84, pen: 0.505, mag: 12, reserve: 24, fireTicks: 3, reloadTicks: 44, drawTicks: 6,
    auto: false, pellets: 1, spread: 0.009, spreadShot: 0.006, spreadMove: 0.035, speed: 5.0, zoom: 0, kick: 0.014, recoilUp: 0.03, recoilSide: 0.012, melee: 0, wall: 0.08,
  }),
  W({
    id: 3, name: "Desert Eagle", short: "Deagle", slot: SLOT_SECONDARY, price: 700, team: -1,
    damage: 53, range: 0.86, pen: 0.932, mag: 7, reserve: 35, fireTicks: 4, reloadTicks: 44, drawTicks: 6,
    auto: false, pellets: 1, spread: 0.013, spreadShot: 0.02, spreadMove: 0.05, speed: 4.8, zoom: 0, kick: 0.03, recoilUp: 0.07, recoilSide: 0.03, melee: 0, wall: 0.32,
  }),
  W({
    id: 4, name: "MP5-SD", short: "MP5", slot: SLOT_PRIMARY, price: 1500, team: -1,
    damage: 27, range: 0.86, pen: 0.57, mag: 30, reserve: 120, fireTicks: 2, reloadTicks: 52, drawTicks: 8,
    auto: true, pellets: 1, spread: 0.008, spreadShot: 0.0022, spreadMove: 0.03, speed: 5.0, zoom: 0, kick: 0.008, recoilUp: 0.05, recoilSide: 0.02, melee: 0, wall: 0.16,
  }),
  W({
    id: 5, name: "AK-47", short: "AK-47", slot: SLOT_PRIMARY, price: 2700, team: TEAM_T,
    damage: 36, range: 0.98, pen: 0.775, mag: 30, reserve: 90, fireTicks: 2, reloadTicks: 50, drawTicks: 8,
    auto: true, pellets: 1, spread: 0.0045, spreadShot: 0.0042, spreadMove: 0.06, speed: 4.6, zoom: 0, kick: 0.016, recoilUp: 0.11, recoilSide: 0.045, melee: 0, wall: 0.4,
  }),
  W({
    id: 6, name: "M4A4", short: "M4A4", slot: SLOT_PRIMARY, price: 3100, team: TEAM_CT,
    damage: 33, range: 0.97, pen: 0.7, mag: 30, reserve: 90, fireTicks: 2, reloadTicks: 62, drawTicks: 8,
    auto: true, pellets: 1, spread: 0.004, spreadShot: 0.0036, spreadMove: 0.055, speed: 4.8, zoom: 0, kick: 0.013, recoilUp: 0.085, recoilSide: 0.035, melee: 0, wall: 0.35,
  }),
  W({
    id: 7, name: "Nova", short: "Nova", slot: SLOT_PRIMARY, price: 1050, team: -1,
    damage: 26, range: 0.5, pen: 0.5, mag: 8, reserve: 32, fireTicks: 18, reloadTicks: 60, drawTicks: 8,
    auto: false, pellets: 9, spread: 0.045, spreadShot: 0.01, spreadMove: 0.03, speed: 4.6, zoom: 0, kick: 0.045, recoilUp: 0.02, recoilSide: 0.01, melee: 0, wall: 0,
  }),
  W({
    id: 8, name: "AWP", short: "AWP", slot: SLOT_PRIMARY, price: 4750, team: -1,
    damage: 115, range: 0.99, pen: 0.975, mag: 5, reserve: 30, fireTicks: 30, reloadTicks: 74, drawTicks: 12,
    auto: false, pellets: 1, spread: 0.09, spreadShot: 0.02, spreadMove: 0.08, speed: 4.0, zoom: 4, kick: 0.06, recoilUp: 0.02, recoilSide: 0.0, melee: 0, wall: 0.6,
  }),
  // Las granadas: "disparar" es tirarla. El daño de la HE está en HE_DAMAGE.
  W({
    id: 9, name: "Granada HE", short: "HE", slot: SLOT_GRENADE, price: 300, team: -1,
    damage: 0, range: 1, pen: 0.5, mag: 0, reserve: 0, fireTicks: 16, reloadTicks: 0, drawTicks: 8,
    auto: false, pellets: 1, spread: 0, spreadShot: 0, spreadMove: 0, speed: 5.0, zoom: 0, kick: 0, recoilUp: 0, recoilSide: 0, melee: 0, wall: 0,
  }),
  W({
    id: 10, name: "Flash", short: "Flash", slot: SLOT_GRENADE, price: 200, team: -1,
    damage: 0, range: 1, pen: 0.5, mag: 0, reserve: 0, fireTicks: 16, reloadTicks: 0, drawTicks: 8,
    auto: false, pellets: 1, spread: 0, spreadShot: 0, spreadMove: 0, speed: 5.0, zoom: 0, kick: 0, recoilUp: 0, recoilSide: 0, melee: 0, wall: 0,
  }),
  W({
    id: 11, name: "Humo", short: "Humo", slot: SLOT_GRENADE, price: 300, team: -1,
    damage: 0, range: 1, pen: 0.5, mag: 0, reserve: 0, fireTicks: 16, reloadTicks: 0, drawTicks: 8,
    auto: false, pellets: 1, spread: 0, spreadShot: 0, spreadMove: 0, speed: 5.0, zoom: 0, kick: 0, recoilUp: 0, recoilSide: 0, melee: 0, wall: 0,
  }),
];

export const HE_GRENADE = 9;
export const FLASHBANG = 10;
export const SMOKE_GRENADE = 11;
/** Tipo de granada (0 HE, 1 flash, 2 humo) a partir del id del arma, o -1. */
export function grenadeKind(id: number): number {
  return id >= HE_GRENADE && id <= SMOKE_GRENADE ? id - HE_GRENADE : -1;
}
export function isGrenade(id: number): boolean {
  return grenadeKind(id) >= 0;
}

export const KNIFE = 0;
export const GLOCK = 1;
export const USP = 2;
export const DEAGLE = 3;
export const MP5 = 4;
export const AK47 = 5;
export const M4A4 = 6;
export const NOVA = 7;
export const AWP = 8;

export function weapon(id: number): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[KNIFE]!;
}

/** La pistola con la que arranca cada equipo (y la que se da al que no tiene). */
export function defaultPistol(team: number): number {
  return team === TEAM_T ? GLOCK : USP;
}

/** Lo que se compra con `ACT_BUY_BASE + índice`. Las armas, más chaleco y casco. */
export interface BuyItem {
  key: string;
  name: string;
  price: number;
  /** Arma (id) o -1 para chaleco/casco. */
  weapon: number;
  /** -1 para todos; si no, sólo ese equipo. */
  team: number;
  armor?: "kevlar" | "helmet";
  /** Una granada: el tipo (0 HE, 1 flash, 2 humo). */
  grenade?: number;
  /** El kit de desactivación (CT, modo bomba). */
  kit?: boolean;
}

export const BUY_ITEMS: readonly BuyItem[] = [
  { key: "glock", name: "Glock-18", price: 200, weapon: GLOCK, team: TEAM_T },
  { key: "usp", name: "USP-S", price: 200, weapon: USP, team: TEAM_CT },
  { key: "deagle", name: "Desert Eagle", price: 700, weapon: DEAGLE, team: -1 },
  { key: "mp5", name: "MP5-SD", price: 1500, weapon: MP5, team: -1 },
  { key: "nova", name: "Nova", price: 1050, weapon: NOVA, team: -1 },
  { key: "ak", name: "AK-47", price: 2700, weapon: AK47, team: TEAM_T },
  { key: "m4", name: "M4A4", price: 3100, weapon: M4A4, team: TEAM_CT },
  { key: "awp", name: "AWP", price: 4750, weapon: AWP, team: -1 },
  { key: "kevlar", name: "Chaleco", price: 650, weapon: -1, team: -1, armor: "kevlar" },
  { key: "helmet", name: "Chaleco y casco", price: 1000, weapon: -1, team: -1, armor: "helmet" },
  { key: "he", name: "Granada HE", price: 300, weapon: -1, team: -1, grenade: 0 },
  { key: "flash", name: "Flash", price: 200, weapon: -1, team: -1, grenade: 1 },
  { key: "smoke", name: "Humo", price: 300, weapon: -1, team: -1, grenade: 2 },
  { key: "kit", name: "Kit de desactivación", price: 400, weapon: -1, team: TEAM_CT, kit: true },
];

export function buyItemIndex(key: string): number {
  return BUY_ITEMS.findIndex((b) => b.key === key);
}
