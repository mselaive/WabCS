import * as THREE from "three";
import { AK47, AWP, DEAGLE, GLOCK, KNIFE, M4A4, MP5, NOVA, USP, weapon } from "@wabcs/shared";

/**
 * Armas hechas de cajas y cilindros, sin modelos externos. El caño apunta a -Z
 * (adelante en el espacio de la cámara), Y es arriba, X es la derecha. Las
 * medidas son en metros, más o menos las de verdad.
 */

interface Mat {
  color: number;
  metal?: number;
  rough?: number;
}

const POLYMER: Mat = { color: 0x24272c, metal: 0.15, rough: 0.7 };
const STEEL: Mat = { color: 0x3c424a, metal: 0.75, rough: 0.4 };
const STEEL_LIGHT: Mat = { color: 0x6c747e, metal: 0.8, rough: 0.35 };
const SILVER: Mat = { color: 0xb9b2a4, metal: 0.85, rough: 0.3 };
const WOOD: Mat = { color: 0x7d4b22, metal: 0, rough: 0.75 };
const WOOD_LIGHT: Mat = { color: 0x9a6230, metal: 0, rough: 0.75 };
const GREEN: Mat = { color: 0x4e5a3f, metal: 0.1, rough: 0.8 };
const TAN: Mat = { color: 0xb2a07c, metal: 0.4, rough: 0.5 };
const BLADE: Mat = { color: 0xd3dae2, metal: 0.95, rough: 0.2 };
const GLASS: Mat = { color: 0x7fb0ff, metal: 0.2, rough: 0.1 };
const SKIN: Mat = { color: 0xd9a877, metal: 0, rough: 0.9 };
const SLEEVE: Mat = { color: 0x35404b, metal: 0, rough: 0.95 };

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(m: Mat): THREE.MeshStandardMaterial {
  const key = `${m.color}-${m.metal ?? 0}-${m.rough ?? 0.5}`;
  let out = mats.get(key);
  if (!out) {
    out = new THREE.MeshStandardMaterial({ color: m.color, metalness: m.metal ?? 0, roughness: m.rough ?? 0.5 });
    mats.set(key, out);
  }
  return out;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: Mat, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(m));
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** Un cilindro a lo largo de Z (el caño), centrado en (x, y, z). */
function tube(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, m: Mat, segments = 10): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segments), mat(m));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** Un cilindro a lo largo de X (bulones, manijas). */
function pin(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, m: Mat): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat(m));
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function sights(g: THREE.Object3D, y: number, front: number, rear: number, m: Mat = STEEL): void {
  box(g, 0.006, 0.018, 0.008, 0, y, front, m);
  box(g, 0.022, 0.014, 0.01, 0, y - 0.003, rear, m);
}

function pistol(g: THREE.Group, slideMat: Mat, frameMat: Mat, len: number, tall: number): void {
  // Corredera, armazón, empuñadura inclinada, guardamonte, gatillo, caño.
  box(g, 0.03, tall, len, 0, 0.03, -len / 2 + 0.03, slideMat).name = "slide";
  box(g, 0.028, 0.025, len * 0.75, 0, 0.005, -len * 0.38 + 0.02, frameMat);
  box(g, 0.027, 0.11, 0.036, 0.0, -0.045, 0.012, frameMat, 0.22);
  box(g, 0.004, 0.028, 0.04, 0, -0.02, -0.03, frameMat);
  box(g, 0.004, 0.018, 0.005, 0, -0.012, -0.025, STEEL);
  tube(g, 0.006, 0.03, 0, 0.032, -len + 0.03, STEEL_LIGHT, 8);
  sights(g, 0.03 + tall / 2, -len + 0.045, 0.02);
}

/**
 * Un arma hecha de cajas y cilindros. `firstPerson` agrega las manos y la
 * manga, que en tercera persona ya las tiene el muñeco.
 */
