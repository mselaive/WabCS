/**
 * Clientes headless para probar el servidor sin abrir el navegador.
 *
 *   npm run dev            (en otra terminal)
 *   node scripts/bot.mjs --bots 2 --seconds 60
 *
 * Los bots se reparten en los dos equipos, marcan listo, y en la ronda caminan
 * hacia el rival más cercano y le disparan. Así se ejercita el ciclo completo:
 * lobby, cuenta regresiva, compra, combate, muertes, rondas y el resultado.
 * También mide el ritmo real del tick y el tamaño del snapshot.
 *
 * Para jugar contra ellos desde el navegador:
 *
 *   node scripts/bot.mjs --room PRB7X9 --bots 1 --seconds 900 --humano
 *
 * y entrás a la misma sala con el link (?room=PRB7X9). Con --humano los bots
 * esperan a que haya alguien de verdad en la sala para marcar listo.
 */
import WebSocket from "ws";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const HOST = arg("url", "ws://127.0.0.1:8787");
const ROOM = arg("room", "BTS234");
const BOTS = Number(arg("bots", 2));
const SECONDS = Number(arg("seconds", 60));
const HUMAN = args.includes("--humano");
/** Con --manso los bots no disparan: para probar tus tiros sin que te maten. */
const TAME = args.includes("--manso");
const PROTOCOL_VERSION = 1;
const TICK_MS = 50;

// Índices de la tupla SnapPlayer.
const P_ID = 0, P_TEAM = 1, P_X = 2, P_Y = 3, P_Z = 4, P_HP = 7, P_FLAGS = 9, P_ACTIVE = 10, P_CROUCH = 13;
const OWN_AMMO0 = 16, OWN_AMMO1 = 18, OWN_MONEY = 20;
const FLAG_ALIVE = 1;
const BTN_SHOOT = 1, BTN_RELOAD = 2;
const ACT_SLOT_0 = 1, ACT_SLOT_1 = 2, ACT_BUY_BASE = 16;
// Índices en BUY_ITEMS (ver weapons.ts): ak 5, m4 6, kevlar 8.
const BUY_AK = 5, BUY_M4 = 6, BUY_KEVLAR = 8;

const isBotName = (name) => /^Bot\d+$/.test(name);
let humanPresent = false;

const stats = {
  snapshots: 0, bytes: 0, maxBytes: 0, phases: [], kills: 0, rounds: 0, errors: [],
  ticks: 0, playMs: 0, prevTick: null, prevTickAt: 0, buys: 0, shots: 0, hits: 0,
  matchWinner: null, finalScore: null,
};

