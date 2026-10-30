import {
  BUY_ITEMS,
  MAPS,
  TEAM_CT,
  TEAM_NAMES,
  TEAM_T,
  WIN_ROUNDS_OPTIONS,
  weapon,
  type BuyItem,
  type PlayerMeta,
  type SnapStanding,
} from "@wabcs/shared";

export type Screen = "menu" | "lobby" | "result" | "connecting";

export interface UICallbacks {
  onCreate: (name: string) => void;
  onPractice: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onKick: (id: number) => void;
  onAddBot: () => void;
  onBotSkill: (skill: number) => void;
  onTeam: (team: number) => void;
  onRounds: (win: number) => void;
  onMode: (mode: number) => void;
  onMap: (map: number) => void;
  onChat: (text: string) => void;
  onLeave: () => void;
  onBuy: (index: number) => void;
  onVolume: (volume: number) => void;
  onSensitivity: (value: number) => void;
  onFullscreen: (on: boolean) => void;
  onResume: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en index.html`);
  return el as T;
};

const NAME_KEY = "wabcs:name";
const VOLUME_KEY = "wabcs:volume";
const FULLSCREEN_KEY = "wabcs:fullscreen";
const SENS_KEY = "wabcs:sens";

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento: no se recuerda, nada más.
  }
}

/** Todo lo que es HTML: menú, sala, HUD, compra, tabla, resultado. */
export class UI {
  private readonly overlay = $("overlay");
  private readonly screens: Record<Screen, HTMLElement> = {
    menu: $("screenMenu"),
    lobby: $("screenLobby"),
    result: $("screenResult"),
    connecting: $("screenConnecting"),
  };
  private readonly nameInput = $<HTMLInputElement>("nameInput");
  private readonly codeInput = $<HTMLInputElement>("codeInput");
  private readonly menuError = $("menuError");
  private readonly inviteHint = $("inviteHint");
  private readonly roomCode = $<HTMLButtonElement>("roomCode");
  private readonly listT = $("listT");
  private readonly listCT = $("listCT");
  private readonly btnReady = $<HTMLButtonElement>("btnReady");
  private readonly btnStart = $<HTMLButtonElement>("btnStart");
  private readonly lobbyHint = $("lobbyHint");
  private readonly nextMatch = $("nextMatch");
  private readonly chatLog = $("chatLog");
  private readonly hud = $("hud");
  private readonly buyMenu = $("buyMenu");
  private readonly buyList = $("buyList");
  private readonly scoreboard = $("scoreboard");
  private readonly killfeed = $("killfeed");
  private readonly banner = $("banner");
  private readonly subBanner = $("subBanner");
  private readonly teamChatLog = $("teamChatLog");
  private readonly teamChatInput = $<HTMLInputElement>("teamChatInput");
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private ready = false;
  private roster: PlayerMeta[] = [];
  private myId = -1;
  private myTeam = TEAM_T;
  private buyOpen = false;
  private lastRoundText = "";

  constructor(private readonly cb: UICallbacks) {
    const savedName = load(NAME_KEY);
    if (savedName) this.nameInput.value = savedName;

    // Volumen y sensibilidad están en el menú y en la pausa: los dos deslizadores van a la par.
    const volumeInputs = [$<HTMLInputElement>("volumeInput"), $<HTMLInputElement>("pauseVolumeInput")];
    const volumeValues = [$("volumeValue"), $("pauseVolumeValue")];
    const applyVolume = (v: string) => {
      for (const i of volumeInputs) i.value = v;
      for (const el of volumeValues) el.textContent = `${v}%`;
      save(VOLUME_KEY, v);
      cb.onVolume(Number(v) / 100);
    };
    for (const i of volumeInputs) i.addEventListener("input", () => applyVolume(i.value));
    applyVolume(load(VOLUME_KEY) ?? volumeInputs[0]!.value);

    const sensInputs = [$<HTMLInputElement>("sensInput"), $<HTMLInputElement>("pauseSensInput")];
    const sensValues = [$("sensValue"), $("pauseSensValue")];
    const applySens = (v: string) => {
      for (const i of sensInputs) i.value = v;
      for (const el of sensValues) el.textContent = `${(Number(v) / 10).toFixed(1)}`;
      save(SENS_KEY, v);
      cb.onSensitivity(Number(v) / 10);
    };
    for (const i of sensInputs) i.addEventListener("input", () => applySens(i.value));
    applySens(load(SENS_KEY) ?? sensInputs[0]!.value);

    // Pantalla completa al jugar (así Esc no suelta el mouse). Encendido salvo que se apague.
    const fsInputs = [$<HTMLInputElement>("fullscreenInput"), $<HTMLInputElement>("pauseFullscreen")];
    const applyFullscreen = (on: boolean) => {
      for (const i of fsInputs) i.checked = on;
      save(FULLSCREEN_KEY, on ? "1" : "0");
      cb.onFullscreen(on);
    };
    for (const i of fsInputs) i.addEventListener("change", () => applyFullscreen(i.checked));
    applyFullscreen(load(FULLSCREEN_KEY) !== "0");

    $("btnResume").addEventListener("click", () => cb.onResume());
    $("btnPauseLeave").addEventListener("click", () => cb.onLeave());

    $("btnCreate").addEventListener("click", () => cb.onCreate(this.name()));
    $("btnPractice").addEventListener("click", () => cb.onPractice(this.name()));
    $("btnJoin").addEventListener("click", () => cb.onJoin(this.name(), this.codeInput.value));
    this.codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") cb.onJoin(this.name(), this.codeInput.value);
    });
    this.nameInput.addEventListener("change", () => save(NAME_KEY, this.name()));

    this.btnReady.addEventListener("click", () => {
      this.ready = !this.ready;
      this.btnReady.textContent = this.ready ? "No estoy listo" : "Estoy listo";
      this.btnReady.classList.toggle("btn-primary", !this.ready);
      cb.onReady(this.ready);
    });
    this.btnStart.addEventListener("click", () => cb.onStart());
    $("btnLeave").addEventListener("click", () => cb.onLeave());
    $("btnJoinT").addEventListener("click", () => cb.onTeam(TEAM_T));
    $("btnJoinCT").addEventListener("click", () => cb.onTeam(TEAM_CT));

    for (const btn of $("roundsRow").querySelectorAll<HTMLButtonElement>("[data-rounds]")) {
      btn.addEventListener("click", () => cb.onRounds(Number(btn.dataset.rounds)));
    }
    for (const btn of $("modeRow").querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      btn.addEventListener("click", () => cb.onMode(Number(btn.dataset.mode)));
    }
    // Un botón por mapa, con su nombre.
    const mapRow = $("mapRow");
    MAPS.forEach((m, i) => {
      const btn = document.createElement("button");
      btn.className = "mode-btn";
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.dataset.map = String(i);
      btn.textContent = m.name;
      btn.addEventListener("click", () => cb.onMap(i));
      mapRow.append(btn);
    });
    $("btnAddBot").addEventListener("click", () => cb.onAddBot());
    for (const btn of $("botSkillRow").querySelectorAll<HTMLButtonElement>("[data-skill]")) {
      btn.addEventListener("click", () => cb.onBotSkill(Number(btn.dataset.skill)));
    }

    this.roomCode.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.set("room", this.roomCode.textContent ?? "");
      void navigator.clipboard?.writeText(url.toString()).then(() => {
        this.lobbyHint.textContent = "Link copiado. Pegáselo a tus amigos.";
      });
    });

    const chatForm = $<HTMLFormElement>("chatForm");
    const chatInput = $<HTMLInputElement>("chatInput");
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      cb.onChat(text);
      chatInput.value = "";
    });

    this.teamChatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const text = this.teamChatInput.value.trim();
        if (text) cb.onChat(text);
        this.closeTeamChat();
      } else if (e.key === "Escape") {
        this.closeTeamChat();
      }
      e.stopPropagation();
    });

    const room = new URLSearchParams(location.search).get("room");
    if (room) {
      this.codeInput.value = room.toUpperCase();
      this.inviteHint.textContent = `Te invitaron a la sala ${room.toUpperCase()}. Poné tu nombre y entrá.`;
      this.inviteHint.hidden = false;
      $("btnJoin").classList.add("btn-primary");
      $("btnCreate").classList.remove("btn-primary");
    }
  }

  private name(): string {
    const n = this.nameInput.value.trim().slice(0, 14);
    return n || "Jugador";
  }

  // ------------------------------------------------------------ pantallas

  showScreen(screen: Screen): void {
    this.overlay.hidden = false;
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== screen;
    if (screen !== "lobby") {
      this.ready = false;
      this.btnReady.textContent = "Estoy listo";
      this.btnReady.classList.add("btn-primary");
    }
  }

  hideScreens(): void {
    this.overlay.hidden = true;
    // El botón que se apretó para arrancar no se queda con el foco: Espacio lo volvería a apretar.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
  }

  showError(message: string): void {
    this.menuError.textContent = message;
    this.menuError.hidden = false;
    this.showScreen("menu");
  }

  setEntryEnabled(enabled: boolean): void {
    for (const b of $("menuActions").querySelectorAll<HTMLButtonElement>("button")) b.disabled = !enabled;
  }

  setHud(visible: boolean): void {
    this.hud.hidden = !visible;
    if (!visible) {
      this.closeBuy();
      this.scoreboard.hidden = true;
      this.killfeed.replaceChildren();
    }
  }

  // ------------------------------------------------------------ sala

  setRoom(code: string): void {
    this.roomCode.textContent = code;
  }

  updateLobby(roster: PlayerMeta[], hostId: number, myId: number, winRounds: number, botSkill = 1, mode = 0, map = 0, nextIn?: number): void {
    this.roster = roster;
    this.myId = myId;
    const me = roster.find((p) => p.id === myId);
    if (me) {
      this.myTeam = me.team;
      this.ready = me.ready;
      this.btnReady.textContent = this.ready ? "No estoy listo" : "Estoy listo";
      this.btnReady.classList.toggle("btn-primary", !this.ready);
    }
    const isHost = hostId === myId;

    const render = (list: HTMLElement, team: number) => {
      list.replaceChildren();
      for (const p of roster.filter((p) => p.team === team)) {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = `${p.id === hostId ? "★ " : ""}${p.name}${p.id === myId ? " (vos)" : ""}`;
        li.append(name);
        if (p.bot) {
          const chip = document.createElement("span");
          chip.className = "tally";
          chip.textContent = "BOT";
          li.append(chip);
        }
        if (p.played) {
          const tally = document.createElement("span");
          tally.className = "tally";
          tally.textContent = `${p.wins ?? 0}/${p.played} · ${p.totalKills ?? 0} k`;
          li.append(tally);
        }
        if (p.away) {
          const away = document.createElement("span");
          away.className = "away";
          away.textContent = "sin conexión";
          li.append(away);
        } else if (p.ready) {
          const ready = document.createElement("span");
          ready.className = "ready";
          ready.textContent = "listo";
          li.append(ready);
        }
        if (isHost && p.id !== myId) {
          const kick = document.createElement("button");
          kick.className = "kick";
          kick.title = "Echar de la sala";
          kick.textContent = "✕";
          kick.addEventListener("click", () => this.cb.onKick(p.id));
          li.append(kick);
        }
        list.append(li);
      }
    };
    render(this.listT, TEAM_T);
    render(this.listCT, TEAM_CT);
    $<HTMLButtonElement>("btnJoinT").disabled = this.myTeam === TEAM_T;
    $<HTMLButtonElement>("btnJoinCT").disabled = this.myTeam === TEAM_CT;

    for (const btn of $("roundsRow").querySelectorAll<HTMLButtonElement>("[data-rounds]")) {
      btn.setAttribute("aria-checked", String(Number(btn.dataset.rounds) === winRounds));
      btn.disabled = !isHost;
    }
    for (const btn of $("modeRow").querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      btn.setAttribute("aria-checked", String(Number(btn.dataset.mode) === mode));
      btn.disabled = !isHost;
    }
    for (const btn of $("mapRow").querySelectorAll<HTMLButtonElement>("[data-map]")) {
      btn.setAttribute("aria-checked", String(Number(btn.dataset.map) === map));
      btn.disabled = !isHost;
    }

    const t = roster.filter((p) => p.team === TEAM_T).length;
    const ct = roster.filter((p) => p.team === TEAM_CT).length;
    const canStart = t > 0 && ct > 0;
    this.btnStart.hidden = !isHost;
    this.btnStart.disabled = !canStart;
    $("btnAddBot").hidden = !isHost;
    const hasBots = roster.some((p) => p.bot);
    const skillRow = $("botSkillRow");
    skillRow.hidden = !hasBots;
    for (const btn of skillRow.querySelectorAll<HTMLButtonElement>("[data-skill]")) {
      btn.setAttribute("aria-checked", String(Number(btn.dataset.skill) === botSkill));
      btn.disabled = !isHost;
    }
    this.lobbyHint.textContent = !canStart
      ? "Hace falta al menos uno en cada equipo."
      : isHost
        ? "Arranca cuando todos estén listos, o apretá Empezar ya."
        : "Arranca cuando todos estén listos.";
    if (nextIn !== undefined && nextIn > 0) {
      this.nextMatch.hidden = false;
      this.nextMatch.textContent = `Siguiente partido en ${Math.ceil(nextIn / 1000)} s`;
    } else {
      this.nextMatch.hidden = true;
    }
    void WIN_ROUNDS_OPTIONS;
  }

  addChat(name: string, text: string, inMatch: boolean): void {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = name;
    li.append(who, document.createTextNode(text));
    const log = inMatch ? this.teamChatLog : this.chatLog;
    log.append(li);
    while (log.children.length > 6) log.firstElementChild?.remove();
    if (inMatch) setTimeout(() => li.remove(), 9000);
  }

  nameOf(id: number): string {
    return this.roster.find((p) => p.id === id)?.name ?? "alguien";
  }

  teamOf(id: number): number {
    return this.roster.find((p) => p.id === id)?.team ?? TEAM_T;
  }

  // ------------------------------------------------------------ HUD

  setVitals(hp: number, armor: number, helmet: boolean): void {
    const hpEl = $("hp");
    hpEl.textContent = String(Math.max(0, Math.ceil(hp)));
    hpEl.classList.toggle("low", hp <= 30);
    $("armor").textContent = String(armor);
    $("armorIcon").textContent = helmet ? "⛑" : "◈";
    // Con `hidden` y no con la opacidad: la animación del latido pisa la opacidad.
    $("lowHp").hidden = !(hp > 0 && hp <= 30);
  }

  setMoney(money: number): void {
    $("money").textContent = String(money);
    $("buyMoney").textContent = `$${money}`;
  }

  setAmmo(weaponId: number, mag: number, reserve: number, slots: readonly number[], active: number): void {
    const w = weapon(weaponId);
    $("weaponName").textContent = w.name;
    const magEl = $("ammoMag");
    if (w.slot === 3) {
      // Una granada en la mano: cuántas quedan de ese tipo.
      magEl.textContent = String(mag);
      magEl.classList.remove("low");
      $("ammoReserve").textContent = "";
    } else if (w.mag === 0) {
      magEl.textContent = "—";
      magEl.classList.remove("low");
      $("ammoReserve").textContent = "";
    } else {
      magEl.textContent = String(mag);
      magEl.classList.toggle("low", mag <= Math.ceil(w.mag * 0.25));
      $("ammoReserve").textContent = String(reserve);
    }
    const slotsEl = $("slots");
    slotsEl.replaceChildren();
    const labels = ["1", "2", "3"];
    slots.slice(0, 3).forEach((id, i) => {
      const s = document.createElement("span");
      s.className = `slot${i === active ? " active" : ""}${id < 0 ? " empty" : ""}`;
      s.textContent = `${labels[i]} ${id >= 0 ? weapon(id).short : "—"}`;
      slotsEl.append(s);
    });
  }

  private lastNades = "";

  /** Las granadas que lleva: 4 HE, 5 flash, 6 humo, con la cantidad; la que tiene en la mano, marcada. */
  setGrenades(counts: readonly number[], heldKind: number): void {
    const key = `${counts.join(",")}|${heldKind}`;
    if (key === this.lastNades) return;
    this.lastNades = key;
    const el = $("nades");
    el.replaceChildren();
    const names = ["HE", "Flash", "Humo"];
    counts.forEach((n, i) => {
      if (n <= 0) return;
      const s = document.createElement("span");
      s.className = `slot${heldKind === i ? " active" : ""}`;
      s.textContent = `${4 + i} ${names[i]}${n > 1 ? ` ×${n}` : ""}`;
      el.append(s);
    });
  }

  /** Cuánto queda de ceguera (0 a 1): el blanco de la pantalla. */
  setBlind(amount: number): void {
    $("flashOverlay").style.opacity = String(Math.max(0, Math.min(1, amount)));
  }

  private lastBombInfo = "";

  /** El cartel de la bomba: null para ocultarlo. `cls` "carry" (la llevás) o "planted". */
  setBombInfo(text: string | null, cls = ""): void {
    const el = $("bombInfo");
    const key = text === null ? "" : `${cls}|${text}`;
    if (key === this.lastBombInfo) return;
    this.lastBombInfo = key;
    el.hidden = text === null;
    if (text !== null) {
      el.textContent = text;
      el.className = `bomb-info ${cls}`;
    }
  }

  /** La barra de plantar o desactivar: progreso 0 a 1, o null. */
  setUseBar(progress: number | null, label = ""): void {
    const el = $("useBar");
    el.hidden = progress === null;
    if (progress !== null) {
      $("useFill").style.width = `${Math.round(progress * 100)}%`;
      $("useText").textContent = label;
    }
  }

  private lastSite = "";

  setSiteLabel(text: string | null): void {
    const key = text ?? "";
    if (key === this.lastSite) return;
    this.lastSite = key;
    const el = $("siteLabel");
    el.hidden = text === null;
    if (text !== null) el.textContent = text;
  }

  /** La hora de la ronda, o la mecha de la bomba en rojo. */
  setBombClock(ticksLeft: number | null): void {
    const timeEl = $("roundTime");
    if (ticksLeft === null) {
      timeEl.classList.remove("bomb");
      return;
    }
    const seconds = Math.max(0, Math.ceil(ticksLeft / 20));
    const text = `💣 ${seconds}`;
    if (timeEl.textContent !== text) timeEl.textContent = text;
    timeEl.classList.add("bomb", "urgent");
  }

  private lastGap = -1;

  /** `spread` en radianes: la mira se abre proporcionalmente. */
  setCrosshair(visible: boolean, spread: number): void {
    const ch = $("crosshair");
    ch.hidden = !visible;
    const gap = Math.round(Math.min(60, 3 + spread * 700));
    if (gap !== this.lastGap) {
      this.lastGap = gap;
      ch.style.setProperty("--gap", `${gap}px`);
    }
  }

  setScope(on: boolean): void {
    $("scope").hidden = !on;
  }

  setRound(number: number, phase: "freeze" | "live" | "over", ticksLeft: number, score: [number, number], winRounds: number, aliveT: number, aliveCT: number): void {
    $("scoreT").textContent = String(score[0]);
    $("scoreCT").textContent = String(score[1]);
    const seconds = Math.max(0, Math.ceil(ticksLeft / 20));
    const time = phase === "over" ? "0:00" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const timeEl = $("roundTime");
    // Con la bomba plantada el reloj lo escribe setBombClock.
    if (!timeEl.classList.contains("bomb")) {
      if (timeEl.textContent !== time) timeEl.textContent = time;
      timeEl.classList.toggle("urgent", phase === "live" && seconds <= 10);
    }
    const rt = `Ronda ${number} · a ${winRounds}`;
    if (this.lastRoundText !== rt) {
      this.lastRoundText = rt;
      $("roundNumber").textContent = rt;
    }
    $("aliveT").textContent = "●".repeat(aliveT);
    $("aliveCT").textContent = "●".repeat(aliveCT);
  }

  setFreezeInfo(text: string | null): void {
    const el = $("freezeInfo");
    el.hidden = text === null;
    if (text !== null && el.textContent !== text) el.textContent = text;
  }

  setPickupPrompt(weaponId: number | null): void {
    const el = $("pickupPrompt");
    el.hidden = weaponId === null;
    if (weaponId !== null) el.innerHTML = `<b>E</b> para levantar ${weapon(weaponId).name}`;
  }

  /**
   * La pausa: aparece cuando el mouse no está capturado en medio de la partida
   * (Esc, o el navegador que lo soltó). `retry` es que el navegador rechazó
   * volver a capturar porque se acababa de soltar.
   */
  setPause(visible: boolean, retry = false): void {
    $("pausePanel").hidden = !visible;
    $("pauseHint").textContent = retry
      ? "El navegador pide esperar un segundo: volvé a hacer click en Seguir."
      : document.fullscreenElement
        ? "Esc abre y cierra esta pausa."
        : "Esc suelta el mouse fuera de pantalla completa. Hacé click en Seguir para volver.";
  }

  setSpectating(html: string | null): void {
    const el = $("spectating");
    el.hidden = html === null;
    if (html !== null) el.innerHTML = html;
  }

  setPing(ms: number): void {
    void ms;
  }

  hitmarker(head: boolean): void {
    const el = $("hitmarker");
    el.classList.remove("show");
    el.classList.toggle("head", head);
    void el.offsetWidth;
    el.classList.add("show");
  }

  private damageTimer: ReturnType<typeof setTimeout> | null = null;

  /** `angle` en radianes, relativo a donde mirás: 0 de frente, positivo a la izquierda. */
  damageFlash(angle: number): void {
    const el = $("damageVignette");
    el.style.opacity = "1";
    setTimeout(() => (el.style.opacity = "0"), 120);
    const dir = $("damageDir");
    dir.hidden = true;
    // En pantalla el arco gira en sentido horario: izquierda del jugador = ángulo negativo.
    dir.style.setProperty("--angle", `${(-angle * 180) / Math.PI}deg`);
    void dir.offsetWidth;
    dir.hidden = false;
    if (this.damageTimer) clearTimeout(this.damageTimer);
    this.damageTimer = setTimeout(() => (dir.hidden = true), 650);
  }

  showBanner(text: string, cls: "" | "t" | "ct" | "gold", ms: number, sub?: string): void {
    this.banner.textContent = text;
    this.banner.className = `banner ${cls}`;
    this.banner.hidden = false;
    this.subBanner.hidden = !sub;
    if (sub) this.subBanner.textContent = sub;
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.banner.hidden = true;
      this.subBanner.hidden = true;
    }, ms);
  }

  addKill(killerId: number, victimId: number, weaponId: number, headshot: boolean, myId: number): void {
    const line = document.createElement("div");
    line.className = `kill-line${killerId === myId || victimId === myId ? " mine" : ""}`;
    const k = document.createElement("span");
    k.className = this.teamOf(killerId) === TEAM_T ? "t" : "ct";
    k.textContent = this.nameOf(killerId);
    const w = document.createElement("span");
    w.className = "w";
    w.textContent = `[${weaponId === 12 ? "C4" : weaponId === 13 ? "caída" : weapon(weaponId).short}${headshot ? " ☠" : ""}]`;
    if (headshot) w.classList.add("hs");
    const v = document.createElement("span");
    v.className = this.teamOf(victimId) === TEAM_T ? "t" : "ct";
    v.textContent = this.nameOf(victimId);
    line.append(k, w, v);
    this.killfeed.append(line);
    while (this.killfeed.children.length > 6) this.killfeed.firstElementChild?.remove();
    setTimeout(() => line.remove(), 6000);
  }

  // ------------------------------------------------------------ compra

  get isBuyOpen(): boolean {
    return this.buyOpen;
  }

  openBuy(team: number, money: number): void {
    this.buyOpen = true;
    this.buyMenu.hidden = false;
    this.renderBuy(team, money);
  }

  closeBuy(): void {
    this.buyOpen = false;
    this.buyMenu.hidden = true;
  }

  renderBuy(team: number, money: number): void {
    if (!this.buyOpen) return;
    this.buyList.replaceChildren();
    // Las armas con 1 a 6, las granadas con 7, 8 y 9, el chaleco con 0 y el casco con C.
    const order = [...BUY_ITEMS.map((item, index) => ({ item, index }))].sort((a, b) => rank(a.item) - rank(b.item));
    let weaponKey = 1;
    order.forEach(({ item, index }) => {
      if (item.team !== -1 && item.team !== team) return;
      const li = document.createElement("li");
      const cant = money < item.price;
      li.className = cant ? "cant" : "";
      const k = document.createElement("span");
      k.className = "key";
      const key = item.weapon >= 0 ? String(weaponKey++) : item.grenade !== undefined ? String(7 + item.grenade) : item.kit ? "K" : item.armor === "kevlar" ? "0" : "C";
      k.textContent = key;
      const name = document.createElement("span");
      name.textContent = item.name;
      if (item.weapon >= 0) {
        const w = weapon(item.weapon);
        const desc = document.createElement("small");
        desc.className = "desc";
        desc.textContent = `${w.damage} daño · ${w.mag} balas · ${w.auto ? "automática" : "semi"}`;
        name.append(desc);
      } else if (item.grenade !== undefined) {
        const desc = document.createElement("small");
        desc.className = "desc";
        desc.textContent = ["Explota a los 1,6 s: hasta 98 de daño, menos con la distancia y nada detrás de una pared", "Ciega al que la mira; hasta 2", "15 s de humo que tapa la vista"][item.grenade] ?? "";
        name.append(desc);
      } else if (item.kit) {
        const desc = document.createElement("small");
        desc.className = "desc";
        desc.textContent = "Desactivar la bomba tarda 5 s en vez de 10 (modo bomba)";
        name.append(desc);
      } else {
        const desc = document.createElement("small");
        desc.className = "desc";
        desc.textContent = item.armor === "helmet" ? "Chaleco entero y casco (sólo el casco: $350 si ya tenés chaleco)" : "100 de chaleco";
        name.append(desc);
      }
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = `$${item.price}`;
      li.append(k, name, price);
      li.dataset.key = key;
      li.addEventListener("click", () => this.cb.onBuy(index));
      this.buyList.append(li);
    });
  }

  /** Una tecla con el menú abierto ("1".."9", "0", "C"): el ítem con esa tecla. */
  buyByKey(key: string): void {
    const li = this.buyList.querySelector<HTMLElement>(`li[data-key="${key}"]`);
    li?.click();
  }

  // ------------------------------------------------------------ tabla y resultado

  setScoreboard(visible: boolean): void {
    this.scoreboard.hidden = !visible;
  }

  get scoreboardHidden(): boolean {
    return this.scoreboard.hidden;
  }

  updateScoreboard(standings: SnapStanding[], myId: number, score: [number, number]): void {
    $("scoreboardTitle").textContent = `T ${score[0]} — ${score[1]} CT`;
    const fill = (tbody: HTMLElement, team: number) => {
      tbody.replaceChildren();
      const rows = standings.filter((s) => s[4] === team).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
      for (const s of rows) {
        const tr = document.createElement("tr");
        tr.className = `${s[3] ? "" : "dead"}${s[0] === myId ? " me" : ""}`;
        const cells = [this.nameOf(s[0]), String(s[1]), String(s[2]), String(s[5]), `$${s[6]}`];
        cells.forEach((c, i) => {
          const td = document.createElement("td");
          td.textContent = c;
          if (i > 0) td.className = "num";
          tr.append(td);
        });
        tbody.append(tr);
      }
      const head = document.createElement("tr");
      head.innerHTML = `<td style="color:var(--muted);font-size:12px">nombre</td><td class="num" style="font-size:12px">K</td><td class="num" style="font-size:12px">D</td><td class="num" style="font-size:12px">daño</td><td class="num" style="font-size:12px">$</td>`;
      tbody.prepend(head);
    };
    fill($("sbT"), TEAM_T);
    fill($("sbCT"), TEAM_CT);
  }

  showResult(winner: number, score: [number, number], standings: SnapStanding[], myTeam: number): void {
    const title = $("resultTitle");
    title.textContent = winner >= 0 ? `Ganan los ${TEAM_NAMES[winner as 0 | 1]}` : "Fin del partido";
    title.style.color = winner === TEAM_T ? "var(--t)" : winner === TEAM_CT ? "var(--ct)" : "";
    $("resultSubtitle").textContent = `${score[0]} — ${score[1]}${winner === myTeam ? " · ¡Ganaste!" : winner >= 0 ? " · Perdiste" : ""}`;
    const table = document.createElement("table");
    const head = document.createElement("tr");
    head.innerHTML = "<th>Jugador</th><th class='num'>K</th><th class='num'>D</th><th class='num'>Daño</th>";
    table.append(head);
    for (const s of [...standings].sort((a, b) => b[1] - a[1] || a[2] - b[2])) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="${s[4] === TEAM_T ? "t" : "ct"}">${escapeHtml(this.nameOf(s[0]))}</td><td class="num">${s[1]}</td><td class="num">${s[2]}</td><td class="num">${s[5]}</td>`;
      table.append(tr);
    }
    $("resultTable").replaceChildren(table);
    this.showScreen("result");
  }

  // ------------------------------------------------------------ chat en partida

  openTeamChat(): void {
    this.teamChatInput.hidden = false;
    this.teamChatInput.focus();
  }

  closeTeamChat(): void {
    this.teamChatInput.value = "";
    this.teamChatInput.hidden = true;
    this.teamChatInput.blur();
  }

  get isTeamChatOpen(): boolean {
    return !this.teamChatInput.hidden;
  }
}

/** El orden del menú de compra: armas, granadas, chaleco, casco. */
function rank(item: BuyItem): number {
  if (item.weapon >= 0) return item.weapon;
  if (item.grenade !== undefined) return 100 + item.grenade;
  if (item.kit) return 300;
  return item.armor === "kevlar" ? 200 : 201;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