export function buildWeaponMesh(id: number, firstPerson: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = `weapon-${id}`;
  let rightHand: [number, number, number] = [0, -0.06, 0.0];
  let leftHand: [number, number, number] | null = null;

  switch (id) {
    case KNIFE: {
      box(g, 0.028, 0.034, 0.12, 0, 0, 0.03, POLYMER);
      for (let i = 0; i < 4; i++) box(g, 0.03, 0.003, 0.012, 0, -0.01 + i * 0.008, 0.03, STEEL);
      box(g, 0.012, 0.05, 0.012, 0, 0, -0.035, STEEL);
      box(g, 0.005, 0.03, 0.2, 0, 0.004, -0.14, BLADE);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 4), mat(BLADE));
      tip.rotation.x = -Math.PI / 2;
      tip.scale.set(0.32, 1, 1);
      tip.position.set(0, 0.004, -0.27);
      g.add(tip);
      rightHand = [0, 0.0, 0.03];
      break;
    }
    case GLOCK:
      pistol(g, POLYMER, POLYMER, 0.19, 0.034);
      rightHand = [0, -0.06, 0.01];
      leftHand = [-0.045, -0.07, 0.01];
      break;
    case USP:
      pistol(g, STEEL, POLYMER, 0.2, 0.036);
      tube(g, 0.015, 0.11, 0, 0.032, -0.26, POLYMER, 12);
      rightHand = [0, -0.06, 0.01];
      leftHand = [-0.045, -0.07, 0.01];
      break;
    case DEAGLE:
      pistol(g, SILVER, TAN, 0.26, 0.046);
      box(g, 0.034, 0.012, 0.2, 0, 0.06, -0.09, SILVER);
      rightHand = [0, -0.06, 0.01];
      leftHand = [-0.048, -0.075, 0.01];
      break;
    case MP5: {
      box(g, 0.044, 0.06, 0.36, 0, 0.03, -0.1, POLYMER);
      tube(g, 0.021, 0.32, 0, 0.035, -0.41, POLYMER, 12);
      tube(g, 0.009, 0.06, 0, 0.035, -0.59, STEEL, 8);
      box(g, 0.046, 0.05, 0.14, 0, 0.012, -0.3, POLYMER);
      box(g, 0.024, 0.18, 0.046, 0, -0.06, -0.19, STEEL, 0.28).name = "mag";
      box(g, 0.028, 0.1, 0.04, 0, -0.045, 0.0, POLYMER, 0.25);
      box(g, 0.004, 0.026, 0.045, 0, -0.018, -0.07, POLYMER);
      tube(g, 0.012, 0.2, 0, 0.038, 0.18, STEEL, 8);
      box(g, 0.04, 0.07, 0.05, 0, 0.03, 0.3, POLYMER);
      box(g, 0.02, 0.05, 0.04, 0, 0.06, -0.24, POLYMER);
      sights(g, 0.07, -0.26, 0.04);
      rightHand = [0, -0.07, 0.0];
      leftHand = [0, 0.0, -0.33];
      break;
    }
    case AK47: {
      box(g, 0.044, 0.065, 0.3, 0, 0.03, -0.06, STEEL);
      box(g, 0.044, 0.02, 0.3, 0, 0.072, -0.06, STEEL_LIGHT);
      box(g, 0.046, 0.055, 0.2, 0, 0.02, -0.31, WOOD);
      tube(g, 0.013, 0.2, 0, 0.065, -0.31, STEEL, 8);
      tube(g, 0.009, 0.3, 0, 0.045, -0.55, STEEL, 8);
      box(g, 0.012, 0.03, 0.012, 0, 0.068, -0.62, STEEL);
      tube(g, 0.013, 0.05, 0, 0.045, -0.72, STEEL_LIGHT, 8);
      box(g, 0.03, 0.2, 0.06, 0, -0.065, -0.16, STEEL, 0.38).name = "mag";
      box(g, 0.03, 0.095, 0.042, 0, -0.045, 0.06, WOOD, 0.28);
      box(g, 0.004, 0.024, 0.04, 0, -0.016, -0.03, STEEL);
      box(g, 0.038, 0.062, 0.28, 0, 0.012, 0.23, WOOD_LIGHT, 0.06);
      box(g, 0.04, 0.085, 0.03, 0, -0.005, 0.37, WOOD, 0.06);
      pin(g, 0.006, 0.05, 0.025, 0.045, 0.0, STEEL_LIGHT);
      sights(g, 0.085, -0.62, -0.18);
      rightHand = [0, -0.07, 0.04];
      leftHand = [0, -0.01, -0.3];
      break;
    }
    case M4A4: {
      box(g, 0.044, 0.065, 0.3, 0, 0.03, -0.06, POLYMER);
      box(g, 0.044, 0.018, 0.3, 0, 0.07, -0.06, POLYMER);
      box(g, 0.046, 0.05, 0.24, 0, 0.028, -0.33, POLYMER);
      for (let i = 0; i < 4; i++) box(g, 0.05, 0.006, 0.24, 0, 0.0 + i * 0.019, -0.33, STEEL);
      tube(g, 0.008, 0.26, 0, 0.038, -0.58, STEEL, 8);
      tube(g, 0.011, 0.05, 0, 0.038, -0.7, STEEL_LIGHT, 8);
      box(g, 0.03, 0.17, 0.05, 0, -0.06, -0.12, POLYMER, 0.05).name = "mag";
      box(g, 0.03, 0.095, 0.042, 0, -0.045, 0.06, POLYMER, 0.28);
      box(g, 0.004, 0.024, 0.04, 0, -0.016, -0.03, STEEL);
      tube(g, 0.015, 0.2, 0, 0.045, 0.2, POLYMER, 8);
      box(g, 0.04, 0.08, 0.14, 0, 0.02, 0.3, POLYMER);
      // Mira de punto rojo.
      box(g, 0.03, 0.03, 0.05, 0, 0.1, -0.1, POLYMER);
      box(g, 0.026, 0.026, 0.004, 0, 0.1, -0.126, GLASS);
      box(g, 0.012, 0.03, 0.012, 0, 0.09, -0.44, STEEL);
      pin(g, 0.005, 0.06, 0.03, 0.05, 0.08, STEEL_LIGHT);
      rightHand = [0, -0.07, 0.04];
      leftHand = [0, -0.01, -0.32];
      break;
    }
    case NOVA: {
      box(g, 0.042, 0.062, 0.22, 0, 0.03, -0.05, STEEL);
      tube(g, 0.011, 0.56, 0, 0.055, -0.44, STEEL, 8);
      tube(g, 0.013, 0.46, 0, 0.022, -0.38, STEEL_LIGHT, 8);
      box(g, 0.044, 0.05, 0.13, 0, 0.022, -0.3, WOOD, 0, 0, 0).name = "pump";
      box(g, 0.03, 0.095, 0.042, 0, -0.04, 0.06, WOOD, 0.3);
      box(g, 0.004, 0.024, 0.04, 0, -0.014, -0.02, STEEL);
      box(g, 0.04, 0.066, 0.3, 0, 0.012, 0.22, WOOD_LIGHT, 0.08);
      box(g, 0.042, 0.095, 0.03, 0, -0.01, 0.36, POLYMER, 0.08);
      box(g, 0.012, 0.02, 0.012, 0, 0.072, -0.68, STEEL_LIGHT);
      rightHand = [0, -0.065, 0.04];
      leftHand = [0, -0.005, -0.3];
      break;
    }
    case AWP: {
      box(g, 0.044, 0.07, 0.32, 0, 0.03, -0.1, GREEN);
      tube(g, 0.016, 0.1, 0, 0.045, -0.3, STEEL, 8);
      tube(g, 0.011, 0.5, 0, 0.045, -0.58, STEEL, 8);
      tube(g, 0.015, 0.06, 0, 0.045, -0.85, STEEL_LIGHT, 8);
      box(g, 0.03, 0.08, 0.1, 0, -0.03, -0.1, STEEL).name = "mag";
      box(g, 0.03, 0.095, 0.042, 0, -0.045, 0.08, GREEN, 0.3);
      box(g, 0.004, 0.024, 0.04, 0, -0.016, 0.0, STEEL);
      box(g, 0.044, 0.07, 0.3, 0, 0.02, 0.22, GREEN, 0.04);
      box(g, 0.044, 0.03, 0.14, 0, 0.07, 0.24, GREEN);
      box(g, 0.046, 0.09, 0.03, 0, -0.01, 0.37, POLYMER, 0.04);
      // La mira telescópica.
      box(g, 0.012, 0.03, 0.03, 0, 0.085, -0.02, STEEL);
      box(g, 0.012, 0.03, 0.03, 0, 0.085, -0.2, STEEL);
      tube(g, 0.02, 0.28, 0, 0.115, -0.11, POLYMER, 12);
      tube(g, 0.026, 0.06, 0, 0.115, -0.25, POLYMER, 12);
      box(g, 0.04, 0.04, 0.004, 0, 0.115, -0.282, GLASS);
      tube(g, 0.022, 0.04, 0, 0.115, 0.03, POLYMER, 12);
      pin(g, 0.006, 0.06, 0.035, 0.045, 0.03, STEEL_LIGHT).name = "bolt";
      rightHand = [0, -0.07, 0.06];
      leftHand = [0, -0.005, -0.34];
      break;
    }
    case 9:
    case 10:
    case 11: {
      // La granada en la mano: se sostiene adelante, con la anilla.
      const gm = buildGrenadeMesh(id - 9);
      gm.position.set(0, 0.0, -0.05);
      g.add(gm);
      rightHand = [0, -0.04, 0.0];
      break;
    }
    default:
      box(g, 0.04, 0.06, 0.3, 0, 0, -0.1, POLYMER);
  }

  if (firstPerson) {
    // Mano derecha en la empuñadura y la manga que sale hacia la cámara. Van
    // en grupos con nombre: la izquierda saca el cargador y bombea, la derecha
    // trabaja el cerrojo.
    const [hx, hy, hz] = rightHand;
    const rh = new THREE.Group();
    rh.name = "rhand";
    g.add(rh);
    box(rh, 0.065, 0.075, 0.07, hx + 0.012, hy, hz, SKIN, 0.2);
    // Los dedos: cuatro cajitas que envuelven la empuñadura.
    for (let i = 0; i < 4; i++) box(rh, 0.016, 0.014, 0.05, hx - 0.018, hy + 0.024 - i * 0.016, hz - 0.012, SKIN, 0.2);
    box(rh, 0.075, 0.08, 0.28, hx + 0.03, hy - 0.08, hz + 0.2, SLEEVE, 0.35);
    if (leftHand) {
      const [lx, ly, lz] = leftHand;
      const lh = new THREE.Group();
      lh.name = "lhand";
      g.add(lh);
      box(lh, 0.07, 0.06, 0.08, lx - 0.01, ly - 0.03, lz, SKIN, 0, 0, 0.2);
      for (let i = 0; i < 4; i++) box(lh, 0.014, 0.016, 0.05, lx + 0.028, ly - 0.012, lz - 0.03 + i * 0.016, SKIN, 0, 0, 0.2);
      box(lh, 0.075, 0.08, 0.26, lx - 0.12, ly - 0.15, lz + 0.14, SLEEVE, 0.55, -0.35, 0);
    }
  }
  return g;
}

