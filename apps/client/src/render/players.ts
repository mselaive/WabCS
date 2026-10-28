import * as THREE from "three";
import { CROUCH_TICKS, TEAM_T, type UnpackedPlayer } from "@wabcs/shared";
import { makeLabelTexture } from "./textures.js";
import { buildWeaponMesh, muzzleOffset } from "./viewmodel.js";

const T_SHIRT = 0xc8a46a;
const T_PANTS = 0x5a4a3a;
const T_ACCENT = 0x8c2f2f;
const CT_SHIRT = 0x4f6d8f;
const CT_PANTS = 0x2b3a4d;
const CT_ACCENT = 0x1f2d3f;
const SKIN = 0xe0b48c;
const HELMET = 0x3a4048;

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number): THREE.MeshStandardMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    matCache.set(color, m);
  }
  return m;
}

function block(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Un muñeco de cajas: cabeza, torso, dos brazos, dos piernas y el arma en las
 * manos. Las piernas se balancean con la distancia recorrida, el torso se
 * agacha con `crouch`, la cabeza y los brazos siguen el pitch.
 */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly helmet: THREE.Mesh;
  private readonly torso: THREE.Mesh;
  private readonly arms = new THREE.Group();
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private weaponGroup: THREE.Group | null = null;
  private weaponId = -1;
  private readonly label: THREE.Sprite;
  private walk = 0;
  private lastX = 0;
  private lastZ = 0;
  team = TEAM_T;
  /** Dónde queda el caño en el mundo, para los trazadores de los demás. */
  readonly muzzle = new THREE.Vector3();

  constructor(name: string, team: number) {
    this.team = team;
    const shirt = team === TEAM_T ? T_SHIRT : CT_SHIRT;
    const pants = team === TEAM_T ? T_PANTS : CT_PANTS;
    const accent = team === TEAM_T ? T_ACCENT : CT_ACCENT;

    this.legL = block(0.22, 0.8, 0.26, pants);
    this.legR = block(0.22, 0.8, 0.26, pants);
    this.legL.position.set(-0.13, 0.4, 0);
    this.legR.position.set(0.13, 0.4, 0);
    this.root.add(this.legL, this.legR);

    this.torso = block(0.54, 0.62, 0.3, shirt);
    this.torso.position.set(0, 0.31, 0);
    // Una franja del color del equipo en el pecho (el "chaleco").
    const vest = block(0.44, 0.3, 0.32, accent);
    vest.position.set(0, 0.25, 0);
    this.body.add(this.torso, vest);

    this.head = block(0.3, 0.3, 0.3, SKIN);
    this.head.position.set(0, 0.62 + 0.18, 0);
    const visor = block(0.32, 0.08, 0.1, 0x222222);
    visor.position.set(0, 0.03, -0.12);
    this.head.add(visor);
    this.helmet = block(0.34, 0.14, 0.34, HELMET);
    this.helmet.position.set(0, 0.14, 0);
    this.helmet.visible = false;
    this.head.add(this.helmet);
    this.body.add(this.head);

    // Los brazos pivotan desde los hombros y sostienen el arma al frente.
    this.arms.position.set(0, 0.55, 0);
    const armL = block(0.14, 0.14, 0.5, shirt);
    armL.position.set(-0.2, -0.05, -0.25);
    const armR = block(0.14, 0.14, 0.5, shirt);
    armR.position.set(0.2, -0.05, -0.25);
    const handL = block(0.12, 0.12, 0.12, SKIN);
    handL.position.set(-0.12, -0.05, -0.5);
    const handR = block(0.12, 0.12, 0.12, SKIN);
    handR.position.set(0.14, -0.05, -0.45);
    this.arms.add(armL, armR, handL, handR);
    this.body.add(this.arms);

    this.body.position.y = 0.8;
    this.root.add(this.body);

    const labelMat = new THREE.SpriteMaterial({
      map: makeLabelTexture(name, team === TEAM_T ? "#f0b56a" : "#8fc1ff"),
      transparent: true,
      depthTest: false,
    });
    this.label = new THREE.Sprite(labelMat);
    this.label.scale.set(1.2, 0.3, 1);
    this.label.position.y = 2.15;
    this.root.add(this.label);
  }

  setLabelVisible(v: boolean): void {
    this.label.visible = v;
  }

  setWeapon(id: number): void {
    if (id === this.weaponId) return;
    if (this.weaponGroup) this.arms.remove(this.weaponGroup);
    this.weaponGroup = buildWeaponMesh(id, false);
    this.weaponGroup.position.set(0.14, 0.0, -0.5);
    this.arms.add(this.weaponGroup);
    this.weaponId = id;
  }

  /** Posición, orientación y pose desde un snapshot interpolado. */
  update(p: UnpackedPlayer, dt: number): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    this.setWeapon(p.weapon);
    this.helmet.visible = p.helmet;

    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const speed = dt > 0 ? moved / dt : 0;
    if (speed > 0.3 && p.onGround) this.walk += moved * 4.5;
    else this.walk *= 0.8;
    const swing = Math.sin(this.walk) * Math.min(0.6, speed / 5);

    const c = p.crouch / CROUCH_TICKS;
    // Agachado: las piernas se acortan y el cuerpo baja; en el aire, las piernas se recogen.
    const legScale = 1 - c * 0.45;
    this.legL.scale.y = legScale;
    this.legR.scale.y = legScale;
    this.legL.position.y = 0.4 * legScale;
    this.legR.position.y = 0.4 * legScale;
    this.legL.rotation.x = p.onGround ? swing : 0.4;
    this.legR.rotation.x = p.onGround ? -swing : -0.2;
    this.body.position.y = 0.8 * legScale;
    this.body.rotation.x = c * 0.25;

    this.arms.rotation.x = -p.pitch * 0.9;
    this.head.rotation.x = -p.pitch * 0.5;

    if (this.weaponGroup) {
      this.weaponGroup.updateWorldMatrix(true, false);
      this.muzzle.copy(muzzleOffset(this.weaponId)).applyMatrix4(this.weaponGroup.matrixWorld);
    }
  }

  dispose(): void {
    (this.label.material as THREE.SpriteMaterial).map?.dispose();
  }
}

/**
 * Un cuerpo en el piso donde cayó alguien, hasta que termina la ronda.
 */
export function buildCorpse(team: number, x: number, y: number, z: number, yaw: number): THREE.Group {
  const g = new THREE.Group();
  const shirt = team === TEAM_T ? T_SHIRT : CT_SHIRT;
  const pants = team === TEAM_T ? T_PANTS : CT_PANTS;
  const torso = block(0.54, 0.3, 0.62, shirt);
  torso.position.set(0, 0.15, 0.2);
  const head = block(0.3, 0.3, 0.3, SKIN);
  head.position.set(0, 0.15, 0.68);
  const legs = block(0.5, 0.26, 0.8, pants);
  legs.position.set(0, 0.13, -0.4);
  g.add(torso, head, legs);
  g.position.set(x, y, z);
  g.rotation.y = yaw + Math.PI;
  return g;
}
