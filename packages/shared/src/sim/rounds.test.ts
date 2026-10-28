import { describe, expect, it } from "vitest";
import { BODEGA } from "../map/bodega.js";
import {
  ACT_BUY_BASE,
  FREEZE_TICKS,
  LOSS_BASE,
  LOSS_STEP,
  ROUND_OVER_TICKS,
  ROUND_TICKS,
  START_MONEY,
  TEAM_CT,
  TEAM_T,
  WIN_REWARD,
} from "../constants.js";
import { AK47, GLOCK, KNIFE, M4A4, USP, buyItemIndex } from "../weapons.js";
import { createGameState, createPlayer, step } from "./step.js";
import { startMatch } from "./rounds.js";
import type { PlayerInput, SimEvent } from "./types.js";

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, fwd: 0, side: 0, yaw: 0, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, walk: false, scope: false, use: false, act: 0, view: -1,
  ...over,
});

function match(winRounds = 5) {
  const state = createGameState();
  state.players.push(createPlayer(1, TEAM_T), createPlayer(2, TEAM_CT));
  const events: SimEvent[] = [];
  startMatch(state, 1, BODEGA, winRounds, events);
  return { state, events };
}

const noInputs = new Map<number, PlayerInput[]>();

function run(state: ReturnType<typeof createGameState>, events: SimEvent[], ticks: number) {
  for (let i = 0; i < ticks; i++) step(state, noInputs, events, BODEGA);
}

describe("las rondas", () => {
  it("arrancan con tiempo de compra, pistola del equipo y dinero inicial", () => {
    const { state } = match();
    expect(state.round.phase).toBe("freeze");
    const [t, ct] = state.players;
    expect(t!.slots).toEqual([-1, GLOCK, KNIFE, -1]);
    expect(ct!.slots).toEqual([-1, USP, KNIFE, -1]);
    expect(t!.money).toBe(START_MONEY);
    expect(t!.z).toBeGreaterThan(0);
    expect(ct!.z).toBeLessThan(0);
    expect(t!.alive && ct!.alive).toBe(true);
  });

  it("pasan de compra a juego, y por tiempo ganan los CT", () => {
    const { state, events } = match();
    run(state, events, FREEZE_TICKS);
    expect(state.round.phase).toBe("live");
    run(state, events, ROUND_TICKS);
    expect(state.round.phase).toBe("over");
    expect(state.round.winner).toBe(TEAM_CT);
    expect(state.round.reason).toBe("time");
    expect(state.round.score).toEqual([0, 1]);
    const [t, ct] = state.players;
    expect(ct!.money).toBe(START_MONEY + WIN_REWARD);
    expect(t!.money).toBe(START_MONEY + LOSS_BASE);
    run(state, events, ROUND_OVER_TICKS);
    expect(state.round.number).toBe(2);
    expect(state.round.phase).toBe("freeze");
  });

  it("eliminar al otro equipo gana la ronda y la racha de derrotas paga más", () => {
    const { state, events } = match();
    run(state, events, FREEZE_TICKS);
    const ct = state.players[1]!;
    ct.alive = false;
    step(state, noInputs, events, BODEGA);
    expect(state.round.winner).toBe(TEAM_T);
    expect(state.round.reason).toBe("elim");
    run(state, events, ROUND_OVER_TICKS);
    // Segunda ronda: el CT revive con lo de arranque; vuelve a perder.
    expect(ct.alive).toBe(true);
    run(state, events, FREEZE_TICKS);
    const moneyBefore = ct.money;
    ct.alive = false;
    step(state, noInputs, events, BODEGA);
    expect(ct.money).toBe(moneyBefore + LOSS_BASE + LOSS_STEP);
  });

  it("el que sobrevive conserva su arma; el que muere arranca con la pistola", () => {
    const { state, events } = match();
    const [t, ct] = state.players;
    t!.slots[0] = AK47;
    t!.ammo[0] = 30;
    ct!.slots[0] = M4A4;
    run(state, events, FREEZE_TICKS);
    ct!.alive = false;
    step(state, noInputs, events, BODEGA);
    run(state, events, ROUND_OVER_TICKS);
    expect(t!.slots[0]).toBe(AK47);
    expect(ct!.slots[0]).toBe(-1);
  });

  it("a la mitad se cambia de lado y el partido termina al llegar a las rondas", () => {
    const { state, events } = match(3);
    // El T gana dos rondas seguidas: a 3, se cambia de lado después de la ronda 2.
    for (let r = 0; r < 2; r++) {
      run(state, events, FREEZE_TICKS);
      const ct = state.players.find((p) => p.team === TEAM_CT)!;
      ct.alive = false;
      step(state, noInputs, events, BODEGA);
      run(state, events, ROUND_OVER_TICKS);
    }
    expect(state.round.swapped).toBe(true);
    expect(events.some((e) => e.t === "swap")).toBe(true);
    // El jugador 1 ahora es CT y el marcador se dio vuelta con él: sus 2 rondas siguen siendo suyas.
    expect(state.players[0]!.team).toBe(TEAM_CT);
    expect(state.round.score).toEqual([0, 2]);
    expect(state.players[0]!.money).toBe(START_MONEY);
    // Gana una más: partido.
    run(state, events, FREEZE_TICKS);
    state.players[1]!.alive = false;
    step(state, noInputs, events, BODEGA);
    run(state, events, ROUND_OVER_TICKS);
    expect(state.phase).toBe("ended");
    expect(state.winnerTeam).toBe(TEAM_CT);
    expect(events.some((e) => e.t === "match" && e.winner === TEAM_CT)).toBe(true);
  });

  it("se compra en el tiempo de compra, no después lejos del spawn", () => {
    const { state, events } = match();
    const t = state.players[0]!;
    t.money = 3000;
    const buyAk = new Map([[1, [input({ act: ACT_BUY_BASE + buyItemIndex("ak") })]]]);
    step(state, buyAk, events, BODEGA);
    expect(t.slots[0]).toBe(AK47);
    expect(t.money).toBe(300);
    // Un CT no puede comprar el AK.
    const ct = state.players[1]!;
    ct.money = 3000;
    step(state, new Map([[2, [input({ act: ACT_BUY_BASE + buyItemIndex("ak") })]]]), events, BODEGA);
    expect(ct.slots[0]).toBe(-1);
    // Pasado el tiempo de compra y lejos del spawn, no.
    run(state, events, FREEZE_TICKS + 11 * 20);
    t.money = 3000;
    t.z = 0;
    step(state, new Map([[1, [input({ act: ACT_BUY_BASE + buyItemIndex("deagle") })]]]), events, BODEGA);
    expect(t.slots[1]).toBe(GLOCK);
  });

  it("el chaleco y el casco", () => {
    const { state, events } = match();
    const t = state.players[0]!;
    t.money = 1500;
    step(state, new Map([[1, [input({ act: ACT_BUY_BASE + buyItemIndex("kevlar") })]]]), events, BODEGA);
    expect(t.armor).toBe(100);
    expect(t.money).toBe(850);
    // Con el chaleco entero, el casco sale la diferencia.
    step(state, new Map([[1, [input({ act: ACT_BUY_BASE + buyItemIndex("helmet") })]]]), events, BODEGA);
    expect(t.helmet).toBe(true);
    expect(t.money).toBe(500);
  });
});
