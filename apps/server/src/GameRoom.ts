import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  ACT_BUY_BASE,
  BOT_SKILLS,
  BTN_CROUCH,
  BTN_JUMP,
  BTN_RELOAD,
  BTN_SCOPE,
  BTN_SHOOT,
  BTN_WALK,
  BUY_ITEMS,
  COUNTDOWN_TICKS,
  DEFAULT_WIN_ROUNDS,
  EMPTY_ROOM_SHUTDOWN_TICKS,
  InputQueue,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MS_PER_TICK,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  TEAM_CT,
  TEAM_T,
  WIN_ROUNDS_OPTIONS,
  botAlert,
  botInput,
  createBotMemory,
  createGameState,
  createPlayer,
  decodeClient,
  encodeServer,
  eyeHeightOf,
  findPlayer,
  heightOf,
  mapByIndex,
  navGridFor,
  packDrop,
  packPlayer,
  packRound,
  packStandings,
  sanitizeChat,
  sanitizeName,
  sanitizeToken,
  segmentClear,
  smallerTeam,
  startMatch,
  step,
  unpackAngle,
  type BotMemory,
  type ClientMsg,
  type GameState,
  type PlayerInput,
  type PlayerMeta,
  type PlayerState,
  type ServerMsg,
  type SimEvent,
  type SnapPlayer,
} from "@wabcs/shared";

export interface Env {
  GameRoom: DurableObjectNamespace<GameRoom>;
  ALLOWED_ORIGINS?: string;
  DO_LOCATION_HINT?: string;
}

interface ConnState {
  playerId: number;
}

/** Todo lo que el servidor sabe de un jugador sentado en la sala. */
interface Seat {
  playerId: number;
  /** Conexión actual, o null mientras se le guarda el lugar tras un corte. */
  connId: string | null;
  token: string | null;
  goneAt: number;
  meta: PlayerMeta;
  inputs: InputQueue;
  lastChatAt: number;
  /** Si es un bot, lo que recuerda entre ticks. Los bots no tienen conexión. */
  bot: BotMemory | null;
}

/** Nombres para los bots: cortos, para que entren en la tabla. */
const BOT_NAMES = ["Bot Pancho", "Bot Lola", "Bot Toto", "Bot Chela", "Bot Nacho", "Bot Pepa", "Bot Lucho", "Bot Cata", "Bot Tito", "Bot Maru"];

/** Cada cuánto se le da una oportunidad de correr al loop (no es el ritmo del tick). */
const PUMP_INTERVAL_MS = 10;
const MAX_CATCHUP_MS = 250;
const MAX_TICKS_PER_PUMP = 5;
/** Ticks que se sigue viendo a alguien después de perderlo de vista. */
const SIGHT_GRACE_TICKS = 6;
/** Cuánto se espera después de una partida antes de arrancar la siguiente sola. */
const NEXT_MATCH_MS = 15_000;
const CHAT_INTERVAL_MS = 1200;
/** El ángulo más grande que manda un cliente de verdad (π en milirradianes). */
const YAW_LIMIT = 3142;
const PITCH_LIMIT = 1571;
/** Más lejos que esto no se oyen ni los tiros ni los pasos. */
const HEARING_RANGE = 40;
const STEPS_RANGE = 14;

/**
 * Una sala = un Durable Object. Mantiene el estado autoritativo y corre el
 * loop de simulación a 20 Hz mientras haya alguien conectado.
 *
 * Hibernación desactivada a propósito: la hibernación descarta los timers, y
 * acá el timer *es* el juego.
 */
export class GameRoom extends Server<Env> {
  static override options = { hibernate: false };

  private state: GameState = createGameState();
  private seats = new Map<number, Seat>();
  private byToken = new Map<string, number>();
  private events: SimEvent[] = [];
  private nextPlayerId = 1;
  private hostId = -1;
  private kicked = new Set<string>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private emptyTicks = 0;
  private nextMatchAt = 0;
  private lastSeen = new Map<number, Map<number, number>>();
  private lastPumpAt = 0;
  private accumulator = 0;
  private winRounds = DEFAULT_WIN_ROUNDS;
  private mapIndex = 0;
  private map = mapByIndex(0);
  private lastStepsTick = 0;
  /** Dificultad de los bots de la sala (índice en BOT_SKILLS). */
  private botSkill = 1;

