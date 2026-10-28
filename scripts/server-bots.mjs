/**
 * Prueba que los bots del servidor jueguen solos.
 *
 *   npm run dev
 *   node scripts/server-bots.mjs
 *
 * Un host con socket pelado entra, agrega bots (que se reparten en los dos
 * equipos), marca listo y se queda quieto en su spawn. Los bots tienen que
 * comprar, encontrarse y matarse hasta que pasen varias rondas.
 */
import WebSocket from "ws";

const WS = process.env.WABCS_WS ?? "ws://127.0.0.1:8787";
const ROOM = `B${Math.random().toString(36).slice(2, 7).toUpperCase()}`.replace(/[AEIOU01]/g, "Z");
const BOTS = Number(process.argv[2] ?? 3);
const ROUNDS = Number(process.argv[3] ?? 3);

const fallos = [];
const check = (ok, que) => {
  console.log(`  ${ok ? "ok  " : "FALLA"} ${que}`);
  if (!ok) fallos.push(que);
};

const estado = { id: -1, roster: [], phase: "", kills: 0, buys: 0, rounds: 0, lastRound: 0, botSkill: -1, score: [0, 0] };
const ws = new WebSocket(`${WS}/parties/game-room/${ROOM}?name=Host&v=1`);
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "welcome") estado.id = m.you;
  if (m.t === "welcome" || m.t === "roster") estado.roster = m.roster;
  if (m.t === "roster") estado.botSkill = m.botSkill;
  if (m.t === "s") {
    estado.phase = m.phase;
    estado.score = [m.rd[3], m.rd[4]];
    if (m.rd[0] !== estado.lastRound) {
      estado.lastRound = m.rd[0];
      estado.rounds++;
    }
    for (const ev of m.ev ?? []) {
      if (ev.t === "kill" && ev.byId !== estado.id) estado.kills++;
      if (ev.t === "buy" && ev.byId !== estado.id) estado.buys++;
    }
  }
});
const enviar = (msg) => ws.send(JSON.stringify(msg));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const hasta = async (cond, ms) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await esperar(200);
  }
  return false;
};

console.log(`Sala ${ROOM} en ${WS}`);
await hasta(() => estado.id > 0, 5000);
for (let i = 0; i < BOTS; i++) enviar({ t: "bot" });
check(await hasta(() => estado.roster.length === BOTS + 1, 5000), `el host agregó ${BOTS} bots`);
const bots = estado.roster.filter((p) => p.bot);
check(bots.every((p) => p.ready), "los bots ya están listos");
const t = estado.roster.filter((p) => p.team === 0).length;
const ct = estado.roster.filter((p) => p.team === 1).length;
check(Math.abs(t - ct) <= 1, `se repartieron en los dos equipos (${t} T, ${ct} CT)`);
enviar({ t: "botSkill", skill: 2 });
check(await hasta(() => estado.botSkill === 2, 3000), "el host puso los bots en difícil");

enviar({ t: "ready", ready: true });
check(await hasta(() => estado.phase === "playing", 15000), "arranca el partido");

console.log(`  (jugando: los bots tienen que comprar, encontrarse y pelear ${ROUNDS} rondas...)`);
check(await hasta(() => estado.rounds > ROUNDS || estado.phase === "ended", ROUNDS * 125 * 1000), `se juegan ${ROUNDS} rondas (${estado.rounds})`);
check(estado.buys > 0, `los bots compran (${estado.buys} compras)`);
check(estado.kills > 0, `y se matan entre ellos (${estado.kills} kills)`);
console.log(`  marcador: T ${estado.score[0]} - ${estado.score[1]} CT`);

ws.close();
if (fallos.length) {
  console.log(`\nFALLA: ${fallos.length} comprobaciones.`);
  process.exit(1);
}
console.log("\nOK: los bots del servidor juegan solos.");
process.exit(0);
