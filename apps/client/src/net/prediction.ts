import {
  ACT_BUY_BASE,
  ACT_DROP,
  ACT_NONE,
  ACT_PICKUP,
  applySlotAction,
  createPlayer,
  shotDirections,
  stepPlayerMovement,
  stepWeaponState,
  type GameMap,
  type PlayerInput,
  type PlayerState,
  type UnpackedPlayer,
  type Vec3,
} from "@wabcs/shared";

/** Más que esto y no vale la pena disimular: fue un teletransporte real. */
const SNAP_THRESHOLD = 2.0;
/** Diferencias por debajo de esto se ignoran: el snapshot viaja redondeado a centímetros. */
const IGNORE_THRESHOLD = 0.02;
/** Constante de tiempo con la que se disuelve el error de predicción. */
const ERROR_DECAY_TAU = 0.08;

/** Un disparo propio, decidido acá sin esperar al servidor. */
export interface PredictedShot {
  seq: number;
  weapon: number;
  /** Hacia dónde salió cada perdigón, lo mismo que va a calcular el servidor. */
  dirs: Vec3[];
}

/**
 * Predicción y reconciliación del jugador local.
 *
 * El input se aplica al toque para que moverse se sienta instantáneo, y cuando
 * llega el snapshot del servidor se vuelve a su estado y se re-ejecutan los
 * inputs que todavía no había procesado. Si el servidor pensaba lo mismo que
 * nosotros, el resultado coincide y no se ve nada.
 */
export class Predictor {
  readonly state: PlayerState;
  private pending: PlayerInput[] = [];
  private errX = 0;
  private errY = 0;
  private errZ = 0;
  /**
   * Posición antes del último paso. La simulación avanza 20 veces por segundo y
   * la pantalla dibuja 60 o más: sin interpolar entre estas dos, la cámara se
   * mueve a los saltos.
   */
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevCrouch = 0;
  private replaying = false;
  /** El último reconcile trajo algo distinto a lo predicho (para medir). */
  corrections = 0;

  constructor(id: number) {
    this.state = createPlayer(id);
  }

  reset(from: UnpackedPlayer): void {
    this.pending.length = 0;
    this.errX = this.errY = this.errZ = 0;
    this.load(from);
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.prevZ = this.state.z;
    this.prevCrouch = this.state.crouch;
  }

  /** Un input nuevo: se aplica ya mismo y se guarda hasta que el servidor lo confirme. */
  apply(input: PlayerInput, map: GameMap, canAct: boolean): PredictedShot | null {
    this.pending.push(input);
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.prevZ = this.state.z;
    this.prevCrouch = this.state.crouch;
    const weapon = this.step(input, map, canAct);
    if (weapon < 0) return null;
    return { seq: input.seq, weapon, dirs: shotDirections(this.state, weapon, input.seq) };
  }

  /**
   * Lo mismo que corre el servidor para este jugador en un tick, en el mismo
   * orden, menos lo que necesita el mundo (comprar, levantar, tirar: eso llega
   * con el próximo snapshot, un instante después).
   */
  private step(input: PlayerInput, map: GameMap, canAct: boolean): number {
    const s = this.state;
    s.lastSeq = input.seq;
    stepPlayerMovement(s, input, map, canAct);
    if (!s.alive) return -1;
    if (input.act !== ACT_NONE && input.act < ACT_BUY_BASE && input.act !== ACT_PICKUP && input.act !== ACT_DROP) {
      applySlotAction(s, input.act);
    }
    return stepWeaponState(s, input, canAct);
  }

  private load(server: UnpackedPlayer): void {
    const s = this.state;
    s.team = server.team;
    s.alive = server.alive;
    s.x = server.x;
    s.y = server.y;
    s.z = server.z;
    s.vx = server.vx;
    s.vz = server.vz;
    s.onGround = server.onGround;
    s.crouch = server.crouch;
    s.hp = server.hp;
    s.armor = server.armor;
    s.helmet = server.helmet;
    s.slots = [server.slots[0], server.slots[1], server.slots[2]];
    s.active = server.active;
    s.reloading = server.reloading;
    s.scoped = server.scoped;
    s.shootHeld = server.shootHeld;
    if (server.own) {
      s.vy = server.own.vy;
      s.ammo = [server.own.ammo[0], server.own.ammo[1], 0];
      s.reserve = [server.own.reserve[0], server.own.reserve[1], 0];
      s.money = server.own.money;
      s.fireCd = server.own.fireCd;
      s.reloadCd = server.own.reloadCd;
      s.drawCd = server.own.drawCd;
      s.recoil = server.own.recoil;
    }
  }

  /** Llega el estado autoritativo: rebobinar y volver a aplicar lo no confirmado. */
  reconcile(server: UnpackedPlayer, map: GameMap, canAct: boolean): void {
    while (this.pending.length > 0 && this.pending[0]!.seq <= server.lastSeq) this.pending.shift();

    const beforeX = this.state.x;
    const beforeY = this.state.y;
    const beforeZ = this.state.z;

    this.load(server);

    this.replaying = true;
    for (const input of this.pending) {
      this.prevX = this.state.x;
      this.prevY = this.state.y;
      this.prevZ = this.state.z;
      this.prevCrouch = this.state.crouch;
      this.step(input, map, canAct);
    }
    this.replaying = false;

    const dx = beforeX - this.state.x;
    const dy = beforeY - this.state.y;
    const dz = beforeZ - this.state.z;
    const d2 = dx * dx + dy * dy + dz * dz;

    if (d2 > SNAP_THRESHOLD * SNAP_THRESHOLD) {
      this.errX = this.errY = this.errZ = 0;
      this.prevX = this.state.x;
      this.prevY = this.state.y;
      this.prevZ = this.state.z;
      this.corrections++;
    } else if (d2 > IGNORE_THRESHOLD * IGNORE_THRESHOLD) {
      this.errX = dx;
      this.errY = dy;
      this.errZ = dz;
      this.corrections++;
    }
  }

  /**
   * Posición a dibujar: interpolada entre el paso anterior y el actual, más lo
   * que queda del error de reconciliación, que se va licuando a cero.
   */
  renderPosition(dtSeconds: number, alpha: number): { x: number; y: number; z: number; crouch: number } {
    const k = Math.exp(-dtSeconds / ERROR_DECAY_TAU);
    this.errX *= k;
    this.errY *= k;
    this.errZ *= k;
    if (Math.abs(this.errX) < 0.001) this.errX = 0;
    if (Math.abs(this.errY) < 0.001) this.errY = 0;
    if (Math.abs(this.errZ) < 0.001) this.errZ = 0;
    const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    return {
      x: this.prevX + (this.state.x - this.prevX) * t + this.errX,
      y: this.prevY + (this.state.y - this.prevY) * t + this.errY,
      z: this.prevZ + (this.state.z - this.prevZ) * t + this.errZ,
      crouch: this.prevCrouch + (this.state.crouch - this.prevCrouch) * t,
    };
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get isReplaying(): boolean {
    return this.replaying;
  }
}
