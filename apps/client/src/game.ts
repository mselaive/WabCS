import * as THREE from "three";
import {
  ACT_BUY_BASE,
  ACT_SLOT_0,
  BTN_CROUCH,
  BTN_JUMP,
  BTN_RELOAD,
  BTN_SCOPE,
  BTN_SHOOT,
  BTN_USE,
  BTN_WALK,
  BOMB_USE_RANGE,
  BUY_RADIUS,
  BUY_TICKS,
  FOV,
  FOV_SCOPED,
  HEAD_HEIGHT,
  HIT_BODY,
  HIT_HEAD,
  HIT_WORLD,
  INTERP_DELAY_MS,
  KNIFE,
  MS_PER_TICK,
  PICKUP_RANGE,
  PLAYER_HALF_W,
  ROUND_TICKS,
  SP_ID,
  TEAM_NAMES,
  TEAM_T,
  ZONE_HEAD,
  distXZ,
  eyeHeightOf,
  grenadeKind,
  heightOf,
  mapByIndex,
  rayAabb,
  recoilOffset,
  shotRange,
  siteAt,
  spreadOf,
  raycastBoxes,
  unpackBomb,
  unpackPlayer,
  unpackRound,
  weapon,
  type GameMap,
  type MatchPhase,
  type PlayerMeta,
  type RayHit,
  type ServerMsg,
  type SimEvent,
  type SnapshotMsg,
  type SnapStanding,
  type UnpackedBomb,
  type UnpackedDrop,
  type UnpackedPlayer,
  type UnpackedRound,
} from "@wabcs/shared";
import { Audio } from "./audio.js";
import { InputController } from "./input.js";
import { Net, diagnoseConnection } from "./net/connection.js";
import { SnapshotBuffer, type InterpolatedFrame } from "./net/interpolation.js";
import { Predictor, type PredictedShot } from "./net/prediction.js";
import { Effects } from "./render/effects.js";
import { Minimap } from "./render/minimap.js";
import { PlayerAvatar, buildCorpse } from "./render/players.js";
import { ViewModel, muzzleOffset } from "./render/viewmodel.js";
import { World } from "./render/world.js";
import type { UI } from "./ui.js";

