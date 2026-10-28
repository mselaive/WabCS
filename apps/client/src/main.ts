import { generateRoomCode, normalizeRoomCode } from "@wabcs/shared";
import { Game } from "./game.js";
import { UI } from "./ui.js";

let game!: Game;

function enterRoom(code: string, name: string): void {
  // El código queda en la URL: recargar la página te devuelve a la misma sala
  // y el link es directamente la invitación.
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState(null, "", url);
  game.connect(code, name);
}

const ui = new UI({
  onCreate: (name) => enterRoom(generateRoomCode(), name),
  onJoin: (name, code) => {
    const normalized = normalizeRoomCode(code);
    if (!normalized) {
      ui.showError("Ese código no existe. Son 6 caracteres, sin vocales.");
      return;
    }
    enterRoom(normalized, name);
  },
  onReady: (ready) => game.setReady(ready),
  onStart: () => game.requestStart(),
  onKick: (id) => game.kick(id),
  onTeam: (team) => game.setTeam(team),
  onRounds: (win) => game.setRounds(win),
  onChat: (text) => game.chat(text),
  onBuy: (index) => game.buy(index),
  onVolume: (volume) => game?.setVolume(volume),
  onSensitivity: (value) => game?.setSensitivity(value),
  onLeave: () => {
    game.disconnect();
    ui.showScreen("menu");
  },
});

game = new Game(ui);
// Para mirar el estado desde la consola del navegador: `wabcs.debugState()`.
(window as unknown as { wabcs: Game }).wabcs = game;

/*
 * OJO: acá NO puede ir `await game.init()` en el nivel superior del módulo. Un
 * `await` de nivel superior deja el módulo de entrada "evaluándose", y en el
 * bundle de producción puede armarse un abrazo mortal con los chunks que
 * dependen de él. Se encadena con then().
 */
ui.setEntryEnabled(false);
game.init().then(
  () => {
    ui.setEntryEnabled(true);
    ui.showScreen("menu");
  },
  (err) => {
    console.error("No arrancó el juego:", err);
    ui.showError("No se pudo iniciar el juego. Probá recargar la página.");
  },
);
