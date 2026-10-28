import {
  lerp,
  lerpAngle,
  unpackDrop,
  unpackGrenade,
  unpackPlayer,
  unpackRound,
  unpackSmoke,
  type SmokeState,
  type SnapshotMsg,
  type SnapStanding,
  type UnpackedDrop,
  type UnpackedGrenade,
  type UnpackedPlayer,
  type UnpackedRound,
} from "@wabcs/shared";

export interface Frame {
  tick: number;
  /** Reloj local en que llegó, que es contra el que se interpola. */
  recvAt: number;
  players: Map<number, UnpackedPlayer>;
  drops: UnpackedDrop[];
  grenades: Map<number, UnpackedGrenade>;
  smokes: SmokeState[];
  round: UnpackedRound;
  standings: SnapStanding[];
}

export interface InterpolatedFrame {
  /** Tick del servidor que se está mostrando, con fracción. */
  tick: number;
  players: UnpackedPlayer[];
  drops: UnpackedDrop[];
  grenades: UnpackedGrenade[];
  smokes: SmokeState[];
  round: UnpackedRound;
}

/** Dos segundos de historia: de sobra para interpolar con 100 ms. */
const MAX_FRAMES = 40;
/** Más que esto entre dos snapshots no se camina: es un teletransporte (apareció). */
const TELEPORT_M = 3;

/**
 * Los snapshots llegan 20 veces por segundo y la pantalla dibuja 60 o más. Acá
 * se guarda un pequeño historial y se dibuja ~100 ms en el pasado, interpolando
 * entre los dos snapshots que rodean ese instante.
 */
export class SnapshotBuffer {
  private frames: Frame[] = [];

  push(msg: SnapshotMsg, recvAt: number): void {
    const players = new Map<number, UnpackedPlayer>();
    for (const raw of msg.players) {
      const p = unpackPlayer(raw);
      players.set(p.id, p);
    }
    this.frames.push({
      tick: msg.tick,
      recvAt,
      players,
      drops: msg.drops.map(unpackDrop),
      grenades: new Map((msg.gr ?? []).map(unpackGrenade).map((g) => [g.id, g])),
      smokes: (msg.sm ?? []).map(unpackSmoke),
      round: unpackRound(msg.rd),
      standings: msg.st,
    });
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
  }

  clear(): void {
    this.frames.length = 0;
  }

  get latest(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }

  /** Estado a dibujar en `renderTime` (reloj local, normalmente ahora - 100 ms). */
  sample(renderTime: number): InterpolatedFrame | null {
    const last = this.frames[this.frames.length - 1];
    if (!last) return null;
    const first = this.frames[0]!;

    if (renderTime >= last.recvAt) return { tick: last.tick, players: [...last.players.values()], drops: last.drops, grenades: [...last.grenades.values()], smokes: last.smokes, round: last.round };
    if (renderTime <= first.recvAt) return { tick: first.tick, players: [...first.players.values()], drops: first.drops, grenades: [...first.grenades.values()], smokes: first.smokes, round: first.round };

    let a = first;
    let b = last;
    for (let i = 0; i < this.frames.length - 1; i++) {
      const cur = this.frames[i]!;
      const next = this.frames[i + 1]!;
      if (cur.recvAt <= renderTime && renderTime <= next.recvAt) {
        a = cur;
        b = next;
        break;
      }
    }

    const span = b.recvAt - a.recvAt;
    const t = span > 0 ? (renderTime - a.recvAt) / span : 1;

    const players: UnpackedPlayer[] = [];
    for (const [id, target] of b.players) {
      const prev = a.players.get(id);
      if (!prev || prev.alive !== target.alive || Math.hypot(target.x - prev.x, target.y - prev.y, target.z - prev.z) > TELEPORT_M) {
        players.push(target);
        continue;
      }
      players.push({
        ...target,
        x: lerp(prev.x, target.x, t),
        y: lerp(prev.y, target.y, t),
        z: lerp(prev.z, target.z, t),
        yaw: lerpAngle(prev.yaw, target.yaw, t),
        pitch: lerp(prev.pitch, target.pitch, t),
        crouch: lerp(prev.crouch, target.crouch, t),
      });
    }

    // Las granadas vuelan y rebotan: se interpolan como los jugadores.
    const grenades: UnpackedGrenade[] = [];
    for (const [id, target] of b.grenades) {
      const prev = a.grenades.get(id);
      grenades.push(prev ? { ...target, x: lerp(prev.x, target.x, t), y: lerp(prev.y, target.y, t), z: lerp(prev.z, target.z, t) } : target);
    }

    return { tick: lerp(a.tick, b.tick, t), players, drops: b.drops, grenades, smokes: b.smokes, round: b.round };
  }
}