/** Una granada en el mundo: la HE verde y redonda, la flash y el humo cilíndricos. */
export function buildGrenadeMesh(kind: number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 0) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mat(GREEN));
    g.add(body);
    tube(g, 0.02, 0.03, 0, 0.08, 0, STEEL_LIGHT, 8);
  } else {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10), mat(kind === 1 ? STEEL_LIGHT : { color: 0x6d7a6d, metal: 0.3, rough: 0.6 }));
    g.add(body);
    tube(g, 0.02, 0.03, 0, 0.085, 0, STEEL, 8);
    if (kind === 2) box(g, 0.04, 0.03, 0.04, 0, -0.04, 0, { color: 0xb8b0a0, metal: 0.4, rough: 0.5 });
  }
  return g;
}

/** Dónde queda la punta del caño, en el espacio del arma (para el fogonazo). */
export function muzzleOffset(id: number): THREE.Vector3 {
  switch (id) {
    case KNIFE:
    case 9:
    case 10:
    case 11:
      return new THREE.Vector3(0, 0, -0.3);
    case GLOCK:
      return new THREE.Vector3(0, 0.032, -0.2);
    case USP:
      return new THREE.Vector3(0, 0.032, -0.32);
    case DEAGLE:
      return new THREE.Vector3(0, 0.032, -0.26);
    case MP5:
      return new THREE.Vector3(0, 0.035, -0.62);
    case AK47:
      return new THREE.Vector3(0, 0.045, -0.75);
    case M4A4:
      return new THREE.Vector3(0, 0.038, -0.73);
    case NOVA:
      return new THREE.Vector3(0, 0.055, -0.72);
    case AWP:
      return new THREE.Vector3(0, 0.045, -0.88);
    default:
      return new THREE.Vector3(0, 0, -0.3);
  }
}