  // ------------------------------------------------------------ conexiones

  override onConnect(conn: Connection<ConnState>, ctx: ConnectionContext): void {
    const url = new URL(ctx.request.url);

    const version = url.searchParams.get("v");
    if (version !== null && version !== String(PROTOCOL_VERSION)) {
      this.sendTo(conn, { t: "err", code: "version", message: "Hay una versión nueva del juego: recargá la página." });
      conn.close(4002, "version");
      return;
    }

    const token = sanitizeToken(url.searchParams.get("token"));
    const known = token === null ? undefined : this.byToken.get(token);
    const back = known === undefined ? undefined : this.seats.get(known);
    if (back) {
      this.reattach(conn, back);
      return;
    }

    if (this.seats.size >= MAX_PLAYERS) {
      this.sendTo(conn, { t: "err", code: "room_full", message: `La sala está llena (${MAX_PLAYERS} jugadores).` });
      conn.close(4000, "room full");
      return;
    }

    const name = sanitizeName(url.searchParams.get("name"));
    if (this.kicked.has(name.trim().toLowerCase())) {
      this.sendTo(conn, { t: "err", code: "kicked", message: "El host te sacó de esta sala." });
      conn.close(4000, "kicked");
      return;
    }

    const playerId = this.nextPlayerId++;
    const team = smallerTeam(this.state.players);
    const seat: Seat = {
      playerId,
      connId: conn.id,
      token,
      goneAt: 0,
      meta: { id: playerId, name, team, ready: false },
      inputs: new InputQueue(),
      lastChatAt: 0,
      bot: null,
    };
    this.seats.set(playerId, seat);
    if (token !== null) this.byToken.set(token, playerId);
    conn.setState({ playerId });

    // Quien entra en plena partida mira como espectador y juega la próxima ronda.
    this.state.players.push(createPlayer(playerId, team));
    if (this.hostId === -1) this.hostId = playerId;

    this.sendTo(conn, this.welcome(playerId));
    this.broadcastRoster();
    this.ensureLoop();
  }

  private welcome(playerId: number): ServerMsg {
    return {
      t: "welcome",
      you: playerId,
      room: this.name,
      hostId: this.hostId,
      roster: this.roster(),
      phase: this.state.phase,
      winRounds: this.winRounds,
      map: this.mapIndex,
    };
  }

  override onMessage(conn: Connection<ConnState>, raw: WSMessage): void {
    if (typeof raw !== "string") return;
    const msg = decodeClient(raw);
    if (!msg) return;
    const playerId = conn.state?.playerId;
    if (playerId === undefined) return;
    const seat = this.seats.get(playerId);
    if (!seat) return;
    this.handle(conn, seat, msg);
  }

  override onClose(conn: Connection<ConnState>): void {
    this.dropConnection(conn);
  }

  override onError(conn: Connection<ConnState>): void {
    this.dropConnection(conn);
  }

  /**
   * Se cortó una conexión. En partida no se echa al jugador: se le guarda el
   * lugar RECONNECT_GRACE_MS con el muñeco quieto donde estaba.
   */
  private dropConnection(conn: Connection<ConnState>): void {
    const playerId = conn.state?.playerId;
    if (playerId === undefined) return;
    const seat = this.seats.get(playerId);
    if (!seat || seat.connId !== conn.id) return;

    const inMatch = this.state.phase === "playing" || this.state.phase === "countdown";
    if (!inMatch || seat.token === null) {
      this.removeSeat(playerId);
      return;
    }
    seat.connId = null;
    seat.goneAt = Date.now();
    seat.meta.away = true;
    if (this.hostId === playerId) {
      const next = [...this.seats.values()].find((s) => !s.bot && s.connId !== null);
      if (next) this.hostId = next.playerId;
    }
    this.broadcastRoster();
  }

  private reattach(conn: Connection<ConnState>, seat: Seat): void {
    const previous = seat.connId;
    seat.connId = conn.id;
    seat.goneAt = 0;
    seat.meta.away = false;
    // Si recargó la página, el cliente vuelve a numerar sus inputs desde 1.
    seat.inputs.clear();
    conn.setState({ playerId: seat.playerId });

    if (previous !== null) {
      for (const c of this.getConnections<ConnState>()) {
        if (c.id === previous) c.close(4001, "replaced");
      }
    }

    this.sendTo(conn, this.welcome(seat.playerId));
    if (this.state.phase === "playing") this.sendTo(conn, { t: "start", seed: this.state.seed, map: this.mapIndex });
    this.broadcastRoster();
    this.ensureLoop();
  }

