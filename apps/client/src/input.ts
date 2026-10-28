import {
  ACT_DROP,
  ACT_GRENADE_BASE,
  ACT_NONE,
  ACT_PICKUP,
  ACT_SLOT_0,
  ACT_SLOT_1,
  ACT_SLOT_2,
  type PlayerInput,
} from "@wabcs/shared";

/** Tecla -> acción puntual. Se manda una sola vez, en el tick en que se aprieta. */
const ACTION_KEYS: Record<string, number> = {
  Digit1: ACT_SLOT_0,
  Digit2: ACT_SLOT_1,
  Digit3: ACT_SLOT_2,
  Digit4: ACT_GRENADE_BASE + 0,
  Digit5: ACT_GRENADE_BASE + 1,
  Digit6: ACT_GRENADE_BASE + 2,
  KeyE: ACT_PICKUP,
  KeyG: ACT_DROP,
};

const FWD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);
const JUMP = new Set(["Space"]);
const CROUCH = new Set(["ControlLeft", "ControlRight", "KeyC"]);
const WALK = new Set(["ShiftLeft", "ShiftRight"]);

/** Lo que se le pide a la interfaz desde el teclado, en vez de al muñeco. */
export type UiIntent = "buy" | "scoreboardOn" | "scoreboardOff" | "chat" | "lastWeapon" | "spectateNext";

const MAX_PITCH = Math.PI / 2 - 0.02;

/**
 * Teclado y mouse. Con el puntero capturado (pointer lock) el mouse gira la
 * cámara; sin capturar, no pasa nada, así que hacer click en el canvas lo
 * captura. El input se arma cada tick con `sample()`.
 */
export class InputController {
  private keys = new Set<string>();
  private shooting = false;
  private scoping = false;
  /**
   * Se arma al apretar el botón y se consume en el próximo input. El input sale
   * cada 50 ms y un click rápido dura menos: si sólo se mirara si el botón
   * sigue apretado, ese click se perdería sin disparar.
   */
  private shotQueued = false;
  /**
   * Acaba de apretar el gatillo y todavía no salió ningún input con eso: el
   * juego manda uno ya mismo en vez de esperar al próximo tick (hasta 50 ms).
   */
  private shotTrigger = false;
  private reloadQueued = false;
  private jumpQueued = false;
  private pendingAction = ACT_NONE;
  private intents: UiIntent[] = [];

  /** Hacia dónde mira la cámara (radianes). Lo mueve el mouse al instante. */
  yaw = 0;
  pitch = 0;
  /** Radianes por píxel de mouse. */
  sensitivity = 0.0022;
  /** Con la mira puesta el mouse gira menos, como en CS. */
  scopedFactor = 0.35;
  scoped = false;

  /** Activo solo mientras se controla al muñeco. */
  enabled = false;
  /** Muerto pero mirando: la cámara gira, la tabla se abre, nada más. */
  watching = false;
  /** Hay una pantalla de la interfaz abierta (compra, chat): las teclas son suyas. */
  uiBusy = false;

  /**
   * El navegador no quiso capturar el puntero (pasa en vistas embebidas). Se
   * juega igual: el mouse gira la cámara mientras está sobre la página, sin
   * esconder el cursor. Es peor, pero es mejor que nada.
   */
  private lockFailed = false;

  get locked(): boolean {
    return document.pointerLockElement !== null;
  }

  /** Con el puntero capturado, o jugando sin captura porque el navegador no la dio. */
  get active(): boolean {
    return this.locked || this.lockFailed;
  }

