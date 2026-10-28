import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { TEX_COUNT, type Box, type GameMap, type UnpackedDrop } from "@wabcs/shared";
import { makeAllMaterials } from "./textures.js";
import { buildWeaponMesh } from "./viewmodel.js";

/** Un cilindro vertical inscripto en la caja (barriles), con los UV en metros. */
function cylinderGeometry(b: Box): THREE.BufferGeometry {
  const r = Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const h = b.maxY - b.minY;
  const g = new THREE.CylinderGeometry(r, r, h, 18, 1);
  g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const around = Math.PI * 2 * r;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * h);
  return g;
}

/** Una caja del mapa como geometría con los UV escalados a metros. */
function boxGeometry(b: Box): THREE.BufferGeometry {
  if (b.shape === "cyl") return cylinderGeometry(b);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const d = b.maxZ - b.minZ;
  const g = new THREE.BoxGeometry(w, h, d);
  // Una calcomanía apoyada sobre otra cara parpadea (z-fighting): se levanta un pelo.
  g.translate((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2 + (b.decal ? 0.004 : 0), (b.minZ + b.maxZ) / 2);
  // Caras en el orden de BoxGeometry: +x, -x, +y, -y, +z, -z; 4 vértices cada una.
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const scales: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  // Desplazar la grilla con la posición de la caja: dos paredes vecinas siguen
  // la misma grilla en vez de arrancar cada una de cero.
  const offsets: [number, number][] = [
    [b.minZ, b.minY],
    [b.minZ, b.minY],
    [b.minX, b.minZ],
    [b.minX, b.minZ],
    [b.minX, b.minY],
    [b.minX, b.minY],
  ];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = scales[face]!;
    const [ou, ov] = offsets[face]!;
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
    }
  }
  return g;
}

/** Un cielo con degradé (cenit, horizonte) dibujado por dentro de una esfera. */
function makeSky(top: THREE.Color, horizon: THREE.Color): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: top },
      horizon: { value: horizon },
      sunDir: { value: new THREE.Vector3(0.45, 0.6, 0.3).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(h, 0.55));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.8) * (pow(sun, 900.0) * 1.2 + pow(sun, 12.0) * 0.12);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 32, 16), material);
  sky.renderOrder = -1;
  return sky;
}

/**
 * El mundo: el mapa como una malla por textura (todas las cajas de la misma
 * textura se funden en una), las luces, el cielo y las armas en el piso.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly materials = makeAllMaterials();
  private mapGroup = new THREE.Group();
  private dropMeshes = new Map<number, THREE.Group>();
  private dropGroup = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private sky: THREE.Mesh | null = null;

  constructor() {
    const hemi = new THREE.HemisphereLight(0xcfdcec, 0x5f5748, 0.55);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.set(22, 30, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 100;
    this.sun.shadow.camera.left = -34;
    this.sun.shadow.camera.right = 34;
    this.sun.shadow.camera.top = 28;
    this.sun.shadow.camera.bottom = -28;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.mapGroup);
    this.scene.add(this.dropGroup);
  }

  /** Luz de ambiente con reflejos suaves: hace que lo plano deje de verse plano. */
  setEnvironment(renderer: THREE.WebGLRenderer): void {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();
  }

  load(map: GameMap): void {
    this.mapGroup.clear();
    const sky = new THREE.Color(map.sky);
    const horizon = sky.clone().lerp(new THREE.Color(0xf2ece0), 0.55);
    const top = sky.clone().lerp(new THREE.Color(0x3d6fb3), 0.5);
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(horizon, 50, 130);
    if (this.sky) this.scene.remove(this.sky);
    this.sky = makeSky(top, horizon);
    this.scene.add(this.sky);

    const byTex: THREE.BufferGeometry[][] = Array.from({ length: TEX_COUNT }, () => []);
    for (const b of map.boxes) byTex[b.tex]?.push(boxGeometry(b));
    byTex.forEach((list, tex) => {
      if (list.length === 0) return;
      const merged = mergeGeometries(list, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, this.materials[tex]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.mapGroup.add(mesh);
    });

    // Un suelo enorme por debajo, de tierra, por si se ve más allá del perímetro.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x6f6a5a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.51;
    ground.receiveShadow = true;
    this.mapGroup.add(ground);
  }

  /** Las armas tiradas: una malla por cada una, acostada en el piso. */
  updateDrops(drops: readonly UnpackedDrop[]): void {
    const seen = new Set<number>();
    for (const d of drops) {
      seen.add(d.id);
      let g = this.dropMeshes.get(d.id);
      if (!g) {
        g = buildWeaponMesh(d.weapon, false);
        g.scale.setScalar(1.15);
        this.dropMeshes.set(d.id, g);
        this.dropGroup.add(g);
      }
      g.position.set(d.x, d.y + 0.06, d.z);
      // Acostada, apuntando hacia donde miraba el que la soltó.
      g.rotation.set(0, d.yaw + Math.PI / 2, Math.PI / 2);
    }
    for (const [id, g] of this.dropMeshes) {
      if (seen.has(id)) continue;
      this.dropGroup.remove(g);
      this.dropMeshes.delete(id);
    }
  }

  clearDrops(): void {
    this.dropGroup.clear();
    this.dropMeshes.clear();
  }
}