  private expireAbsent(now: number): void {
    for (const seat of [...this.seats.values()]) {
      if (seat.goneAt > 0 && now - seat.goneAt > RECONNECT_GRACE_MS) this.removeSeat(seat.playerId);
    }
  }

  override onRequest(): Response {
    return Response.json({
      room: this.name,
      phase: this.state.phase,
      players: this.seats.size,
      max: MAX_PLAYERS,
    });
  }

  // ------------------------------------------------------------ mensajes

  private handle(conn: Connection<ConnState>, seat: Seat, msg: ClientMsg): void {
    switch (msg.t) {
      case "in": {
        if (typeof msg.seq !== "number" || !Number.isFinite(msg.seq)) return;
        const btn = typeof msg.btn === "number" ? msg.btn | 0 : 0;
        seat.inputs.push({
          seq: msg.seq,
          fwd: clampAxis(msg.f),
          side: clampAxis(msg.s),
          yaw: unpackAngle(clampInt(msg.yaw, -YAW_LIMIT, YAW_LIMIT)),
          pitch: unpackAngle(clampInt(msg.pit, -PITCH_LIMIT, PITCH_LIMIT)),
          shoot: (btn & BTN_SHOOT) !== 0,
          reload: (btn & BTN_RELOAD) !== 0,
          jump: (btn & BTN_JUMP) !== 0,
          crouch: (btn & BTN_CROUCH) !== 0,
          walk: (btn & BTN_WALK) !== 0,
          scope: (btn & BTN_SCOPE) !== 0,
          view: typeof msg.vt === "number" && Number.isFinite(msg.vt) && msg.vt >= 0 ? msg.vt / 10 : -1,
          act:
            typeof msg.act === "number" && Number.isInteger(msg.act) && msg.act >= 0 && msg.act < ACT_BUY_BASE + BUY_ITEMS.length
              ? msg.act
              : 0,
        });
        return;
      }

      case "ready": {
        seat.meta.ready = msg.ready === true;
        this.broadcastRoster();
        return;
      }

      case "team": {
        if (this.state.phase !== "lobby") return;
        if (msg.team !== TEAM_T && msg.team !== TEAM_CT) return;
        seat.meta.team = msg.team;
        const p = findPlayer(this.state, seat.playerId);
        if (p) p.team = msg.team;
        this.broadcastRoster();
        return;
      }

      case "rounds": {
        if (seat.playerId !== this.hostId || this.state.phase !== "lobby") return;
        if (!(WIN_ROUNDS_OPTIONS as readonly number[]).includes(msg.win)) return;
        this.winRounds = msg.win;
        this.broadcastRoster();
        return;
      }

      case "start": {
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (!this.canStart()) return;
        this.state.phase = "countdown";
        this.state.phaseTicksLeft = COUNTDOWN_TICKS;
        return;
      }

      case "kick": {
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (typeof msg.id !== "number" || msg.id === this.hostId) return;
        const target = this.seats.get(msg.id);
        if (!target) return;
        // A un bot no hace falta bloquearlo: no vuelve solo.
        if (!target.bot) this.kicked.add(target.meta.name.trim().toLowerCase());
        for (const c of this.getConnections<ConnState>()) {
          if (c.state?.playerId !== msg.id) continue;
          this.sendTo(c, { t: "err", code: "kicked", message: "El host te sacó de la sala." });
          c.close(4000, "kicked");
        }
        this.removeSeat(msg.id);
        return;
      }

      case "bot": {
        // Sólo el host, sólo en el lobby y si hay lugar.
        if (seat.playerId !== this.hostId) return;
        if (this.state.phase !== "lobby") return;
        if (this.seats.size >= MAX_PLAYERS) return;
        this.addBot();
        return;
      }

      case "botSkill": {
        if (seat.playerId !== this.hostId) return;
        if (typeof msg.skill !== "number" || !Number.isInteger(msg.skill) || msg.skill < 0 || msg.skill >= BOT_SKILLS.length) return;
        this.botSkill = msg.skill;
        for (const s of this.seats.values()) if (s.bot) s.bot.skill = msg.skill;
        this.broadcastRoster();
        return;
      }

      case "ping": {
        this.sendTo(conn, { t: "pong", c: msg.c, s: Date.now() });
        return;
      }

      case "chat": {
        const now = Date.now();
        if (now - seat.lastChatAt < CHAT_INTERVAL_MS) return;
        const text = sanitizeChat(msg.text);
        if (!text) return;
        seat.lastChatAt = now;
        const out = encodeServer({ t: "chat", by: seat.playerId, text });
        // En partida, sólo al equipo: un chat de todos regalaría información.
        if (this.state.phase !== "playing") {
          this.broadcast(out);
          return;
        }
        const me = findPlayer(this.state, seat.playerId);
        for (const c of this.getConnections<ConnState>()) {
          const other = c.state ? findPlayer(this.state, c.state.playerId) : undefined;
          if (other && me && other.team === me.team) c.send(out);
        }
        return;
      }
    }
  }

