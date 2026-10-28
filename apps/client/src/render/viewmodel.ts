import * as THREE from "three";
import { AK47, AWP, DEAGLE, GLOCK, KNIFE, M4A4, MP5, NOVA, USP, weapon } from "@wabcs/shared";

const GUN_DARK = 0x2b2f35;
const GUN_METAL = 0x4a515b;
const GUN_WOOD = 0x8a5a2b;
const GUN_GREEN = 0x5d6b4a;
const GUN_TAN = 0xb3a07e;
const BLADE = 0xc9d2dc;

const mats = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, metal = 0.3): THREE.MeshStandardMaterial {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: metal });
    mats.set(color, m);
  }
  return m;
}

function part(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

/**
 * Un arma hecha de cajas. El caño apunta a -Z (hacia adelante en el espacio
 * de la cámara). `firstPerson` deja el mango un poco más largo y marca el
 * punto del fogonazo.
 */
export function buildWeaponMesh(id: number, firstPerson: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = `weapon-${id}`;
  switch (id) {
    case KNIFE:
      part(g, 0.03, 0.03, 0.12, 0, 0, 0.02, GUN_DARK);
      part(g, 0.008, 0.035, 0.22, 0, 0.005, -0.15, BLADE);
      break;
    case GLOCK:
    case USP:
      part(g, 0.035, 0.055, 0.2, 0, 0.03, -0.08, id === USP ? GUN_DARK : GUN_METAL);
      part(g, 0.03, 0.11, 0.045, 0, -0.045, 0.0, GUN_DARK);
      if (id === USP) part(g, 0.03, 0.03, 0.09, 0, 0.035, -0.22, GUN_DARK); // silenciador
      part(g, 0.012, 0.012, 0.04, 0, 0.005, -0.03, GUN_METAL);
      break;
    case DEAGLE:
      part(g, 0.04, 0.065, 0.26, 0, 0.035, -0.1, GUN_TAN);
      part(g, 0.034, 0.12, 0.05, 0, -0.045, 0.0, GUN_DARK);
      part(g, 0.016, 0.016, 0.03, 0, 0.0, -0.03, GUN_METAL);
      break;
    case MP5:
      part(g, 0.05, 0.07, 0.42, 0, 0.03, -0.12, GUN_DARK);
      part(g, 0.03, 0.03, 0.22, 0, 0.035, -0.42, GUN_METAL);
      part(g, 0.035, 0.12, 0.05, 0, -0.05, 0.0, GUN_DARK);
      part(g, 0.03, 0.16, 0.04, 0, -0.07, -0.16, GUN_METAL);
      part(g, 0.05, 0.05, 0.22, 0, 0.03, 0.22, GUN_DARK);
      break;
    case AK47:
      part(g, 0.05, 0.075, 0.5, 0, 0.03, -0.12, GUN_METAL);
      part(g, 0.022, 0.022, 0.3, 0, 0.045, -0.5, GUN_DARK);
      part(g, 0.045, 0.06, 0.18, 0, 0.0, -0.3, GUN_WOOD);
      part(g, 0.035, 0.11, 0.05, 0, -0.05, 0.02, GUN_WOOD);
      part(g, 0.03, 0.17, 0.05, 0, -0.08, -0.14, GUN_METAL);
      part(g, 0.045, 0.06, 0.26, 0, 0.02, 0.26, GUN_WOOD);
      break;
    case M4A4:
      part(g, 0.05, 0.075, 0.5, 0, 0.03, -0.12, GUN_DARK);
      part(g, 0.022, 0.022, 0.3, 0, 0.045, -0.5, GUN_METAL);
      part(g, 0.03, 0.03, 0.2, 0, 0.09, -0.08, GUN_DARK); // asa
      part(g, 0.035, 0.11, 0.05, 0, -0.05, 0.02, GUN_DARK);
      part(g, 0.03, 0.17, 0.045, 0, -0.08, -0.12, GUN_DARK);
      part(g, 0.045, 0.06, 0.24, 0, 0.025, 0.26, GUN_DARK);
      break;
    case NOVA:
      part(g, 0.045, 0.06, 0.55, 0, 0.03, -0.18, GUN_DARK);
      part(g, 0.03, 0.03, 0.3, 0, 0.0, -0.3, GUN_METAL);
      part(g, 0.035, 0.11, 0.05, 0, -0.05, 0.02, GUN_WOOD);
      part(g, 0.05, 0.07, 0.26, 0, 0.02, 0.26, GUN_WOOD);
      break;
    case AWP:
      part(g, 0.045, 0.07, 0.6, 0, 0.03, -0.2, GUN_GREEN);
      part(g, 0.022, 0.022, 0.4, 0, 0.04, -0.68, GUN_DARK);
      part(g, 0.035, 0.035, 0.22, 0, 0.1, -0.12, GUN_DARK); // mira
      part(g, 0.035, 0.11, 0.05, 0, -0.05, 0.02, GUN_GREEN);
      part(g, 0.03, 0.14, 0.04, 0, -0.07, -0.18, GUN_DARK);
      part(g, 0.05, 0.075, 0.3, 0, 0.02, 0.28, GUN_GREEN);
      break;
    default:
      part(g, 0.04, 0.06, 0.3, 0, 0, -0.1, GUN_DARK);
  }
  if (firstPerson) {
    // El "brazo": un bloque que sale hacia la cámara, del color de la manga.
    const arm = part(g, 0.07, 0.07, 0.3, 0.02, -0.12, 0.2, 0x3a4048);
    arm.name = "arm";
  }
  return g;
}

/** Dónde queda la punta del caño, en el espacio del arma (para el fogonazo). */
export function muzzleOffset(id: number): THREE.Vector3 {
  switch (id) {
    case KNIFE:
      return new THREE.Vector3(0, 0, -0.25);
    case GLOCK:
      return new THREE.Vector3(0, 0.035, -0.2);
    case USP:
      return new THREE.Vector3(0, 0.035, -0.28);
    case DEAGLE:
      return new THREE.Vector3(0, 0.04, -0.25);
    case MP5:
      return new THREE.Vector3(0, 0.035, -0.54);
    case AK47:
    case M4A4:
      return new THREE.Vector3(0, 0.045, -0.66);
    case NOVA:
      return new THREE.Vector3(0, 0.0, -0.46);
    case AWP:
      return new THREE.Vector3(0, 0.04, -0.9);
    default:
      return new THREE.Vector3(0, 0, -0.3);
  }
}

/**
 * El arma en la mano, en el espacio de la cámara: balanceo al caminar,
 * retroceso al disparar, bajar para recargar, salir de abajo al cambiar.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private current = -1;
  private mesh: THREE.Group | null = null;
  private flash: THREE.Mesh;
  private flashLeft = 0;
  private kick = 0;
  private kickSide = 0;
  private bob = 0;
  private reloadT = 0;
  private drawT = 0;
  private hidden = false;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.position.set(0.26, -0.24, -0.45);
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
    this.drawT = weapon(id).drawTicks * 0.05;
    this.flash.position.copy(muzzleOffset(id));
  }

  get weaponId(): number {
    return this.current;
  }

  setHidden(h: boolean): void {
    this.hidden = h;
    this.root.visible = !h;
  }

  /** Un tiro salió: retroceso y fogonazo. */
  fire(): void {
    const w = weapon(this.current);
    this.kick = Math.min(1, this.kick + 0.5 + w.kick * 6);
    this.kickSide = (Math.random() - 0.5) * 0.02;
    if (w.melee === 0) this.flashLeft = 0.05;
  }

  reload(): void {
    this.reloadT = weapon(this.current).reloadTicks * 0.05;
  }

  /** `speed` en m/s, `dt` en segundos. */
  update(dt: number, speed: number, onGround: boolean, reloading: boolean): void {
    if (this.hidden || !this.mesh) return;
    this.bob += dt * (onGround ? Math.min(speed, 6) * 2.4 : 0.8);
    const amp = onGround ? Math.min(speed / 5, 1) * 0.012 : 0.004;
    const bx = Math.sin(this.bob) * amp;
    const by = Math.abs(Math.cos(this.bob)) * amp * 0.8;

    this.kick = Math.max(0, this.kick - dt * 7);
    const k = this.kick;

    this.drawT = Math.max(0, this.drawT - dt);
    if (!reloading) this.reloadT = 0;
    else this.reloadT = Math.max(0, this.reloadT - dt);
    const w = weapon(this.current);
    const reloadTotal = Math.max(0.1, w.reloadTicks * 0.05);
    // Baja, se queda abajo y vuelve: una curva suave de 0 a 1 a 0.
    const rp = reloading ? Math.sin(Math.PI * Math.min(1, 1 - this.reloadT / reloadTotal)) : 0;
    const drawDip = this.drawT > 0 ? Math.min(1, this.drawT / Math.max(0.05, w.drawTicks * 0.05)) : 0;

    this.mesh.position.set(bx + this.kickSide * k, by - rp * 0.18 - drawDip * 0.3, k * 0.06);
    this.mesh.rotation.set(-k * 0.25 + rp * 0.5 + drawDip * 0.9, rp * 0.3, this.kickSide * k * 3);

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
