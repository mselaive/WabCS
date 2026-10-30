import * as THREE from "three";
import { CROUCH_TICKS, TEAM_T, type UnpackedPlayer } from "@wabcs/shared";
import { makeLabelTexture } from "./textures.js";
import { buildWeaponMesh, muzzleOffset } from "./viewmodel.js";

interface Look {
  shirt: number;
  pants: number;
  vest: number;
  boots: number;
  head: number;
  /** Lo que lleva en la cabeza sin casco: pañuelo (T) o gorra (CT). */
  hat: number;
}

const T_LOOK: Look = { shirt: 0xc9a86b, pants: 0x5b4b3b, vest: 0x8a2d2d, boots: 0x2e2520, head: 0xdfb08a, hat: 0x8a2d2d };
const CT_LOOK: Look = { shirt: 0x4b6a8f, pants: 0x2b3a4d, vest: 0x1e2b3b, boots: 0x1c222a, head: 0xe3b593, hat: 0x1e2b3b };
const HELMET = 0x3a4048;
const SKIN_HANDS = 0xd9a877;

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
 * Un muñeco de cajas con proporciones humanas: cabeza con cuello, torso con
 * chaleco y cinturón, hombros, brazos en dos tramos que sostienen el arma,
 * piernas con botas. Las piernas se balancean con la distancia recorrida, el
 * torso se agacha con `crouch`, la cabeza y los brazos siguen el pitch.
 */