  requestLock(target: HTMLElement): void {
    if (this.active) return;
    try {
      const p = target.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown;
      if (p instanceof Promise) {
        p.catch(() => {
          try {
            const again = target.requestPointerLock() as unknown;
            if (again instanceof Promise) again.catch(() => (this.lockFailed = true));
          } catch {
            this.lockFailed = true;
          }
        });
      }
    } catch {
      this.lockFailed = true;
    }
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  setView(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  attach(target: HTMLElement): () => void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.enabled && !this.watching) return;

      if (e.code === "Tab") {
        e.preventDefault();
        if (!e.repeat) this.intents.push("scoreboardOn");
        return;
      }
      if (this.uiBusy) {
        // La pantalla de compra tiene sus propias teclas; sólo B la cierra desde acá.
        if (e.code === "KeyB" && !e.repeat) this.intents.push("buy");
        return;
      }
      if (e.code === "KeyB" && !e.repeat && this.enabled) {
        this.intents.push("buy");
        return;
      }
      if ((e.code === "Enter" || e.code === "KeyY") && !e.repeat) {
        this.intents.push("chat");
        e.preventDefault();
        return;
      }
      if (this.watching && !this.enabled) {
        if ((e.code === "Space" || e.code === "KeyE") && !e.repeat) this.intents.push("spectateNext");
        if (e.code === "Space") e.preventDefault();
        return;
      }
      if (!this.enabled) return;

      if (e.code === "KeyR") this.reloadQueued = true;
      if (e.code === "KeyQ" && !e.repeat) this.intents.push("lastWeapon");
      if (JUMP.has(e.code) && !e.repeat) this.jumpQueued = true;
      const action = ACTION_KEYS[e.code];
      if (action !== undefined && !e.repeat) this.pendingAction = action;
      this.keys.add(e.code);
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Tab") this.intents.push("scoreboardOff");
      this.keys.delete(e.code);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!this.active) return;
      const k = this.sensitivity * (this.scoped ? this.scopedFactor : 1);
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k;
      if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
      if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
      // Mantener el yaw acotado: viaja en milirradianes de -π a π.
      while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!this.active) {
        if (this.enabled || this.watching) this.requestLock(target);
        return;
      }
      if (this.watching && !this.enabled) {
        if (e.button === 0) this.intents.push("spectateNext");
        return;
      }
      if (!this.enabled || this.uiBusy) return;
      if (e.button === 0) {
        this.shooting = true;
        this.shotQueued = true;
        this.shotTrigger = true;
      }
      if (e.button === 2) this.scoping = true;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.shooting = false;
      if (e.button === 2) this.scoping = false;
    };

    const onBlur = () => this.releaseAll();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    target.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
    target.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      target.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onBlur);
    };
  }

  /** Una acción pedida desde afuera (un botón de la interfaz), como si se apretara su tecla. */
  queueAction(action: number): void {
    this.pendingAction = action;
  }

  /** ¿Se apretó el gatillo desde el último input? Se consume al leerlo. */
  takeShotTrigger(): boolean {
    const t = this.shotTrigger;
    this.shotTrigger = false;
    return t;
  }

  takeIntents(): UiIntent[] {
    if (this.intents.length === 0) return [];
    const out = this.intents;
    this.intents = [];
    return out;
  }

  private axis(neg: Set<string>, pos: Set<string>): number {
    let v = 0;
    for (const key of this.keys) {
      if (neg.has(key)) v -= 1;
      if (pos.has(key)) v += 1;
    }
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }

  private any(set: Set<string>): boolean {
    for (const key of this.keys) if (set.has(key)) return true;
    return false;
  }

  /** Las teclas de movimiento tal cual, para la cámara libre del espectador. */
  freeMove(): { fwd: number; side: number; up: number; fast: boolean } {
    return {
      fwd: this.axis(BACK, FWD),
      side: this.axis(LEFT, RIGHT),
      up: (this.any(JUMP) ? 1 : 0) - (this.any(CROUCH) ? 1 : 0),
      fast: this.any(WALK),
    };
  }

  /** Arma el input de este tick. `view` es el tick del servidor que se está dibujando. */
  sample(seq: number, view: number): PlayerInput {
    const busy = this.uiBusy;
    const input: PlayerInput = {
      seq,
      fwd: busy ? 0 : this.axis(BACK, FWD),
      side: busy ? 0 : this.axis(LEFT, RIGHT),
      // Redondeado a milirradianes, que es como viaja: así la predicción usa
      // exactamente el mismo ángulo que el servidor.
      yaw: Math.round(this.yaw * 1000) / 1000,
      pitch: Math.round(this.pitch * 1000) / 1000,
      shoot: !busy && (this.shooting || this.shotQueued),
      reload: this.reloadQueued,
      jump: !busy && (this.jumpQueued || this.any(JUMP)),
      crouch: !busy && this.any(CROUCH),
      walk: this.any(WALK),
      scope: !busy && this.scoping,
      // E sostenida: plantar o desactivar la bomba.
      use: !busy && this.keys.has("KeyE"),
      act: this.pendingAction,
      view,
    };
    this.reloadQueued = false;
    this.shotQueued = false;
    this.shotTrigger = false;
    this.jumpQueued = false;
    this.pendingAction = ACT_NONE;
    return input;
  }

  releaseAll(): void {
    this.keys.clear();
    this.shooting = false;
    this.scoping = false;
    this.shotQueued = false;
    this.jumpQueued = false;
    this.pendingAction = ACT_NONE;
  }
}