/**
 * El arma en la mano, en el espacio de la cámara: balanceo al caminar,
 * retroceso al disparar, bajar para recargar, salir de abajo al cambiar.
 */
function easeOut(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - (1 - k) * (1 - k);
}

function smooth(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/**
 * El arma en la mano, en el espacio de la cámara, con sus animaciones: sale
 * de abajo al cambiar, se balancea al caminar y se queda un poco atrás al
 * girar, patea al disparar (y la corredera o el cerrojo se mueven), el
 * cargador sale y entra al recargar, el cuchillo da el tajo.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private current = -1;
  private mesh: THREE.Group | null = null;
  private mag: THREE.Object3D | null = null;
  private magHome = new THREE.Vector3();
  private slide: THREE.Object3D | null = null;
  private slideHome = new THREE.Vector3();
  private bolt: THREE.Object3D | null = null;
  private boltHome = new THREE.Vector3();
  private pump: THREE.Object3D | null = null;
  private pumpHome = new THREE.Vector3();
  private lhand: THREE.Object3D | null = null;
  private lhandHome = new THREE.Vector3();
  private rhand: THREE.Object3D | null = null;
  private rhandHome = new THREE.Vector3();
  private readonly flash: THREE.Mesh;
  private flashLeft = 0;
  private kick = 0;
  private kickSide = 0;
  private slideT = 0;
  private cycleT = 0;
  private cycleTotal = 0.45;
  private bob = 0;
  private swayX = 0;
  private swayY = 0;
  private drawT = 0;
  private drawTotal = 0.3;
  private reloadT = 0;
  private reloadTotal = 1;
  private wasReloading = false;
  private knifeT = 0;
  private inspectT = 0;
  private readonly inspectTotal = 1.7;
  private landDip = 0;
  private hidden = false;
  private time = 0;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    // A la derecha y abajo, apuntando un poco hacia el centro: como se sostiene.
    this.root.position.set(0.19, -0.15, -0.32);
    this.root.rotation.set(0.05, 0.1, 0.03);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), flashMat);
    this.flash.visible = false;
    this.root.add(this.flash);
  }

  setWeapon(id: number): void {
    if (id === this.current) return;
    if (this.mesh) this.root.remove(this.mesh);
    this.mesh = buildWeaponMesh(id, true);
    this.root.add(this.mesh);
    this.current = id;
    const find = (name: string, home: THREE.Vector3): THREE.Object3D | null => {
      const o = this.mesh!.getObjectByName(name) ?? null;
      if (o) home.copy(o.position);
      return o;
    };
    this.mag = find("mag", this.magHome);
    this.slide = find("slide", this.slideHome);
    this.bolt = find("bolt", this.boltHome);
    this.pump = find("pump", this.pumpHome);
    this.lhand = find("lhand", this.lhandHome);
    this.rhand = find("rhand", this.rhandHome);
    this.drawTotal = Math.max(0.15, weapon(id).drawTicks * 0.05);
    this.drawT = this.drawTotal;
    this.reloadT = 0;
    this.knifeT = 0;
    this.inspectT = 0;
    this.cycleT = 0;
    this.flash.position.copy(muzzleOffset(id));
  }

  get weaponId(): number {
    return this.current;
  }

  setHidden(h: boolean): void {
    this.hidden = h;
    this.root.visible = !h;
  }

  /** Un tiro salió: retroceso, fogonazo, corredera; el cerrojo o la bomba después. */
  /** Mirar el arma (F): la da vuelta para mostrar el costado; el cuchillo da una vuelta entera. */
  inspect(): void {
    if (this.hidden || this.reloadT > 0 || this.drawT > 0 || this.inspectT > 0) return;
    this.inspectT = this.inspectTotal;
  }

  fire(): void {
    this.inspectT = 0;
    const w = weapon(this.current);
    if (w.melee > 0 || this.current >= 9) {
      // El tajo del cuchillo, o el brazo que tira la granada: el mismo movimiento.
      this.knifeT = 0.28;
      return;
    }
    this.kick = Math.min(1, this.kick + 0.45 + w.kick * 5);
    this.kickSide = (Math.random() - 0.5) * 0.03;
    this.flashLeft = 0.05;
    this.slideT = 1;
    if (this.bolt || this.pump) {
      this.cycleTotal = Math.min(0.9, Math.max(0.3, w.fireTicks * 0.05 * 0.6));
      this.cycleT = this.cycleTotal;
    }
  }

  reload(totalSeconds: number): void {
    this.inspectT = 0;
    this.reloadTotal = Math.max(0.4, totalSeconds);
    this.reloadT = this.reloadTotal;
  }

  /** Acaba de caer al piso: el arma se hunde un poco. */
  land(strength: number): void {
    this.landDip = Math.min(1, this.landDip + strength);
  }

  /** Dónde sale la vaina, en el mundo (la ventana de expulsión, a la derecha del arma). */
  ejectPoint(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    out.set(0.03, 0.04, -0.12).add(this.root.position);
    camera.updateMatrixWorld();
    return camera.localToWorld(out);
  }

  /**
   * `speed` en m/s, `dt` en segundos, `lookDx`/`lookDy` lo que giró la cámara
   * en este cuadro (radianes), para que el arma se quede un poco atrás.
   */
  update(dt: number, speed: number, onGround: boolean, reloading: boolean, lookDx = 0, lookDy = 0): void {
    if (this.hidden || !this.mesh) return;
    this.time += dt;
    const w = weapon(this.current);

    // Balanceo al caminar (un ocho acostado) y respiración quieto.
    this.bob += dt * (onGround ? Math.min(speed, 6) * 2.3 : 0.8);
    const amp = onGround ? Math.min(speed / 5, 1) * 0.014 : 0.004;
    const bx = Math.sin(this.bob) * amp;
    const by = -Math.abs(Math.cos(this.bob)) * amp * 0.8;
    const idleX = Math.sin(this.time * 1.3) * 0.0025;
    const idleY = Math.sin(this.time * 2.1) * 0.002;

    // Se queda atrás cuando girás.
    const k = 1 - Math.exp(-dt * 14);
    this.swayX += (-lookDx * 0.5 - this.swayX) * k;
    this.swayY += (-lookDy * 0.5 - this.swayY) * k;
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX));
    this.swayY = Math.max(-0.06, Math.min(0.06, this.swayY));

    this.kick = Math.max(0, this.kick - dt * 8);
    this.slideT = Math.max(0, this.slideT - dt * 12);
    this.landDip = Math.max(0, this.landDip - dt * 5);
    const kk = this.kick;

    // Sacar el arma: sube desde abajo, girando.
    this.drawT = Math.max(0, this.drawT - dt);
    const drawK = 1 - easeOut(1 - this.drawT / this.drawTotal);

    // Recargar: el arma se inclina, el cargador sale, vuelve a entrar, y un golpe final.
    if (reloading && !this.wasReloading && this.reloadT <= 0) this.reload(w.reloadTicks * 0.05);
    this.wasReloading = reloading;
    if (!reloading) this.reloadT = 0;
    else this.reloadT = Math.max(0, this.reloadT - dt);
    const rt = reloading ? 1 - this.reloadT / this.reloadTotal : 0;
    let tiltX = 0;
    let tiltZ = 0;
    let dropY = 0;
    // Lo que se corren las manos respecto de donde agarran el arma.
    let lhX = 0;
    let lhY = 0;
    let lhZ = 0;
    let rhY = 0;
    let rhZ = 0;
    if (reloading) {
      const inOut = Math.sin(Math.PI * Math.min(1, rt));
      tiltZ = 0.4 * inOut;
      tiltX = 0.18 * inOut;
      dropY = -0.06 * inOut;
      if (this.mag) {
        let magOff = 0;
        let visible = true;
        if (rt < 0.3) magOff = -0.3 * smooth((rt - 0.08) / 0.22);
        else if (rt < 0.55) visible = false;
        else if (rt < 0.85) magOff = -0.3 * (1 - smooth((rt - 0.55) / 0.3));
        this.mag.visible = visible;
        this.mag.position.set(this.magHome.x, this.magHome.y + magOff, this.magHome.z + (visible ? magOff * 0.3 : 0));
        // La mano izquierda saca el cargador, baja a buscar el otro y lo trae.
        lhY = visible ? magOff : -0.3;
        lhZ = (visible ? magOff * 0.3 : -0.09) + 0.04 * inOut;
        lhX = -0.03 * inOut;
      } else {
        // Sin cargador (la escopeta): la mano mete los cartuchos de a uno.
        lhY = -0.07 * Math.abs(Math.sin(rt * Math.PI * 4)) - 0.03 * inOut;
        lhZ = 0.1 * inOut;
      }
      // El golpe final (cerrojo o palmada al cargador).
      if (rt > 0.85) tiltX += -0.12 * Math.sin(Math.PI * (rt - 0.85) / 0.15);
    } else if (this.mag) {
      this.mag.visible = true;
      this.mag.position.copy(this.magHome);
    }

    // Corredera de la pistola: atrás con el tiro.
    if (this.slide) this.slide.position.set(this.slideHome.x, this.slideHome.y, this.slideHome.z + 0.035 * this.slideT);
    // Cerrojo del AWP y bomba de la escopeta: un ciclo después del tiro.
    let cycleTilt = 0;
    if (this.cycleT > 0) {
      this.cycleT = Math.max(0, this.cycleT - dt);
      const c = 1 - this.cycleT / this.cycleTotal;
      const back = Math.sin(Math.PI * Math.min(1, Math.max(0, (c - 0.15) / 0.7)));
      if (this.bolt) {
        this.bolt.position.set(this.boltHome.x, this.boltHome.y + 0.03 * back, this.boltHome.z + 0.06 * back);
        cycleTilt = 0.08 * back;
        // La derecha suelta la empuñadura y trabaja el cerrojo.
        rhY = 0.05 * back;
        rhZ = 0.04 * back;
      }
      if (this.pump) {
        this.pump.position.set(this.pumpHome.x, this.pumpHome.y, this.pumpHome.z + 0.09 * back);
        lhZ += 0.09 * back;
      }
    } else {
      if (this.bolt) this.bolt.position.copy(this.boltHome);
      if (this.pump) this.pump.position.copy(this.pumpHome);
    }

    if (this.lhand) this.lhand.position.set(this.lhandHome.x + lhX, this.lhandHome.y + lhY, this.lhandHome.z + lhZ);
    if (this.rhand) this.rhand.position.set(this.rhandHome.x, this.rhandHome.y + rhY, this.rhandHome.z + rhZ);

    // El tajo del cuchillo.
    let knifeX = 0;
    let knifeZ = 0;
    let knifeRot = 0;
    if (this.knifeT > 0) {
      this.knifeT = Math.max(0, this.knifeT - dt);
      const t = 1 - this.knifeT / 0.28;
      const s = Math.sin(Math.PI * t);
      knifeRot = -0.9 * s;
      knifeZ = -0.12 * s;
      knifeX = -0.06 * s;
    }

    // Inspeccionar: el arma se levanta y gira para mostrar el costado, y vuelve; el cuchillo da una vuelta.
    let insX = 0;
    let insY = 0;
    let insZ = 0;
    let insRX = 0;
    let insRY = 0;
    let insRZ = 0;
    if (this.inspectT > 0) {
      this.inspectT = Math.max(0, this.inspectT - dt);
      const t = 1 - this.inspectT / this.inspectTotal;
      const s = Math.sin(Math.PI * t);
      if (w.melee > 0) {
        insRX = -Math.PI * 2 * smooth(Math.min(1, Math.max(0, (t - 0.15) / 0.6)));
        insRZ = 0.5 * s;
        insY = 0.05 * s;
        insZ = -0.06 * s;
      } else {
        insRY = -1.05 * s;
        insRX = 0.3 * s;
        insRZ = 0.3 * s;
        insX = -0.11 * s;
        insY = 0.04 * s;
        insZ = -0.07 * s;
      }
    }

    this.mesh.position.set(
      bx + idleX + this.swayX + this.kickSide * kk + knifeX + insX,
      by + idleY + this.swayY * 0.6 - drawK * 0.35 - this.landDip * 0.05 + dropY + insY,
      kk * 0.05 + knifeZ + insZ,
    );
    this.mesh.rotation.set(
      -kk * 0.14 + drawK * 1.1 + tiltX + knifeRot + cycleTilt + this.landDip * 0.08 + insRX,
      this.swayX * 0.8 + drawK * 0.25 + insRY,
      this.kickSide * kk * 2 + tiltZ + insRZ,
    );

    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      this.flash.visible = true;
      this.flash.scale.setScalar(0.8 + Math.random() * 0.6);
      this.flash.position.copy(muzzleOffset(this.current)).add(this.mesh.position);
    } else {
      this.flash.visible = false;
    }
  }
}