  /** Para arrancar hace falta gente en los dos equipos. */
  private canStart(): boolean {
    let t = 0;
    let ct = 0;
    for (const seat of this.seats.values()) {
      if (seat.meta.team === TEAM_T) t++;
      else ct++;
    }
    return t > 0 && ct > 0 && this.seats.size >= MIN_PLAYERS;
  }

  // ------------------------------------------------------------ loop

  private ensureLoop(): void {
    if (this.loop) return;
    this.emptyTicks = 0;
    this.lastPumpAt = Date.now();
    this.accumulator = 0;
    this.loop = setInterval(() => {
      try {
        this.pump();
      } catch (err) {
        console.error("tick error", err);
      }
    }, PUMP_INTERVAL_MS);
  }

  private stopLoop(): void {
    if (!this.loop) return;
    clearInterval(this.loop);
    this.loop = null;
  }

  /**
   * Corre los ticks que hagan falta para alcanzar el reloj y manda UN snapshot.
   * Simular contra el reloj (y no contra el timer) es lo que mantiene la partida
   * a 20 Hz reales.
   */
  private pump(): void {
    const now = Date.now();
    let delta = now - this.lastPumpAt;
    this.lastPumpAt = now;
    this.expireAbsent(now);

    if (delta > MAX_CATCHUP_MS) delta = MAX_CATCHUP_MS;
    this.accumulator += delta;
    if (this.accumulator < MS_PER_TICK) return;

    let ran = 0;
    while (this.accumulator >= MS_PER_TICK && ran < MAX_TICKS_PER_PUMP) {
      this.accumulator -= MS_PER_TICK;
      ran++;
      if (!this.tick()) return;
    }
    if (this.accumulator > MS_PER_TICK) this.accumulator = 0;

    this.broadcastSnapshot();
  }

  /** Un tick de simulación. Devuelve false si la sala se apagó. */
  private tick(): boolean {
    const s = this.state;

    if (!this.hasHumans()) {
      // Sala vacía, o con bots solos, que no miran nadie: apagar el loop.
      if (++this.emptyTicks > EMPTY_ROOM_SHUTDOWN_TICKS) {
        for (const seat of [...this.seats.values()]) if (seat.bot) this.removeSeat(seat.playerId);
        this.stopLoop();
        this.resetToLobby();
        return false;
      }
      return true;
    }
    this.emptyTicks = 0;

    // Arranque automático cuando todos marcaron "listo" (y, recién terminada
    // una partida, pasada la pausa para ver el resultado).
    if (s.phase === "lobby" && this.canStart() && Date.now() >= this.nextMatchAt) {
      let allReady = true;
      for (const seat of this.seats.values()) if (!seat.meta.ready) allReady = false;
      if (allReady) {
        s.phase = "countdown";
        s.phaseTicksLeft = COUNTDOWN_TICKS;
      }
    }

    const inputs = new Map<number, PlayerInput[]>();
    for (const seat of this.seats.values()) {
      if (seat.bot) {
        // Los bots deciden con el estado de este mismo tick, como si su input
        // acabara de llegar.
        const me = findPlayer(s, seat.playerId);
        inputs.set(seat.playerId, me?.alive && s.phase === "playing" ? [botInput(s, me, seat.bot, this.map)] : []);
        continue;
      }
      if (seat.goneAt > 0) continue;
      inputs.set(seat.playerId, seat.inputs.take());
    }

    const wasPlaying = s.phase === "playing";
    const before = this.events.length;
    step(s, inputs, this.events, this.map);
    this.alertBots(this.events.slice(before));
    if (wasPlaying && s.phase === "ended") this.addToTally();

    if (s.phase === "countdown" && s.phaseTicksLeft <= 0) {
      // Los equipos del lobby son los del partido. Los bots arrancan de cero.
      for (const seat of this.seats.values()) {
        const p = findPlayer(s, seat.playerId);
        if (p) p.team = seat.meta.team;
        if (seat.bot) seat.bot = createBotMemory((Date.now() ^ (seat.playerId * 7919)) | 0, seat.bot.skill);
      }
      startMatch(s, (Date.now() ^ (this.seats.size << 16)) | 1, this.map, this.winRounds, this.events);
      this.broadcast(encodeServer({ t: "start", seed: s.seed, map: this.mapIndex }));
    } else if (s.phase === "ended" && s.phaseTicksLeft <= 0) {
      this.resetToLobby();
    }

    return true;
  }

