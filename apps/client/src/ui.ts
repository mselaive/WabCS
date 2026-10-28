import {
  BUY_ITEMS,
  TEAM_CT,
  TEAM_NAMES,
  TEAM_T,
  WIN_ROUNDS_OPTIONS,
  weapon,
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
  onChat: (text: string) => void;
  onLeave: () => void;
  onBuy: (index: number) => void;
  onVolume: (volume: number) => void;
  onSensitivity: (value: number) => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta #${id} en index.html`);
  return el as T;
};

const NAME_KEY = "wabcs:name";
const VOLUME_KEY = "wabcs:volume";
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

    const volumeInput = $<HTMLInputElement>("volumeInput");
    const volumeValue = $("volumeValue");
    const savedVolume = load(VOLUME_KEY);
    if (savedVolume) volumeInput.value = savedVolume;
    const applyVolume = () => {
      volumeValue.textContent = `${volumeInput.value}%`;
      save(VOLUME_KEY, volumeInput.value);
      cb.onVolume(Number(volumeInput.value) / 100);
    };
    volumeInput.addEventListener("input", applyVolume);
    applyVolume();

    const sensInput = $<HTMLInputElement>("sensInput");
    const sensValue = $("sensValue");
    const savedSens = load(SENS_KEY);
    if (savedSens) sensInput.value = savedSens;
    const applySens = () => {
      sensValue.textContent = `${(Number(sensInput.value) / 10).toFixed(1)}`;
      save(SENS_KEY, sensInput.value);
      cb.onSensitivity(Number(sensInput.value) / 10);
    };
    sensInput.addEventListener("input", applySens);
    applySens();

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

  updateLobby(roster: PlayerMeta[], hostId: number, myId: number, winRounds: number, botSkill = 1, nextIn?: number): void {
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
    if (w.mag === 0) {
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
    slots.forEach((id, i) => {
      const s = document.createElement("span");
      s.className = `slot${i === active ? " active" : ""}${id < 0 ? " empty" : ""}`;
      s.textContent = `${labels[i]} ${id >= 0 ? weapon(id).short : "—"}`;
      slotsEl.append(s);
    });
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
    if (timeEl.textContent !== time) timeEl.textContent = time;
    timeEl.classList.toggle("urgent", phase === "live" && seconds <= 10);
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

  setLockHint(visible: boolean, text = "Hacé click para jugar"): void {
    const el = $("lockHint");
    el.hidden = !visible;
    el.textContent = text;
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
    w.textContent = `[${weapon(weaponId).short}${headshot ? " ☠" : ""}]`;
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
    let key = 1;
    BUY_ITEMS.forEach((item, index) => {
      if (item.team !== -1 && item.team !== team) return;
      const li = document.createElement("li");
      const cant = money < item.price;
      li.className = cant ? "cant" : "";
      const k = document.createElement("span");
      k.className = "key";
      k.textContent = String(key);
      const name = document.createElement("span");
      name.textContent = item.name;
      if (item.weapon >= 0) {
        const w = weapon(item.weapon);
        const desc = document.createElement("small");
        desc.className = "desc";
        desc.textContent = `${w.damage} daño · ${w.mag} balas · ${w.auto ? "automática" : "semi"}`;
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
      li.dataset.key = String(key);
      li.addEventListener("click", () => this.cb.onBuy(index));
      this.buyList.append(li);
      key++;
    });
  }

  /** Una tecla numérica con el menú abierto: el ítem con ese número. */
  buyByKey(digit: number): void {
    const li = this.buyList.querySelector<HTMLElement>(`li[data-key="${digit}"]`);
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