export class PlayerAvatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head: THREE.Group;
  private readonly helmet: THREE.Mesh;
  private readonly hat: THREE.Mesh;
  private readonly arms = new THREE.Group();
  private readonly legL: THREE.Group;
  private readonly legR: THREE.Group;
  private weaponGroup: THREE.Group | null = null;
  private weaponId = -1;
  private weaponSkin = 0;
  private readonly label: THREE.Sprite;
  private walk = 0;
  private breath = Math.random() * 6;
  private lastX = 0;
  private lastZ = 0;
  team = TEAM_T;
  /** Dónde queda el caño en el mundo, para los trazadores de los demás. */
  readonly muzzle = new THREE.Vector3();

  constructor(name: string, team: number) {
    this.team = team;
    const look = team === TEAM_T ? T_LOOK : CT_LOOK;

    // Piernas: muslo + bota, pivotando desde la cadera (y = 0,82).
    const leg = (x: number): THREE.Group => {
      const g = new THREE.Group();
      const thigh = block(0.2, 0.72, 0.24, look.pants);
      thigh.position.y = -0.36;
      const boot = block(0.22, 0.12, 0.3, look.boots);
      boot.position.set(0, -0.76, -0.02);
      g.add(thigh, boot);
      g.position.set(x, 0.82, 0);
      return g;
    };
    this.legL = leg(-0.12);
    this.legR = leg(0.12);
    this.root.add(this.legL, this.legR);

    // Torso con chaleco, cinturón y hombros.
    const torso = block(0.46, 0.6, 0.26, look.shirt);
    torso.position.set(0, 0.3, 0);
    const vest = block(0.4, 0.34, 0.3, look.vest);
    vest.position.set(0, 0.3, 0);
    const belt = block(0.47, 0.06, 0.27, look.boots);
    belt.position.set(0, 0.02, 0);
    const shoulderL = block(0.14, 0.12, 0.26, look.shirt);
    shoulderL.position.set(-0.28, 0.54, 0);
    const shoulderR = block(0.14, 0.12, 0.26, look.shirt);
    shoulderR.position.set(0.28, 0.54, 0);
    this.body.add(torso, vest, belt, shoulderL, shoulderR);
    if (team !== TEAM_T) {
      const pack = block(0.3, 0.3, 0.12, look.vest);
      pack.position.set(0, 0.3, 0.19);
      this.body.add(pack);
    }

    // Cabeza con cuello; visor, pañuelo o gorra, y el casco (si lo compra).
    this.head = new THREE.Group();
    const neck = block(0.12, 0.1, 0.12, look.head);
    neck.position.y = 0.05;
    const skull = block(0.26, 0.28, 0.26, look.head);
    skull.position.y = 0.24;
    const eyes = block(0.2, 0.05, 0.03, 0x1b1b1b);
    eyes.position.set(0, 0.27, -0.13);
    this.head.add(neck, skull, eyes);
    if (team === TEAM_T) {
      this.hat = block(0.28, 0.08, 0.28, look.hat);
      this.hat.position.y = 0.34;
      const tail = block(0.06, 0.16, 0.03, look.hat);
      tail.position.set(0.08, 0.26, 0.15);
      this.head.add(tail);
    } else {
      this.hat = block(0.28, 0.07, 0.28, look.hat);
      this.hat.position.y = 0.36;
      const peak = block(0.24, 0.02, 0.1, look.hat);
      peak.position.set(0, 0.34, -0.17);
      this.head.add(peak);
    }
    this.head.add(this.hat);
    this.helmet = block(0.31, 0.16, 0.31, HELMET);
    this.helmet.position.y = 0.36;
    this.helmet.visible = false;
    this.head.add(this.helmet);
    this.head.position.y = 0.6;
    this.body.add(this.head);

    // Brazos: desde los hombros, en dos tramos, hasta el arma al frente.
    this.arms.position.set(0, 0.5, 0);
    const upperL = block(0.12, 0.12, 0.3, look.shirt);
    upperL.position.set(-0.24, -0.02, -0.14);
    upperL.rotation.y = 0.5;
    const foreL = block(0.1, 0.1, 0.3, look.shirt);
    foreL.position.set(-0.08, -0.04, -0.38);
    foreL.rotation.y = 0.2;
    const handL = block(0.1, 0.1, 0.1, SKIN_HANDS);
    handL.position.set(-0.02, -0.04, -0.52);
    const upperR = block(0.12, 0.12, 0.26, look.shirt);
    upperR.position.set(0.22, -0.02, -0.08);
    upperR.rotation.y = -0.35;
    const foreR = block(0.1, 0.1, 0.22, look.shirt);
    foreR.position.set(0.14, -0.06, -0.26);
    const handR = block(0.1, 0.1, 0.1, SKIN_HANDS);
    handR.position.set(0.12, -0.06, -0.38);
    this.arms.add(upperL, foreL, handL, upperR, foreR, handR);
    this.body.add(this.arms);

    this.body.position.y = 0.82;
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

  setWeapon(id: number, skin = 0): void {
    if (id === this.weaponId && skin === this.weaponSkin) return;
    if (this.weaponGroup) this.arms.remove(this.weaponGroup);
    this.weaponGroup = buildWeaponMesh(id, false, { team: this.team, skin });
    this.weaponGroup.position.set(0.12, 0.0, -0.4);
    this.arms.add(this.weaponGroup);
    this.weaponId = id;
    this.weaponSkin = skin;
  }

  /** Posición, orientación y pose desde un snapshot interpolado. `skin` es la de su cuchillo. */
  update(p: UnpackedPlayer, dt: number, skin = 0): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    this.setWeapon(p.weapon, skin);
    this.helmet.visible = p.helmet;
    this.hat.visible = !p.helmet;

    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const speed = dt > 0 ? moved / dt : 0;
    if (speed > 0.3 && p.onGround) this.walk += moved * 4.5;
    else this.walk *= 0.8;
    const swing = Math.sin(this.walk) * Math.min(0.7, speed / 5);
    this.breath += dt;

    const c = p.crouch / CROUCH_TICKS;
    // Agachado: las piernas se flexionan y el cuerpo baja; en el aire, se recogen.
    const legScale = 1 - c * 0.45;
    this.legL.scale.y = legScale;
    this.legR.scale.y = legScale;
    this.legL.position.y = 0.82 * legScale;
    this.legR.position.y = 0.82 * legScale;
    this.legL.rotation.x = p.onGround ? swing : 0.45;
    this.legR.rotation.x = p.onGround ? -swing : -0.25;
    this.body.position.y = 0.82 * legScale + Math.sin(this.breath * 2) * 0.004;
    this.body.rotation.x = c * 0.3;

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

/** Un cuerpo en el piso donde cayó alguien, hasta que termina la ronda. */
export function buildCorpse(team: number, x: number, y: number, z: number, yaw: number): THREE.Group {
  const g = new THREE.Group();
  const look = team === TEAM_T ? T_LOOK : CT_LOOK;
  const torso = block(0.46, 0.26, 0.6, look.shirt);
  torso.position.set(0, 0.13, 0.2);
  const vest = block(0.4, 0.28, 0.34, look.vest);
  vest.position.set(0, 0.14, 0.2);
  const head = block(0.26, 0.26, 0.28, look.head);
  head.position.set(0.05, 0.13, 0.66);
  const legL = block(0.2, 0.22, 0.74, look.pants);
  legL.position.set(-0.13, 0.11, -0.4);
  const legR = block(0.2, 0.22, 0.74, look.pants);
  legR.position.set(0.14, 0.11, -0.36);
  legR.rotation.y = 0.2;
  const armL = block(0.12, 0.12, 0.5, look.shirt);
  armL.position.set(-0.34, 0.08, 0.1);
  armL.rotation.y = -0.4;
  g.add(torso, vest, head, legL, legR, armL);
  g.position.set(x, y, z);
  g.rotation.y = yaw + Math.PI;
  return g;
}