  /**
   * Lo que un bot oye: si le pegaron, sabe de dónde vino; un tiro cerca le
   * dice por dónde anda el otro. Es lo mismo que oye un jugador.
   */
  private alertBots(events: readonly SimEvent[]): void {
    const s = this.state;
    for (const e of events) {
      if (e.t === "hit") {
        const seat = this.seats.get(e.targetId);
        const by = findPlayer(s, e.byId);
        if (seat?.bot && by) botAlert(seat.bot, by.x, by.y, by.z, s.tick);
      } else if (e.t === "shot") {
        const shooter = findPlayer(s, e.byId);
        if (!shooter) continue;
        for (const seat of this.seats.values()) {
          if (!seat.bot) continue;
          const me = findPlayer(s, seat.playerId);
          if (!me?.alive || me.team === shooter.team) continue;
          if (Math.hypot(e.x - me.x, e.z - me.z) <= 22) botAlert(seat.bot, shooter.x, shooter.y, shooter.z, s.tick);
        }
      }
    }
  }

  // ------------------------------------------------------------ visibilidad

  /**
   * Con los ojos de quién mira cada uno. Muerto con un compañero vivo se ve lo
   * que ve él: si no, le podría contar dónde están los rivales que no ve.
   */
  private eyesOf(viewer: PlayerState | undefined): PlayerState | undefined {
    if (!viewer || viewer.alive) return viewer;
    const mate = this.state.players.find((p) => p.alive && p.connected && p.team === viewer.team && p.id !== viewer.id);
    return mate ?? viewer;
  }

  private seesAll(viewer: PlayerState | undefined): boolean {
    return !viewer || !viewer.alive || this.state.round.phase === "over";
  }

  private canSee(viewer: PlayerState | undefined, target: PlayerState): boolean {
    if (this.seesAll(viewer) || !viewer) return true;
    if (viewer.id === target.id || viewer.team === target.team) return true;
    if (!target.alive) return true;

    let seen = this.lastSeen.get(viewer.id);
    if (!seen) {
      seen = new Map();
      this.lastSeen.set(viewer.id, seen);
    }

    // De los ojos del que mira a la cabeza, al pecho y a los pies del otro.
    const ex = viewer.x;
    const ey = viewer.y + eyeHeightOf(viewer);
    const ez = viewer.z;
    const h = heightOf(target);
    const boxes = this.map.boxes;
    const visible =
      segmentClear(ex, ey, ez, target.x, target.y + h - 0.15, target.z, boxes) ||
      segmentClear(ex, ey, ez, target.x, target.y + h * 0.5, target.z, boxes) ||
      segmentClear(ex, ey, ez, target.x, target.y + 0.2, target.z, boxes) ||
      segmentClear(ex, ey, ez, target.x + 0.3, target.y + h * 0.7, target.z, boxes) ||
      segmentClear(ex, ey, ez, target.x - 0.3, target.y + h * 0.7, target.z, boxes) ||
      segmentClear(ex, ey, ez, target.x, target.y + h * 0.7, target.z + 0.3, boxes) ||
      segmentClear(ex, ey, ez, target.x, target.y + h * 0.7, target.z - 0.3, boxes);
    if (visible) {
      seen.set(target.id, this.state.tick);
      return true;
    }
    const last = seen.get(target.id);
    return last !== undefined && this.state.tick - last <= SIGHT_GRACE_TICKS;
  }