/** Hasta dónde se dibuja un trazador que no pegó en nada. */
const TRACER_MAX = 120;
/** Cámara del lobby, mirando el mapa desde arriba. */
const LOBBY_CAMERA = new THREE.Vector3(0, 16, 26);

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 220);
  private readonly world = new World();
  private effects!: Effects;
  private viewModel!: ViewModel;
  private minimap!: Minimap;
  private readonly avatars = new Map<number, PlayerAvatar>();
  private readonly avatarGroup = new THREE.Group();
  private readonly corpseGroup = new THREE.Group();
  private map: GameMap = mapByIndex(0);
  readonly input = new InputController();
  readonly audio = new Audio();

  private net: Net | null = null;
  private myId = -1;
  private hostId = -1;
  private roster: PlayerMeta[] = [];
  private winRounds = 8;
  private botSkill = 1;
  private mode = 0;
  /** La bomba según el último snapshot (modo bomba). */
  private latestBomb: UnpackedBomb | null = null;
  private nextBeepAt = 0;
  private phase: MatchPhase = "lobby";
  private readonly buffer = new SnapshotBuffer();
  private predictor: Predictor | null = null;
  private seq = 1;
  private inputAcc = 0;
  private viewTick = -1;
  private canActNow = false;
  private lastFrame = performance.now();
  private roomCode = "";
  private leaving = false;
  private latestStandings: SnapStanding[] = [];
  private latestRound: UnpackedRound | null = null;
  private wasReloading = false;
  private prevActive = -1;
  private lastSlot = 1;
  private deathInfo: string | null = null;
  private spectateIndex = 0;
  private freeCam = false;
  private readonly freePos = new THREE.Vector3();
  private stage!: HTMLElement;
  /** Sacudida de la cámara por los tiros (radianes), que vuelve sola. */
  private punchPitch = 0;
  private punchYaw = 0;
  /** El último cuadro interpolado de los demás: contra esto se predicen los impactos. */
  private lastInterp: InterpolatedFrame | null = null;
  /** Impactos que ya se mostraron al predecir: el `hit` del servidor no los repite. */
  private predictedHits = 0;
  private stepDist = 1.2;
  private stepLeft = false;
  private wasOnGround = true;
  private lastVy = 0;
  private landDip = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  private prevShoot = false;
  /** Una flash que acaba de estallar: con el próximo snapshot se sabe cuánto me cegó. */
  private pendingFlash: { x: number; z: number; at: number } | null = null;
  private blindMax = 0;

  constructor(private readonly ui: UI) {}

  async init(): Promise<void> {
    this.stage = document.getElementById("stage")!;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.stage.appendChild(this.renderer.domElement);

    this.camera.rotation.order = "YXZ";
    this.world.scene.add(this.camera);
    this.world.scene.add(this.avatarGroup);
    this.world.scene.add(this.corpseGroup);
    this.effects = new Effects(this.world.scene);
    this.viewModel = new ViewModel(this.camera);
    this.viewModel.setHidden(true);
    this.world.setEnvironment(this.renderer);
    this.minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement);
    this.loadMap(0);
    this.lobbyCamera();

    this.input.attach(this.stage);
    document.addEventListener("pointerlockchange", () => this.onLockChange());
    window.addEventListener("mousedown", () => this.audio.unlock(), { passive: true });
    window.addEventListener("keydown", (e) => this.onUiKey(e));
    window.addEventListener("resize", () => this.resize());
    this.resize();

    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  get volume(): number {
    return this.audio.volume;
  }

  /** Para mirar desde la consola: dónde está la cámara y qué predice. */
  debugState(): { x: number; y: number; z: number; yaw: number; pitch: number; alive: boolean; hp: number; phase: string; pending: number; corrections: number } {
    const s = this.predictor?.state;
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      yaw: this.input.yaw,
      pitch: this.input.pitch,
      alive: s?.alive ?? false,
      hp: s?.hp ?? 0,
      phase: this.phase,
      pending: this.predictor?.pendingCount ?? 0,
      corrections: this.predictor?.corrections ?? 0,
    };
  }

  setVolume(v: number): void {
    this.audio.setVolume(v);
  }

  setSensitivity(v: number): void {
    this.input.sensitivity = v * 0.0002;
  }

  private resize(): void {
    const w = this.stage.clientWidth || window.innerWidth;
    const h = this.stage.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private lobbyCamera(): void {
    this.camera.position.copy(LOBBY_CAMERA);
    this.camera.lookAt(0, 0, 0);
  }

  // ------------------------------------------------------------ conexión

  connect(code: string, name: string): void {
    this.disconnect();
    this.leaving = false;
    this.roomCode = code;
    this.ui.showScreen("connecting");
    this.ui.setRoom(code);
    this.net = new Net({
      room: code,
      name,
      onMessage: (msg) => this.onMessage(msg),
      onOpen: () => {
        document.getElementById("reconnecting")!.hidden = true;
      },
      onClose: (closeCode) => {
        if (this.leaving) return;
        if (closeCode === 4001) {
          this.disconnect();
          this.ui.showError("Abriste la sala en otra pestaña: esa se quedó con tu lugar.");
          return;
        }
        if (closeCode === 4000 || closeCode === 4002) return; // llegó un err antes
        if (this.phase === "playing" || this.phase === "countdown") {
          document.getElementById("reconnecting")!.hidden = false;
        } else if (this.phase === "lobby" && this.myId === -1) {
          void diagnoseConnection(code).then((why) => {
            this.disconnect();
            this.ui.showError(why);
          });
        }
      },
      onError: () => {},
    });
  }

  disconnect(): void {
    this.leaving = true;
    this.practiceBots = 0;
    this.net?.close();
    this.net = null;
    this.myId = -1;
    this.predictor = null;
    this.phase = "lobby";
    this.buffer.clear();
    this.clearMatchScene();
    this.ui.setHud(false);
    this.input.enabled = false;
    this.input.watching = false;
    this.input.releaseLock();
    this.viewModel.setHidden(true);
    this.lobbyCamera();
    document.getElementById("reconnecting")!.hidden = true;
  }

  setReady(ready: boolean): void {
    this.net?.send({ t: "ready", ready });
  }

  requestStart(): void {
    this.net?.send({ t: "start" });
  }

  kick(id: number): void {
    this.net?.send({ t: "kick", id });
  }

  addBot(): void {
    this.net?.send({ t: "bot" });
  }

  private practiceBots = 0;

  /** Al entrar a la sala (si soy el host), agregar bots y marcar listo: arranca sola. */
  practiceOnJoin(bots: number): void {
    this.practiceBots = bots;
  }

  setBotSkill(skill: number): void {
    this.net?.send({ t: "botSkill", skill });
  }

  setTeam(team: number): void {
    this.net?.send({ t: "team", team });
  }

  setRounds(win: number): void {
    this.net?.send({ t: "rounds", win });
  }

  setMode(mode: number): void {
    this.net?.send({ t: "mode", mode });
  }

  setMap(map: number): void {
    this.net?.send({ t: "map", map });
  }

  chat(text: string): void {
    this.net?.send({ t: "chat", text });
  }

  buy(index: number): void {
    this.input.queueAction(ACT_BUY_BASE + index);
  }

  private get myTeam(): number {
    return this.predictor?.state.team ?? this.roster.find((p) => p.id === this.myId)?.team ?? TEAM_T;
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.myId = msg.you;
        this.hostId = msg.hostId;
        this.roster = msg.roster;
        this.winRounds = msg.winRounds;
        this.loadMap(msg.map);
        this.ui.setRoom(msg.room);
        this.ui.updateLobby(this.roster, this.hostId, this.myId, this.winRounds, this.botSkill, this.mode, msg.map);
        if (msg.phase === "lobby") this.ui.showScreen("lobby");
        document.getElementById("reconnecting")!.hidden = true;
        if (this.practiceBots > 0 && this.hostId === this.myId && msg.phase === "lobby") {
          for (let i = 0; i < this.practiceBots; i++) this.addBot();
          this.setReady(true);
        }
        this.practiceBots = 0;
        return;
      case "roster":
        this.roster = msg.roster;
        this.hostId = msg.hostId;
        this.winRounds = msg.winRounds;
        this.botSkill = msg.botSkill;
        this.mode = msg.mode;
        // El mapa elegido se ve de fondo en la sala.
        if (this.phase === "lobby") this.loadMap(msg.map);
        this.ui.updateLobby(this.roster, this.hostId, this.myId, this.winRounds, this.botSkill, this.mode, msg.map, msg.nextIn);
        return;
      case "start":
        this.loadMap(msg.map);
        this.beginMatch();
        return;
      case "s":
        this.onSnapshot(msg);
        return;
      case "err":
        this.disconnect();
        this.ui.showError(msg.message);
        return;
      case "chat":
        this.ui.addChat(this.ui.nameOf(msg.by), msg.text, this.phase === "playing");
        return;
    }
  }

  private mapLoaded = -1;

  private loadMap(index: number): void {
    if (index === this.mapLoaded) return;
    this.mapLoaded = index;
    this.map = mapByIndex(index);
    this.world.load(this.map);
    this.minimap.load(this.map);
  }

  private beginMatch(): void {
    this.buffer.clear();
    this.predictor = null;
    this.seq = 1;
    this.viewTick = -1;
    this.inputAcc = 0;
    this.deathInfo = null;
    this.spectateIndex = 0;
    this.freeCam = false;
    this.clearMatchScene();
  }

  private clearMatchScene(): void {
    for (const a of this.avatars.values()) {
      this.avatarGroup.remove(a.root);
      a.dispose();
    }
    this.avatars.clear();
    this.corpseGroup.clear();
    this.effects.clear();
    this.world.clearDrops();
  }

  // ------------------------------------------------------------ snapshots

  private onSnapshot(msg: SnapshotMsg): void {
    const now = performance.now();
    this.buffer.push(msg, now);
    this.latestStandings = msg.st;
    this.latestRound = unpackRound(msg.rd);
    this.latestBomb = msg.bm ? unpackBomb(msg.bm) : null;

    if (msg.phase !== this.phase) this.setPhase(msg.phase, msg);

    if (msg.phase === "countdown") {
      this.ui.showBanner(`Empieza en ${Math.max(1, Math.ceil(msg.left / 20))}`, "gold", 1200);
    }

    if (msg.phase === "playing") {
      this.canActNow = this.latestRound.phase !== "freeze";
      const mine = msg.players.find((t) => t[SP_ID] === this.myId);
      if (mine) {
        const me = unpackPlayer(mine);
        if (!this.predictor) {
          this.predictor = new Predictor(this.myId);
          this.predictor.reset(me);
          this.input.setView(me.yaw, me.pitch);
          this.prevActive = me.active;
        } else if (!this.predictor.state.alive && me.alive) {
          // Empieza una ronda: a su spawn, mirando hacia donde mira el spawn.
          this.predictor.reset(me);
          this.input.setView(me.yaw, me.pitch);
          this.deathInfo = null;
          this.ui.setSpectating(null);
          this.freeCam = false;
        } else {
          this.predictor.reconcile(me, this.map, this.canActNow);
        }
        // La flash: el servidor dice cuánto quedé ciego.
        if (this.pendingFlash && me.own) {
          const seconds = me.own.blindTicks / 20;
          this.audio.flashbang(this.pendingFlash.x, this.pendingFlash.z, seconds);
          if (me.own.blindTicks > 0) this.blindMax = Math.max(this.blindMax, me.own.blindTicks);
          this.pendingFlash = null;
        }
      }
      for (const ev of msg.ev ?? []) this.onEvent(ev);
    }
  }

  private setPhase(phase: MatchPhase, msg: SnapshotMsg): void {
    this.phase = phase;
    switch (phase) {
      case "lobby":
        this.predictor = null;
        this.clearMatchScene();
        this.ui.setHud(false);
        this.ui.setSpectating(null);
        this.input.releaseLock();
        this.viewModel.setHidden(true);
        this.lobbyCamera();
        this.ui.showScreen("lobby");
        break;
      case "countdown":
      case "playing":
        this.ui.hideScreens();
        this.ui.setHud(true);
        this.lockHintShown = false;
        this.refreshLockHint();
        break;
      case "ended": {
        this.input.releaseLock();
        this.ui.setHud(false);
        this.ui.setSpectating(null);
        this.viewModel.setHidden(true);
        const round = unpackRound(msg.rd);
        this.ui.showResult(msg.winner, round.score, msg.st, this.myTeam);
        break;
      }
    }
  }

  private onEvent(ev: SimEvent): void {
    switch (ev.t) {
      case "shot":
        this.onShotEvent(ev);
        return;
      case "hit":
        if (ev.targetId === this.myId) {
          // De dónde vino: del que disparó si se lo ve; si no, del punto de impacto.
          const by = this.buffer.latest?.players.get(ev.byId);
          const s = this.predictor?.state;
          const fx = (by?.x ?? ev.x) - (s?.x ?? ev.x);
          const fz = (by?.z ?? ev.z) - (s?.z ?? ev.z);
          const toward = Math.atan2(-fx, -fz);
          let rel = toward - this.input.yaw;
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          this.ui.damageFlash(rel);
          this.audio.hurt();
        }
        if (ev.byId === this.myId) {
          // Si ya se mostró al predecir, no se repite.
          if (this.predictedHits > 0) this.predictedHits--;
          else {
            this.ui.hitmarker(ev.zone === ZONE_HEAD);
            this.audio.hitmarker(ev.zone === ZONE_HEAD);
          }
        }
        return;
      case "kill": {
        this.ui.addKill(ev.byId, ev.targetId, ev.weapon, ev.headshot, this.myId);
        this.spawnCorpse(ev.targetId);
        if (ev.byId === this.myId && ev.targetId !== this.myId) this.audio.kill();
        if (ev.targetId === this.myId) {
          const killer = this.buffer.latest?.players.get(ev.byId);
          const left = killer ? ` · le quedaban <b>${killer.hp}</b> de vida` : "";
          this.deathInfo = `Te mató <b>${this.ui.nameOf(ev.byId)}</b> con ${weapon(ev.weapon).name}${ev.headshot ? " (en la cabeza)" : ""}${left}`;
          this.ui.closeBuy();
        }
        return;
      }
      case "round":
        this.onRoundEvent(ev.phase, ev.number, ev.winner, ev.reason);
        return;
      case "swap":
        this.ui.showBanner("Cambio de lado", "gold", 3000, "Todo de vuelta a cero: dinero y armas");
        return;
      case "buy":
        if (ev.byId === this.myId) this.audio.buy();
        return;
      case "pickup":
        if (ev.byId === this.myId) this.audio.buy();
        return;
      case "reload": {
        if (ev.byId !== this.myId) this.audio.reload(ev.x, ev.z);
        return;
      }
      case "steps":
        this.audio.step(ev.x, ev.z);
        return;
      case "throw": {
        const who = this.buffer.latest?.players.get(ev.byId);
        if (ev.byId !== this.myId && who) this.audio.throwNade(who.x, who.z);
        return;
      }
      case "bomb": {
        const at = new THREE.Vector3(ev.x, ev.y, ev.z);
        if (ev.what === "planted") {
          this.ui.showBanner(`Bomba plantada en ${ev.site}`, "t", 2500, "40 segundos");
          this.audio.bombPlanted();
          this.nextBeepAt = performance.now();
        } else if (ev.what === "defused") {
          this.audio.bombDefused();
        } else if (ev.what === "exploded") {
          this.effects.explosion(at);
          this.effects.explosion(at.clone().add(new THREE.Vector3(1, 0.5, 0)));
          this.effects.flash(at, 300);
          this.audio.bombExplosion(ev.x, ev.z);
          this.punchPitch += 0.08;
          this.landDip = 1;
        } else if (ev.what === "dropped" && ev.byId === this.myId) {
          this.ui.showBanner("Se te cayó la bomba", "gold", 1500);
        } else if (ev.what === "picked" && ev.byId === this.myId) {
          this.ui.showBanner("Tenés la bomba", "gold", 1500, "E dentro del sitio para plantarla");
        }
        return;
      }
      case "explode": {
        const at = new THREE.Vector3(ev.x, ev.y, ev.z);
        if (ev.kind === 0) {
          this.effects.explosion(at);
          this.audio.explosion(ev.x, ev.z);
        } else if (ev.kind === 1) {
          this.effects.flash(at, 40);
          // Cuánto me cegó lo dice el próximo snapshot; el pitido arranca con eso.
          this.pendingFlash = { x: ev.x, z: ev.z, at: performance.now() };
        } else {
          this.audio.smoke(ev.x, ev.z);
        }
        return;
      }
    }
  }

  private onRoundEvent(phase: "freeze" | "live" | "over", number: number, winner: number, reason: string): void {
    if (phase === "freeze") {
      this.corpseGroup.clear();
      this.effects.clear();
      this.world.clearDrops();
      this.ui.showBanner(`Ronda ${number}`, "gold", 2200, "Tiempo de compra: apretá B");
      this.audio.roundStart();
    } else if (phase === "live") {
      this.ui.showBanner("¡Adelante!", "", 1000);
      this.ui.closeBuy();
    } else if (winner >= 0) {
      const won = winner === this.myTeam;
      const why =
        reason === "time" ? "Se acabó el tiempo" : reason === "bomb" ? "Estalló la bomba" : reason === "defuse" ? "Desactivaron la bomba" : "Eliminaron al equipo rival";
      this.ui.showBanner(`Ganan los ${TEAM_NAMES[winner as 0 | 1]}`, winner === TEAM_T ? "t" : "ct", 4500, why);
      this.audio.roundEnd(won);
      this.ui.setBombClock(null);
    }
  }

  private spawnCorpse(victimId: number): void {
    let x: number, y: number, z: number, yaw: number, team: number;
    if (victimId === this.myId && this.predictor) {
      const s = this.predictor.state;
      x = s.x; y = s.y; z = s.z; yaw = s.yaw; team = s.team;
    } else {
      const p = this.buffer.latest?.players.get(victimId);
      if (!p) return;
      x = p.x; y = p.y; z = p.z; yaw = p.yaw; team = p.team;
    }
    this.corpseGroup.add(buildCorpse(team, x, y, z, yaw));
  }

  /** Un tiro de otro (o la confirmación del propio): trazador, polvo o sangre. */
  private onShotEvent(ev: Extract<SimEvent, { t: "shot" }>): void {
    const own = ev.byId === this.myId;
    if (!own) {
      if (ev.hits.length === 0) {
        this.audio.distantShot(ev.x, ev.z);
        return;
      }
      this.audio.shot(ev.weapon, ev.x, ev.z);
    }
    const avatar = this.avatars.get(ev.byId);
    const from = avatar && avatar.root.visible ? avatar.muzzle.clone() : new THREE.Vector3(ev.x, ev.y, ev.z);
    if (!own && weapon(ev.weapon).melee === 0) this.effects.flash(from, 10);
    for (let i = 0; i + 3 < ev.hits.length; i += 4) {
      const to = new THREE.Vector3(ev.hits[i]!, ev.hits[i + 1]!, ev.hits[i + 2]!);
      const kind = ev.hits[i + 3]!;
      if (!own && weapon(ev.weapon).melee === 0) this.effects.tracer(from, to);
      if (kind === HIT_WORLD) {
        this.effects.dust(to);
        // El agujero: el tiro propio ya lo puso la predicción.
        if (!own) {
          this.holeAt(ev.x, ev.y, ev.z, to);
          this.audio.impact(to.x, to.z);
        }
      } else if (kind === HIT_BODY || kind === HIT_HEAD) {
        this.effects.blood(to, kind === HIT_HEAD);
      }
    }
  }

  /** Un agujero de bala donde terminó un tiro: se vuelve a tirar el rayo para saber contra qué cara pegó. */
  private holeAt(ox: number, oy: number, oz: number, to: THREE.Vector3): void {
    const dx = to.x - ox;
    const dy = to.y - oy;
    const dz = to.z - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    const hit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0 };
    if (raycastBoxes(ox, oy, oz, dx / len, dy / len, dz / len, this.map.boxes, len + 0.05, hit) < 0) return;
    this.effects.bulletHole(to, new THREE.Vector3(hit.nx, hit.ny, hit.nz));
  }

  // ------------------------------------------------------------ cuadro a cuadro

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.handleIntents();
    this.refreshLockHint();
    if (this.phase === "playing") this.updatePlaying(now, dt);
    else if (this.phase === "countdown") {
      const frame = this.buffer.sample(now - INTERP_DELAY_MS);
      if (frame) this.updateOthers(frame, dt);
    }

    this.effects.update(dt);
    this.audio.listenerYaw = this.camera.rotation.y;
    this.audio.listenerX = this.camera.position.x;
    this.audio.listenerZ = this.camera.position.z;
    this.renderer.render(this.world.scene, this.camera);
  }

  private handleIntents(): void {
    for (const intent of this.input.takeIntents()) {
      switch (intent) {
        case "buy":
          if (this.ui.isBuyOpen) this.ui.closeBuy();
          else if (this.phase === "playing" && this.predictor?.state.alive) this.ui.openBuy(this.myTeam, this.predictor.state.money);
          break;
        case "scoreboardOn":
          this.ui.setScoreboard(true);
          if (this.latestRound) this.ui.updateScoreboard(this.latestStandings, this.myId, this.latestRound.score);
          break;
        case "scoreboardOff":
          this.ui.setScoreboard(false);
          break;
        case "chat":
          if (this.phase === "playing" && !this.ui.isTeamChatOpen) this.ui.openTeamChat();
          break;
        case "lastWeapon": {
          const s = this.predictor?.state;
          if (s && s.alive && this.lastSlot !== s.active && (s.slots[this.lastSlot] ?? -1) >= 0) {
            this.input.queueAction(ACT_SLOT_0 + this.lastSlot);
          }
          break;
        }
        case "spectateNext":
          this.spectateIndex++;
          break;
      }
    }
  }

  private onUiKey(e: KeyboardEvent): void {
    if (!this.ui.isBuyOpen) return;
    if (e.code.startsWith("Digit")) {
      this.ui.buyByKey(e.code.slice(5));
      e.preventDefault();
    } else if (e.code === "KeyC") {
      this.ui.buyByKey("C");
    } else if (e.code === "KeyK") {
      this.ui.buyByKey("K");
    } else if (e.code === "Escape") {
      this.ui.closeBuy();
    }
  }

  private onLockChange(): void {
    if (!this.input.locked) this.input.releaseAll();
    this.refreshLockHint();
  }

  private lockHintShown = false;

  private refreshLockHint(): void {
    const show = (this.phase === "playing" || this.phase === "countdown") && !this.input.active;
    if (show === this.lockHintShown) return;
    this.lockHintShown = show;
    this.ui.setLockHint(show, "Hacé click para jugar");
  }

  private updatePlaying(now: number, dt: number): void {
    const frame = this.buffer.sample(now - INTERP_DELAY_MS);
    if (frame) {
      this.viewTick = frame.tick;
      this.lastInterp = frame;
      this.updateOthers(frame, dt);
      this.world.updateDrops(frame.drops);
      this.world.updateGrenades(frame.grenades, dt);
      this.world.updateSmokes(frame.smokes, dt);
      this.updateRoundHud(frame.round);
      const s = this.predictor?.state;
      this.minimap.draw(
        s ? { x: s.x, z: s.z, yaw: this.input.yaw, team: s.team, alive: s.alive } : null,
        frame.players,
        frame.grenades,
        frame.smokes,
        this.myId,
        this.latestBomb,
      );
      this.world.updateBomb(this.latestBomb);
    }

    const me = this.predictor;
    const alive = me?.state.alive ?? false;
    this.input.uiBusy = this.ui.isBuyOpen || this.ui.isTeamChatOpen;
    this.input.enabled = alive && !this.ui.isTeamChatOpen;
    this.input.watching = !alive;

    if (me && alive) {
      this.inputAcc += dt * 1000;
      // El gatillo no espera al próximo tick: el input sale ya, y el siguiente
      // se atrasa lo mismo, así el ritmo promedio sigue siendo 20 por segundo.
      if (this.input.takeShotTrigger() && this.inputAcc < MS_PER_TICK && !this.input.uiBusy) {
        this.sendInput();
        this.inputAcc -= MS_PER_TICK;
      }
      let ran = 0;
      while (this.inputAcc >= MS_PER_TICK && ran < 4) {
        this.inputAcc -= MS_PER_TICK;
        this.sendInput();
        ran++;
      }
      if (this.inputAcc > MS_PER_TICK) this.inputAcc = 0;

      const s = me.state;
      if (s.active !== this.prevActive) {
        this.lastSlot = this.prevActive >= 0 ? this.prevActive : this.lastSlot;
        this.prevActive = s.active;
        this.audio.draw();
      }

      // Aterrizar: un golpe, y la cámara y el arma se hunden un instante.
      if (s.onGround && !this.wasOnGround) {
        const hard = this.lastVy < -6;
        this.audio.land(hard);
        this.viewModel.land(hard ? 1 : 0.5);
        this.landDip = hard ? 1 : 0.5;
      }
      this.wasOnGround = s.onGround;
      this.lastVy = s.vy;
      this.landDip = Math.max(0, this.landDip - dt * 6);

      // Pasos propios: corriendo en el piso, cada 1,7 m, alternando el pie.
      const horiz = Math.hypot(s.vx, s.vz);
      if (s.onGround && horiz > 3.2) {
        this.stepDist += horiz * dt;
        if (this.stepDist >= 1.7) {
          this.stepDist = 0;
          this.stepLeft = !this.stepLeft;
          this.audio.ownStep(this.stepLeft);
        }
      } else if (horiz < 0.5) {
        this.stepDist = 1.2;
      }

      const pos = me.renderPosition(dt, this.inputAcc / MS_PER_TICK);
      this.camera.position.set(pos.x, pos.y + eyeHeightOf({ crouch: pos.crouch }) - this.landDip * 0.09, pos.z);
      // La sacudida es cosmética: la mira (y las balas) siguen al mouse, no a esto.
      const decay = Math.exp(-dt * 9);
      this.punchPitch *= decay;
      this.punchYaw *= decay;
      this.camera.rotation.set(this.input.pitch + this.punchPitch, this.input.yaw + this.punchYaw, 0);

      const wid = s.slots[s.active] ?? KNIFE;
      if (s.reloading && !this.wasReloading) {
        this.viewModel.reload(weapon(wid).reloadTicks * 0.05);
        this.audio.reload(null, null);
      }
      this.wasReloading = s.reloading;

      this.viewModel.setWeapon(wid);
      this.viewModel.setHidden(s.scoped);
      let lookDx = this.input.yaw - this.prevYaw;
      if (lookDx > Math.PI) lookDx -= Math.PI * 2;
      if (lookDx < -Math.PI) lookDx += Math.PI * 2;
      const lookDy = this.input.pitch - this.prevPitch;
      this.prevYaw = this.input.yaw;
      this.prevPitch = this.input.pitch;
      this.viewModel.update(dt, horiz, s.onGround, s.reloading, lookDx, lookDy);
      this.input.scoped = s.scoped;
      this.applyFov(s.scoped ? FOV_SCOPED : FOV, dt);
      this.ui.setScope(s.scoped);
      this.ui.setCrosshair(!s.scoped && weapon(wid).melee === 0 && grenadeKind(wid) < 0, spreadOf(s, weapon(wid), s.recoil));

      this.ui.setVitals(s.hp, s.armor, s.helmet);
      this.ui.setMoney(s.money);
      const held = grenadeKind(wid);
      this.ui.setAmmo(wid, held >= 0 ? (s.grenades[held] ?? 0) : (s.ammo[s.active] ?? 0), s.reserve[s.active] ?? 0, s.slots, s.active);
      this.ui.setGrenades(s.grenades, held);
      // Ciego: blanco que se va yendo con los ticks que quedan.
      if (s.blindTicks <= 0) this.blindMax = 0;
      this.ui.setBlind(this.blindMax > 0 ? Math.min(1, (s.blindTicks / this.blindMax) * 1.3) : 0);
      if (this.ui.isBuyOpen) this.ui.renderBuy(s.team, s.money);
      this.ui.setPickupPrompt(frame ? nearestDropWeapon(frame.drops, s.x, s.y, s.z) : null);
      this.ui.setSpectating(null);
      if (frame) this.updateBuyHint(frame.round, s.x, s.z, s.team);
      this.updateBombHud(s.x, s.z, s.team, s.hasBomb, true);
    } else {
      this.viewModel.setHidden(true);
      this.ui.setScope(false);
      this.ui.setCrosshair(false, 0);
      this.ui.setBlind(0);
      this.ui.setFreezeInfo(null);
      this.ui.setPickupPrompt(null);
      this.applyFov(FOV, dt);
      this.spectate(frame, dt);
      this.updateBombHud(0, 0, this.myTeam, false, false);
    }

    if (!this.ui.scoreboardHidden && this.latestRound) this.ui.updateScoreboard(this.latestStandings, this.myId, this.latestRound.score);
  }

  private applyFov(target: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 18);
    const next = this.camera.fov + (target - this.camera.fov) * k;
    if (Math.abs(next - this.camera.fov) > 0.01) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  private sendInput(): void {
    const me = this.predictor;
    if (!me || !this.net) return;
    const input = this.input.sample(this.seq++, this.viewTick);
    // Gatillo con todo vacío: el clic en seco.
    if (input.shoot && !this.prevShoot) {
      const s = me.state;
      const w = weapon(s.slots[s.active] ?? KNIFE);
      if (w.mag > 0 && (s.ammo[s.active] ?? 0) === 0 && (s.reserve[s.active] ?? 0) === 0) this.audio.dryFire();
    }
    this.prevShoot = input.shoot;
    const shot = me.apply(input, this.map, this.canActNow);
    let btn = 0;
    if (input.shoot) btn |= BTN_SHOOT;
    if (input.reload) btn |= BTN_RELOAD;
    if (input.jump) btn |= BTN_JUMP;
    if (input.crouch) btn |= BTN_CROUCH;
    if (input.walk) btn |= BTN_WALK;
    if (input.scope) btn |= BTN_SCOPE;
    if (input.use) btn |= BTN_USE;
    this.net.send({
      t: "in",
      seq: input.seq,
      f: input.fwd,
      s: input.side,
      yaw: Math.round(input.yaw * 1000),
      pit: Math.round(input.pitch * 1000),
      btn,
      act: input.act,
      ...(this.viewTick >= 0 ? { vt: Math.round(this.viewTick * 10) } : {}),
    });
    if (shot) this.onPredictedShot(shot);
  }

  /** Mi tiro, dibujado en el mismo input en que apreté: fogonazo, trazador, polvo. */
  private onPredictedShot(shot: PredictedShot): void {
    const s = this.predictor!.state;
    const w = weapon(shot.weapon);
    this.viewModel.fire();
    if (grenadeKind(shot.weapon) >= 0) {
      this.audio.throwNade(null, null);
      return;
    }
    this.audio.shot(shot.weapon, null, null);
    if (w.melee > 0) return;
    // La cámara salta hacia donde se fue la bala: se ve el patrón y se aprende.
    const r = recoilOffset(w, Math.max(0, s.recoil - 1));
    this.punchPitch = Math.min(0.12, this.punchPitch + w.kick + r.y * 0.35);
    this.punchYaw += r.x * 0.4 + (Math.random() - 0.5) * w.kick * 0.3;
    const ox = s.x;
    const oy = s.y + eyeHeightOf(s);
    const oz = s.z;
    // El trazador sale del caño del arma en pantalla, no del ojo.
    const from = muzzleOffset(shot.weapon).add(this.viewModel.root.position);
    this.camera.updateMatrixWorld();
    this.camera.localToWorld(from);
    this.effects.flash(from, 14);
    // La vaina sale hacia la derecha de la cámara.
    const right = new THREE.Vector3(Math.cos(this.input.yaw), 0, -Math.sin(this.input.yaw));
    this.effects.shell(this.viewModel.ejectPoint(this.camera, new THREE.Vector3()), right);

    // Los rivales tal como se ven ahora: si la bala los toca, la sangre y el
    // hitmarker salen ya; el daño lo confirma el servidor un instante después.
    const enemies = (this.lastInterp?.players ?? []).filter((p) => p.alive && p.connected && p.team !== s.team && p.id !== this.myId);
    const hit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0 };
    let anyHit = false;
    let anyHead = false;
    for (const d of shot.dirs) {
      let t = raycastBoxes(ox, oy, oz, d.x, d.y, d.z, this.map.boxes, shotRange(w), hit);
      const landed = t >= 0;
      if (!landed) t = Math.min(TRACER_MAX, shotRange(w));
      let victim: UnpackedPlayer | null = null;
      let head = false;
      for (const e of enemies) {
        const h = heightOf(e);
        const te = rayAabb(ox, oy, oz, d.x, d.y, d.z, e.x, e.y + h / 2, e.z, PLAYER_HALF_W, h / 2, PLAYER_HALF_W, t);
        if (te < 0 || te >= t) continue;
        t = te;
        victim = e;
        head = oy + d.y * te - e.y > h - HEAD_HEIGHT;
      }
      const to = new THREE.Vector3(ox + d.x * t, oy + d.y * t, oz + d.z * t);
      this.effects.tracer(from, to);
      if (victim) {
        this.effects.blood(to, head);
        anyHit = true;
        anyHead ||= head;
      } else if (landed) {
        this.effects.dust(to);
        this.effects.bulletHole(to, new THREE.Vector3(hit.nx, hit.ny, hit.nz));
      }
    }
    if (anyHit) {
      this.predictedHits++;
      this.ui.hitmarker(anyHead);
      this.audio.hitmarker(anyHead);
    }
  }

  private updateOthers(frame: InterpolatedFrame, dt: number): void {
    const present = new Set<number>();
    const myTeam = this.myTeam;
    for (const p of frame.players) {
      if (p.id === this.myId || !p.alive || !p.connected) continue;
      present.add(p.id);
      let avatar = this.avatars.get(p.id);
      if (!avatar || avatar.team !== p.team) {
        if (avatar) {
          this.avatarGroup.remove(avatar.root);
          avatar.dispose();
        }
        avatar = new PlayerAvatar(this.ui.nameOf(p.id), p.team);
        this.avatars.set(p.id, avatar);
        this.avatarGroup.add(avatar.root);
      }
      avatar.root.visible = true;
      avatar.setLabelVisible(p.team === myTeam);
      avatar.update(p, dt);
    }
    for (const [id, avatar] of this.avatars) if (!present.has(id)) avatar.root.visible = false;
  }

  private updateRoundHud(round: UnpackedRound): void {
    let aliveT = 0;
    let aliveCT = 0;
    for (const s of this.latestStandings) {
      if (!s[3]) continue;
      if (s[4] === TEAM_T) aliveT++;
      else aliveCT++;
    }
    this.ui.setRound(round.number, round.phase, round.ticksLeft, round.score, round.winRounds, aliveT, aliveCT);
  }

  private updateBuyHint(round: UnpackedRound, x: number, z: number, team: number): void {
    if (round.phase === "freeze") {
      this.ui.setFreezeInfo(`Tiempo de compra: ${Math.ceil(round.ticksLeft / 20)} s · B para comprar`);
      return;
    }
    if (round.phase === "live") {
      const left = BUY_TICKS - (ROUND_TICKS - round.ticksLeft);
      const c = this.map.buyCenter[team as 0 | 1];
      if (left > 0 && distXZ(x, z, c.x, c.z) <= BUY_RADIUS) {
        this.ui.setFreezeInfo(`Podés comprar ${Math.ceil(left / 20)} s más (B)`);
        return;
      }
    }
    this.ui.setFreezeInfo(null);
  }

  /** Los carteles de la bomba: la llevás, estás en un sitio, plantando, desactivando, la mecha. */
  private updateBombHud(x: number, z: number, team: number, hasBomb: boolean, alive: boolean): void {
    const b = this.latestBomb;
    // Sin bomba (modo eliminación) o con la ronda ya decidida, nada de esto se muestra.
    if (!b || this.latestRound?.phase === "over") {
      this.ui.setBombInfo(null);
      this.ui.setUseBar(null);
      this.ui.setSiteLabel(null);
      this.ui.setBombClock(null);
      return;
    }
    const site = alive ? siteAt(this.map, x, z) : null;
    this.ui.setSiteLabel(site ? `SITIO ${site.name}` : null);

    if (b.state === 2) {
      this.ui.setBombClock(b.ticksLeft);
      const near = alive && team === 1 && Math.hypot(b.x - x, b.z - z) <= BOMB_USE_RANGE;
      this.ui.setBombInfo(near ? "Sostené E para desactivar" : `Bomba plantada en ${b.site}`, "planted");
      // Los bips: cada vez más seguidos.
      const now = performance.now();
      if (now >= this.nextBeepAt) {
        const frac = b.ticksLeft / 800;
        this.audio.bombBeep(b.x, b.z, frac < 0.15);
        this.nextBeepAt = now + 120 + 900 * frac;
      }
    } else {
      this.ui.setBombClock(null);
      if (hasBomb) this.ui.setBombInfo(site ? "Sostené E para plantar" : "Tenés la bomba: plantala en A o B", "carry");
      else if (b.state === 1 && team === 0) this.ui.setBombInfo("La bomba está en el piso", "carry");
      else this.ui.setBombInfo(null);
    }

    if (b.busyId === this.myId && b.progress > 0) {
      this.ui.setUseBar(b.progress / 100, b.state === 2 ? "Desactivando..." : "Plantando...");
    } else {
      this.ui.setUseBar(null);
    }
  }

  /** Muerto: con los ojos de un compañero vivo, o una cámara libre desde donde caíste. */
  private spectate(frame: InterpolatedFrame | null, dt: number): void {
    const mates = frame ? frame.players.filter((p) => p.alive && p.connected && p.team === this.myTeam && p.id !== this.myId) : [];
    const info = this.deathInfo ?? "Esperando la próxima ronda";
    if (mates.length > 0 && !this.freeCam) {
      const target = mates[this.spectateIndex % mates.length]!;
      this.camera.position.set(target.x, target.y + eyeHeightOf(target), target.z);
      this.camera.rotation.set(target.pitch, target.yaw, 0);
      this.avatars.get(target.id)?.root && (this.avatars.get(target.id)!.root.visible = false);
      this.ui.setSpectating(`${info}<small>Mirando a ${this.ui.nameOf(target.id)} · click para cambiar</small>`);
      return;
    }
    // Cámara libre: arranca donde caíste y se mueve con WASD.
    if (!this.freeCam) {
      this.freeCam = true;
      this.freePos.copy(this.camera.position);
      if (this.predictor) {
        const s = this.predictor.state;
        this.freePos.set(s.x, s.y + eyeHeightOf(s), s.z);
        this.input.setView(s.yaw, s.pitch);
      }
    }
    const mv = this.input.freeMove();
    const speed = (mv.fast ? 14 : 7) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.input.yaw), 0, -Math.cos(this.input.yaw));
    const right = new THREE.Vector3(Math.cos(this.input.yaw), 0, -Math.sin(this.input.yaw));
    this.freePos.addScaledVector(fwd, mv.fwd * speed).addScaledVector(right, mv.side * speed);
    this.freePos.y = Math.max(0.3, this.freePos.y + mv.up * speed);
    this.camera.position.copy(this.freePos);
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);
    this.ui.setSpectating(`${info}<small>Cámara libre: WASD para moverte</small>`);
  }
}

function nearestDropWeapon(drops: readonly UnpackedDrop[], x: number, y: number, z: number): number | null {
  let best: UnpackedDrop | null = null;
  let bestD = PICKUP_RANGE;
  for (const d of drops) {
    const dist = Math.hypot(d.x - x, d.y - y, d.z - z);
    if (dist <= bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best ? best.weapon : null;
}
