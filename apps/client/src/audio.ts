import { AK47, AWP, DEAGLE, GLOCK, KNIFE, M4A1S, MP5, NOVA, USP } from "@wabcs/shared";

/**
 * Sonido generado por código (sin archivos): tiros, recargas, pasos, impactos
 * y los avisos de la ronda. Posicional a lo pobre: paneo según de qué lado
 * está respecto de la cámara y volumen según la distancia.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  volume = 0.8;
  /** Yaw de la cámara, para panear. */
  listenerYaw = 0;
  listenerX = 0;
  listenerZ = 0;
  muted = false;

  /** Hay que llamarlo desde un gesto del usuario (click): si no, el navegador no deja sonar. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /** Ganancia y paneo para algo que suena en (x, z). */
  private spatial(x: number | null, z: number | null, refDist: number): { gain: number; pan: number } {
    if (x === null || z === null) return { gain: 1, pan: 0 };
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const dist = Math.hypot(dx, dz);
    const gain = Math.min(1, refDist / Math.max(refDist, dist));
    // Derecha de la cámara: (cos yaw, -sin yaw).
    const rx = Math.cos(this.listenerYaw);
    const rz = -Math.sin(this.listenerYaw);
    const pan = dist > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) * 0.8 : 0;
    return { gain, pan };
  }

  private out(gain: number, pan: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.master!);
    return g;
  }

  private noise(duration: number, filterHz: number, gain: number, pan: number, type: BiquadFilterType = "lowpass", q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterHz;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(f);
    f.connect(env);
    env.connect(this.out(1, pan));
    src.start();
    src.stop(ctx.currentTime + duration + 0.02);
  }

  private tone(freq: number, duration: number, gain: number, pan: number, type: OscillatorType = "sine", slideTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    o.connect(env);
    env.connect(this.out(1, pan));
    o.start();
    o.stop(ctx.currentTime + duration + 0.02);
  }

  /** Un disparo de `weapon` en (x, z); null = el propio, en la oreja. */
  shot(weaponId: number, x: number | null, z: number | null): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 6);
    const own = x === null;
    const g = (own ? 0.55 : 0.8) * gain;
    switch (weaponId) {
      case KNIFE:
        this.noise(0.08, 2500, 0.25 * gain, pan, "bandpass", 2);
        break;
      case GLOCK:
      case USP:
        this.noise(0.09, weaponId === USP ? 1200 : 2600, g * 0.7, pan);
        this.tone(220, 0.05, g * 0.3, pan, "square", 80);
        break;
      case DEAGLE:
        this.noise(0.16, 1800, g, pan);
        this.tone(140, 0.12, g * 0.6, pan, "square", 50);
        break;
      case MP5:
        this.noise(0.07, 2200, g * 0.6, pan);
        this.tone(300, 0.04, g * 0.2, pan, "square", 120);
        break;
      case AK47:
        this.noise(0.11, 1600, g * 0.9, pan);
        this.tone(170, 0.08, g * 0.5, pan, "sawtooth", 60);
        break;
      case M4A1S:
        // Silenciada: un golpe seco y bajo, sin estampido.
        this.noise(0.07, 900, g * 0.35, pan, "lowpass");
        this.tone(160, 0.05, g * 0.15, pan, "sine", 70);
        break;
      case NOVA:
        this.noise(0.22, 900, g * 1.1, pan);
        this.tone(100, 0.15, g * 0.6, pan, "sawtooth", 40);
        break;
      case AWP:
        this.noise(0.3, 700, g * 1.2, pan);
        this.tone(90, 0.25, g * 0.7, pan, "sawtooth", 30);
        break;
      default:
        this.noise(0.1, 1500, g, pan);
    }
  }

  /** Un tiro que no se ve: apagado, de por allá. */
  distantShot(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 10);
    this.noise(0.18, 400, 0.5 * gain, pan);
  }

  reload(x: number | null, z: number | null): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 4);
    this.noise(0.03, 3000, 0.25 * gain, pan, "highpass");
    setTimeout(() => this.ctx && this.noise(0.04, 2200, 0.3 * gain, pan, "bandpass", 3), 180);
    setTimeout(() => this.ctx && this.noise(0.03, 3500, 0.25 * gain, pan, "highpass"), 700);
  }

  step(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 3);
    this.noise(0.06, 500, 0.35 * gain, pan);
  }

  /** Tus propios pasos: más apagados, alternando un poco el tono. */
  ownStep(left: boolean): void {
    if (!this.ctx) return;
    this.noise(0.05, left ? 420 : 520, 0.16, left ? -0.15 : 0.15);
  }

  /** Caer al piso después de un salto. */
  land(hard: boolean): void {
    if (!this.ctx) return;
    this.noise(hard ? 0.12 : 0.07, 300, hard ? 0.45 : 0.25, 0);
  }

  /** Sacar un arma: un clic metálico. */
  draw(): void {
    if (!this.ctx) return;
    this.noise(0.03, 2800, 0.18, 0.2, "highpass");
  }

  /** Gatillo con el cargador vacío. */
  dryFire(): void {
    if (!this.ctx) return;
    this.tone(1400, 0.03, 0.12, 0.2, "square");
  }

  /** Le pegaste a alguien (el tic del hitmarker); en la cabeza, un ding. */
  hitmarker(head: boolean): void {
    if (!this.ctx) return;
    if (head) this.tone(1800, 0.12, 0.25, 0, "triangle", 1400);
    else this.tone(900, 0.05, 0.2, 0, "square");
  }

  /** Una granada que sale de la mano (el clic de la anilla y el brazo). */
  throwNade(x: number | null, z: number | null): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 5);
    this.noise(0.04, 2400, 0.2 * gain, pan, "highpass");
  }

  /** La HE: grave y larga, se oye en todo el mapa. */
  explosion(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 14);
    this.noise(0.5, 500, 1.2 * gain, pan);
    this.tone(60, 0.5, 0.9 * gain, pan, "sine", 25);
  }

  /** La flash: un estampido agudo y, si te cegó, un pitido que se apaga. */
  flashbang(x: number, z: number, blindedSeconds: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 12);
    this.noise(0.18, 3000, 0.9 * gain, pan, "highpass");
    if (blindedSeconds > 0.3) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = 2600;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.12, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + blindedSeconds);
      o.connect(env);
      env.connect(this.master!);
      o.start();
      o.stop(ctx.currentTime + blindedSeconds + 0.05);
    }
  }

  /** El humo: un soplido corto. */
  smoke(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 10);
    this.noise(0.6, 900, 0.35 * gain, pan, "bandpass", 0.7);
  }

  /** El bip de la bomba plantada (se oye en todo el mapa, más fuerte cerca). */
  bombBeep(x: number, z: number, urgent: boolean): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 18);
    this.tone(urgent ? 1800 : 1400, 0.06, 0.25 * Math.max(0.35, gain), pan, "square");
  }

  bombPlanted(): void {
    if (!this.ctx) return;
    this.tone(500, 0.25, 0.3, 0, "square", 350);
  }

  bombDefused(): void {
    if (!this.ctx) return;
    [660, 880, 1100].forEach((f, i) => setTimeout(() => this.ctx && this.tone(f, 0.18, 0.25, 0, "triangle"), i * 90));
  }

  /** La C4: enorme, con cola. */
  bombExplosion(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 30);
    this.noise(1.6, 300, 1.4 * Math.max(0.5, gain), pan);
    this.tone(45, 1.4, 1.0 * Math.max(0.5, gain), pan, "sine", 20);
  }

  /** Mataste a alguien: dos notas cortas. */
  kill(): void {
    if (!this.ctx) return;
    this.tone(880, 0.07, 0.18, 0, "triangle");
    setTimeout(() => this.ctx && this.tone(1320, 0.12, 0.18, 0, "triangle"), 70);
  }

  /** Te pegaron. */
  hurt(): void {
    if (!this.ctx) return;
    this.noise(0.12, 600, 0.5, 0);
    this.tone(120, 0.15, 0.3, 0, "sine", 60);
  }

  /** Una bala que pasó cerca de la oreja: un silbido corto que cae de tono. */
  whiz(x: number, z: number): void {
    if (!this.ctx) return;
    const { pan } = this.spatial(x, z, 2);
    this.tone(2600, 0.09, 0.18, pan, "sawtooth", 700);
    this.noise(0.07, 3000, 0.16, pan, "bandpass", 4);
  }

  impact(x: number, z: number): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(x, z, 5);
    this.noise(0.05, 1500, 0.3 * gain, pan, "bandpass", 2);
  }

  buy(): void {
    if (!this.ctx) return;
    this.tone(1200, 0.08, 0.2, 0, "triangle");
    setTimeout(() => this.ctx && this.tone(1600, 0.1, 0.2, 0, "triangle"), 80);
  }

  roundStart(): void {
    if (!this.ctx) return;
    this.tone(660, 0.12, 0.25, 0, "triangle");
    setTimeout(() => this.ctx && this.tone(880, 0.2, 0.25, 0, "triangle"), 130);
  }

  roundEnd(won: boolean): void {
    if (!this.ctx) return;
    const notes = won ? [523, 659, 784, 1047] : [392, 349, 311, 262];
    notes.forEach((f, i) => setTimeout(() => this.ctx && this.tone(f, 0.25, 0.22, 0, "triangle"), i * 110));
  }

  freezeTick(): void {
    if (!this.ctx) return;
    this.tone(1000, 0.05, 0.12, 0, "square");
  }
}