  /**
   * Un snapshot por jugador, con lo que cada uno puede ver. Es lo que hace que
   * un wallhack deje de existir: la información no sale del servidor.
   */
  private broadcastSnapshot(): void {
    const s = this.state;
    const base = {
      t: "s" as const,
      tick: s.tick,
      now: Date.now(),
      phase: s.phase,
      left: s.phaseTicksLeft,
      rd: packRound(s),
      drops: s.drops.map(packDrop),
      st: packStandings(s),
      winner: s.winnerTeam,
    };

    if (s.phase !== "playing") {
      this.broadcast(
        encodeServer({
          ...base,
          players: s.players.map((p) => packPlayer(p, false)),
          ...(this.events.length > 0 ? { ev: this.events } : {}),
        }),
      );
      this.events = [];
      return;
    }

    const stepsNow = s.tick - this.lastStepsTick >= 8 || s.tick < this.lastStepsTick;
    if (stepsNow) this.lastStepsTick = s.tick;

    for (const conn of this.getConnections<ConnState>()) {
      const viewerId = conn.state?.playerId;
      const self = viewerId === undefined ? undefined : findPlayer(s, viewerId);
      const viewer = this.eyesOf(self);

      const players: SnapPlayer[] = [];
      for (const p of s.players) {
        if (!p.connected) continue;
        if (this.canSee(viewer, p)) players.push(packPlayer(p, p.id === viewerId));
      }

      const ev = this.visibleEvents(viewer, viewerId ?? -1);
      if (stepsNow) ev.push(...this.footsteps(viewer, new Set(players.map((p) => p[0]!))));

      conn.send(encodeServer({ ...base, players, ...(ev.length > 0 ? { ev } : {}) }));
    }

    this.events = [];
  }

  /**
   * Los eventos con posición (tiros, impactos) delatan dónde hay alguien, así
   * que se filtran: el tiro que no se ve igual se oye, sin dónde terminó.
   */
  private visibleEvents(viewer: PlayerState | undefined, viewerId: number): SimEvent[] {
    if (this.seesAll(viewer) || !viewer) return this.events.slice();
    const out: SimEvent[] = [];
    const boxes = this.map.boxes;
    const ex = viewer.x;
    const ey = viewer.y + eyeHeightOf(viewer);
    const ez = viewer.z;
    for (const e of this.events) {
      switch (e.t) {
        case "shot": {
          // El propio, siempre (es lo que empareja la predicción). El de un
          // compañero también. El de un rival, si se lo ve o si pegó cerca.
          const shooter = findPlayer(this.state, e.byId);
          if (e.byId === viewerId || (shooter && shooter.team === viewer.team) || this.canSee(viewer, shooter!)) {
            out.push(e);
            break;
          }
          const dist = Math.hypot(e.x - ex, e.y - ey, e.z - ez);
          if (dist <= HEARING_RANGE) {
            // Se oye: de dónde, aproximado, y sin dónde terminó.
            out.push({ ...e, x: roughly(e.x, ex), y: e.y, z: roughly(e.z, ez), hits: [] });
          }
          break;
        }
        case "hit": {
          const target = findPlayer(this.state, e.targetId);
          if (e.byId === viewerId || e.targetId === viewerId || (target && this.canSee(viewer, target)) || segmentClear(ex, ey, ez, e.x, e.y, e.z, boxes)) out.push(e);
          break;
        }
        case "reload": {
          const who = findPlayer(this.state, e.byId);
          if (who && (who.team === viewer.team || Math.hypot(e.x - ex, e.z - ez) <= STEPS_RANGE)) out.push(e);
          break;
        }
        default:
          out.push(e);
      }
    }
    return out;
  }

  /** Los pasos de los rivales que corren cerca y no se ven (cada 8 ticks). */
  private footsteps(viewer: PlayerState | undefined, sent: ReadonlySet<number>): SimEvent[] {
    if (!viewer?.alive) return [];
    const out: SimEvent[] = [];
    for (const p of this.state.players) {
      if (!p.alive || !p.connected || p.team === viewer.team || sent.has(p.id)) continue;
      const speed = Math.hypot(p.vx, p.vz);
      // Caminando (Shift) o agachado no hace ruido.
      if (speed < 3.2) continue;
      if (Math.hypot(p.x - viewer.x, p.z - viewer.z) > STEPS_RANGE) continue;
      out.push({ t: "steps", byId: p.id, x: roughly(p.x, viewer.x), y: p.y, z: roughly(p.z, viewer.z) });
    }
    return out;
  }

