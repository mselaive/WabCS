import * as THREE from "three";
import { makeBulletHoleTexture, makePuffTexture } from "./textures.js";

interface Tracer {
  line: THREE.Line;
  life: number;
  total: number;
}

interface Puff {
  sprite: THREE.Sprite;
  life: number;
  total: number;
  vy: number;
  grow: number;
}

interface Flash {
  light: THREE.PointLight;
  life: number;
}

/** Más agujeros que esto y se borra el más viejo. */
const MAX_HOLES = 80;

/**
 * Trazadores, polvo en las paredes, sangre, agujeros de bala y la luz del
 * fogonazo: cosas que nacen, duran una fracción de segundo y se van (los
 * agujeros, hasta la próxima ronda). Todo barato y sin texturas externas.
 */
export class Effects {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private holes: THREE.Mesh[] = [];
  private flashes: Flash[] = [];
  private readonly puffTex = makePuffTexture();
  private readonly holeMat = new THREE.MeshBasicMaterial({
    map: makeBulletHoleTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly holeGeo = new THREE.PlaneGeometry(0.09, 0.09);
  private readonly tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
  private readonly dustMat = new THREE.SpriteMaterial({ map: this.puffTex, color: 0xd8d2c4, transparent: true, depthWrite: false });
  private readonly bloodMat = new THREE.SpriteMaterial({ map: this.puffTex, color: 0xb3121a, transparent: true, depthWrite: false });
  private readonly sparkMat = new THREE.SpriteMaterial({
    map: this.puffTex,
    color: 0xffd080,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    // Dos luces para fogonazos, que se van turnando.
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffc27a, 0, 7, 1.6);
      light.visible = false;
      this.group.add(light);
      this.flashes.push({ light, life: 0 });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, durationMs = 70): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.group.add(line);
    this.tracers.push({ line, life: durationMs / 1000, total: durationMs / 1000 });
  }

  dust(at: THREE.Vector3): void {
    this.puff(at, this.dustMat, 0.25, 0.35, 0.4, 0.6);
    this.puff(at, this.sparkMat, 0.12, 0.12, 0.1, 1.5);
  }

  blood(at: THREE.Vector3, big = false): void {
    for (let i = 0; i < (big ? 4 : 2); i++) {
      const jitter = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2));
      this.puff(jitter, this.bloodMat, big ? 0.35 : 0.22, 0.4, -0.6, 0.5);
    }
  }

  /** Un agujero en la pared, pegado a la cara que se pegó (`normal`). */
  bulletHole(at: THREE.Vector3, normal: THREE.Vector3): void {
    const hole = new THREE.Mesh(this.holeGeo, this.holeMat);
    hole.position.copy(at).addScaledVector(normal, 0.006);
    hole.lookAt(at.clone().add(normal));
    hole.rotateZ(Math.random() * Math.PI * 2);
    this.group.add(hole);
    this.holes.push(hole);
    while (this.holes.length > MAX_HOLES) this.group.remove(this.holes.shift()!);
  }

  /** La luz del fogonazo, un instante, en `at`. */
  flash(at: THREE.Vector3, intensity = 14): void {
    const f = this.flashes.reduce((a, b) => (a.life <= b.life ? a : b));
    f.light.position.copy(at);
    f.light.intensity = intensity;
    f.light.visible = true;
    f.life = 0.06;
  }

  private puff(at: THREE.Vector3, material: THREE.SpriteMaterial, size: number, life: number, vy: number, grow: number): void {
    const sprite = new THREE.Sprite(material.clone());
    sprite.position.copy(at);
    sprite.scale.setScalar(size);
    this.group.add(sprite);
    this.puffs.push({ sprite, life, total: life, vy, grow });
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.life -= dt;
      if (t.life <= 0) {
        this.group.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      (t.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (t.life / t.total);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.group.remove(p.sprite);
        (p.sprite.material as THREE.Material).dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const k = p.life / p.total;
      (p.sprite.material as THREE.SpriteMaterial).opacity = k;
      p.sprite.position.y += p.vy * dt;
      p.sprite.scale.multiplyScalar(1 + p.grow * dt);
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.light.visible = false;
        f.light.intensity = 0;
      }
    }
  }

  /** Borra lo que queda, incluidos los agujeros (ronda nueva). */
  clear(): void {
    for (const t of this.tracers) this.group.remove(t.line);
    for (const p of this.puffs) this.group.remove(p.sprite);
    for (const h of this.holes) this.group.remove(h);
    this.tracers = [];
    this.puffs = [];
    this.holes = [];
  }
}