function makeBot(index) {
  const name = `Bot${index + 1}`;
  const team = index % 2;
  const ws = new WebSocket(`${HOST}/parties/game-room/${ROOM}?name=${encodeURIComponent(name)}&v=${PROTOCOL_VERSION}`);
  let id = -1, seq = 1, phase = "", readySent = false, teamSent = false, timer = null;
  let me = null, target = null, roundPhase = 0, bought = false, money = 0, ammo0 = 0, active = -1, slot0 = -1;
  let shootTick = 0;

  ws.on("open", () => {
    timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN || phase !== "playing" || !me) return;
      let act = 0;
      let btn = 0;
      let yaw = 0, pit = 0, f = 0, s = 0;
      if (roundPhase === 0 && !bought && money >= 3100) {
        act = ACT_BUY_BASE + (team === 0 ? BUY_AK : BUY_M4);
        bought = true;
        stats.buys++;
      } else if (roundPhase === 0 && bought && money >= 650 && !me.armorBought) {
        act = ACT_BUY_BASE + BUY_KEVLAR;
        me.armorBought = true;
      } else if (slot0 >= 0 && active !== slot0) {
        act = ACT_SLOT_0;
      }
      if (target) {
        const dx = target.x - me.x;
        const dz = target.z - me.z;
        const dist = Math.hypot(dx, dz);
        // yaw 0 mira a -Z; yaw positivo gira a la izquierda (hacia -X).
        yaw = Math.atan2(-dx, -dz);
        const dy = target.y + 1.1 - (me.y + 1.62);
        pit = Math.atan2(dy, dist);
        f = dist > 6 ? 1 : 0;
        if (shootTick++ % 2 === 0 && !TAME) btn |= BTN_SHOOT;
        if (ammo0 === 0 && active === slot0) btn |= BTN_RELOAD;
        stats.shots += (btn & BTN_SHOOT) ? 1 : 0;
      } else {
        // Sin rival a la vista: al centro del mapa.
        const dx = -me.x, dz = -me.z;
        yaw = Math.atan2(-dx, -dz);
        f = Math.hypot(dx, dz) > 2 ? 1 : 0;
      }
      ws.send(JSON.stringify({ t: "in", seq: seq++, f, s, yaw: Math.round(yaw * 1000), pit: Math.round(pit * 1000), btn, act }));
    }, TICK_MS);
  });

  ws.on("message", (raw) => {
    const text = raw.toString();
    let msg;
    try { msg = JSON.parse(text); } catch { return; }

    if (msg.t === "welcome" || msg.t === "roster") {
      if (msg.t === "welcome") id = msg.you;
      humanPresent = msg.roster.some((p) => !isBotName(p.name));
      if (!teamSent && id > 0) {
        teamSent = true;
        ws.send(JSON.stringify({ t: "team", team }));
      }
      return;
    }
    if (msg.t === "err") { stats.errors.push(`${name}: ${msg.message}`); return; }
    if (msg.t === "start") { bought = false; return; }
    if (msg.t !== "s") return;

    if (phase !== msg.phase) {
      phase = msg.phase;
      if (index === 0) stats.phases.push(msg.phase);
      if (msg.phase === "lobby") readySent = false;
      if (msg.phase === "ended" && index === 0) { stats.matchWinner = msg.winner; stats.finalScore = [msg.rd[3], msg.rd[4]]; }
    }
    if (phase === "lobby" && !readySent && teamSent && (!HUMAN || humanPresent)) {
      readySent = true;
      ws.send(JSON.stringify({ t: "ready", ready: true }));
    }

    const prevRound = roundPhase;
    roundPhase = msg.rd[1];
    if (prevRound !== 0 && roundPhase === 0) { bought = false; if (me) me.armorBought = false; if (index === 0) stats.rounds++; }

    me = null;
    target = null;
    let best = Infinity;
    let mine = null;
    for (const p of msg.players) if (p[P_ID] === id) mine = p;
    if (mine && (mine[P_FLAGS] & FLAG_ALIVE)) {
      me = { x: mine[P_X] / 100, y: mine[P_Y] / 100, z: mine[P_Z] / 100, hp: mine[P_HP], armorBought: me?.armorBought ?? false };
      money = mine[OWN_MONEY] ?? 0;
      ammo0 = mine[OWN_AMMO0] ?? 0;
      active = mine[P_ACTIVE];
      const packed = mine[11];
      slot0 = (packed % 16) - 1;
      if (slot0 >= 0) slot0 = slot0; // id del arma principal
      void OWN_AMMO1;
      void P_CROUCH;
      for (const p of msg.players) {
        if (p[P_ID] === id || !(p[P_FLAGS] & FLAG_ALIVE) || p[P_TEAM] === team) continue;
        const d = Math.hypot(p[P_X] / 100 - me.x, p[P_Z] / 100 - me.z);
        if (d < best) { best = d; target = { x: p[P_X] / 100, y: p[P_Y] / 100, z: p[P_Z] / 100 }; }
      }
    }

    if (index !== 0) return;
    const now = Date.now();
    stats.snapshots++;
    stats.bytes += text.length;
    stats.maxBytes = Math.max(stats.maxBytes, text.length);
    for (const ev of msg.ev ?? []) {
      if (ev.t === "kill") stats.kills++;
      if (ev.t === "hit") stats.hits++;
    }
    if (msg.phase === "playing") {
      if (stats.prevTick !== null && msg.tick > stats.prevTick) {
        stats.ticks += msg.tick - stats.prevTick;
        stats.playMs += now - stats.prevTickAt;
      }
      stats.prevTick = msg.tick;
      stats.prevTickAt = now;
    }
  });

  ws.on("error", (err) => stats.errors.push(`${name}: ${err.message}`));
  ws.on("close", () => timer && clearInterval(timer));
  return ws;
}

console.log(`Conectando ${BOTS} bots a ${HOST} sala ${ROOM} por ${SECONDS}s...`);
const sockets = Array.from({ length: BOTS }, (_, i) => makeBot(i));

setTimeout(() => {
  for (const ws of sockets) ws.close();
  const elapsed = stats.playMs / 1000;
  const tickRate = elapsed > 0 ? stats.ticks / elapsed : 0;
  console.log("\n--- resultados ---");
  console.log(`fases:                 ${stats.phases.join(" -> ") || "(ninguna)"}`);
  console.log(`tick del servidor:     ${tickRate.toFixed(2)}/s (objetivo 20)`);
  console.log(`snapshots recibidos:   ${stats.snapshots}`);
  console.log(`snapshot promedio:     ${Math.round(stats.bytes / Math.max(stats.snapshots, 1))} bytes`);
  console.log(`snapshot más grande:   ${stats.maxBytes} bytes`);
  console.log(`compras:               ${stats.buys}`);
  console.log(`inputs con disparo:    ${stats.shots}`);
  console.log(`impactos:              ${stats.hits}`);
  console.log(`kills:                 ${stats.kills}`);
  console.log(`rondas jugadas:        ${stats.rounds + (stats.phases.includes("playing") ? 1 : 0)}`);
  if (stats.finalScore) console.log(`resultado:             T ${stats.finalScore[0]} - ${stats.finalScore[1]} CT (ganó ${stats.matchWinner})`);
  if (stats.errors.length) console.log(`errores:\n  ${stats.errors.join("\n  ")}`);
  const ok = tickRate > 18 && tickRate < 22 && stats.phases.includes("playing") && stats.kills > 0 && stats.errors.length === 0;
  console.log(ok ? "\nOK: el servidor corrió la partida al ritmo esperado y hubo combate." : "\nFALLA: revisar arriba.");
  process.exit(ok ? 0 : 1);
}, SECONDS * 1000);