  // ------------------------------------------------------------ sala

  private addToTally(): void {
    const s = this.state;
    for (const seat of this.seats.values()) {
      const p = findPlayer(s, seat.playerId);
      if (!p) continue;
      const m = seat.meta;
      m.played = (m.played ?? 0) + 1;
      m.totalKills = (m.totalKills ?? 0) + p.kills;
      if (s.winnerTeam >= 0 && p.team === s.winnerTeam) m.wins = (m.wins ?? 0) + 1;
    }
    this.broadcastRoster();
  }

  private resetToLobby(): void {
    const s = this.state;
    s.players = s.players.filter((p) => this.seats.has(p.id));
    this.lastSeen.clear();
    s.phase = "lobby";
    s.phaseTicksLeft = 0;
    s.drops = [];
    s.winnerTeam = -1;
    s.tick = 0;
    s.round.number = 0;
    s.round.score = [0, 0];
    for (const p of s.players) {
      p.alive = false;
      p.diedAtTick = -1;
      p.killerId = -1;
    }
    // Los equipos quedan como terminaron (cambiados a la mitad): el lobby los muestra.
    const played = s.players.some((p) => p.kills > 0 || p.deaths > 0);
    for (const seat of this.seats.values()) {
      const p = findPlayer(s, seat.playerId);
      if (p) seat.meta.team = p.team;
      // Los bots, siempre listos.
      seat.meta.ready = seat.bot !== null || (played && seat.goneAt === 0);
      seat.inputs.clear();
    }
    this.nextMatchAt = played ? Date.now() + NEXT_MATCH_MS : 0;
    this.broadcastRoster();
  }

  private removeSeat(playerId: number): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    this.seats.delete(playerId);
    if (seat.token !== null) this.byToken.delete(seat.token);

    const player = findPlayer(this.state, playerId);
    if (player) {
      player.connected = false;
      player.alive = false;
    }
    if (this.state.phase !== "playing") {
      this.state.players = this.state.players.filter((p) => p.id !== playerId);
    }

    if (this.hostId === playerId) {
      // El puesto pasa a otra persona, nunca a un bot.
      const next = [...this.seats.values()].find((s) => !s.bot);
      this.hostId = next ? next.playerId : -1;
    }
    this.broadcastRoster();
  }

  private hasHumans(): boolean {
    for (const seat of this.seats.values()) if (!seat.bot) return true;
    return false;
  }

  /** Un bot más en la sala, en el equipo con menos gente, ya listo. */
  private addBot(): void {
    // La grilla de caminos se arma una vez por mapa: mejor ahora, en el lobby.
    navGridFor(this.map);
    const used = new Set([...this.seats.values()].map((s) => s.meta.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextPlayerId}`;
    const playerId = this.nextPlayerId++;
    const team = smallerTeam(this.state.players);
    this.seats.set(playerId, {
      playerId,
      connId: null,
      token: null,
      goneAt: 0,
      meta: { id: playerId, name, team, ready: true, bot: true },
      inputs: new InputQueue(),
      lastChatAt: 0,
      bot: createBotMemory((Date.now() ^ (playerId * 7919)) | 0, this.botSkill),
    });
    this.state.players.push(createPlayer(playerId, team));
    this.broadcastRoster();
    this.ensureLoop();
  }

  private roster(): PlayerMeta[] {
    return [...this.seats.values()].map((s) => ({ ...s.meta }));
  }

  private broadcastRoster(): void {
    this.broadcast(
      encodeServer({
        t: "roster",
        roster: this.roster(),
        hostId: this.hostId,
        winRounds: this.winRounds,
        map: this.mapIndex,
        botSkill: this.botSkill,
        ...(this.nextMatchAt > Date.now() ? { nextIn: this.nextMatchAt - Date.now() } : {}),
      }),
    );
  }

  private sendTo(conn: Connection<ConnState>, msg: ServerMsg): void {
    conn.send(encodeServer(msg));
  }
}

function clampAxis(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function clampInt(v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** Un punto aproximado: a 4 m de resolución relativo al que escucha. */
function roughly(v: number, from: number): number {
  return Math.round(from + Math.round((v - from) / 4) * 4);
}
