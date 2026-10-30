import { describe, expect, it } from "vitest";
import { BODEGA } from "../map/bodega.js";
import {
  ARMS_LADDER,
  ARMS_RESPAWN_TICKS,
  MODE_ARMS,
  MODE_AWP,
  ZONE_BODY,

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
import { AK47, AWP, GLOCK, KNIFE, M4A1S, USP, buyItemIndex, weapon } from "../weapons.js";
import { damagePlayer } from "./combat.js";
import { canBuy } from "./inventory.js";
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
    ct!.slots[0] = M4A1S;
    run(state, events, FREEZE_TICKS);
    ct!.alive = false;
    step(state, noInputs, events, BODEGA);
    run(state, events, ROUND_OVER_TICKS);
    expect(t!.slots[0]).toBe(AK47);
    expect(ct!.slots[0]).toBe(-1);
  });

  it("el que sobrevive arranca la ronda con el cargador y la reserva llenos", () => {
    const { state, events } = match();
    const [t, ct] = state.players;
    t!.slots[0] = AK47;
    t!.active = 0;
    t!.ammo[0] = 3;
    t!.reserve[0] = 10;
    t!.ammo[1] = 0;
    t!.reloading = true;
    run(state, events, FREEZE_TICKS);
    ct!.alive = false;
    step(state, noInputs, events, BODEGA);
    run(state, events, ROUND_OVER_TICKS);
    expect(t!.ammo[0]).toBe(weapon(AK47).mag);
    expect(t!.reserve[0]).toBe(weapon(AK47).reserve);
    expect(t!.ammo[1]).toBe(weapon(GLOCK).mag);
    expect(t!.reloading).toBe(false);
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

describe("sólo AWP y carrera de armas", () => {
  it("en sólo AWP todos arrancan con AWP, cuchillo y chaleco, y no hay tienda", () => {
    const state = createGameState();
    const t = createPlayer(1, TEAM_T);
    const ct = createPlayer(2, TEAM_CT);
    state.players.push(t, ct);
    const events: SimEvent[] = [];
    startMatch(state, 1, BODEGA, 5, events, MODE_AWP);
    for (const p of [t, ct]) {
      expect(p.slots[0]).toBe(AWP);
      expect(p.slots[1]).toBe(-1);
      expect(p.slots[2]).toBe(KNIFE);
      expect(p.armor).toBe(100);
      expect(canBuy(state, p, BODEGA)).toBe(false);
    }
    // El que muere vuelve con el AWP en la ronda siguiente, como todos.
    damagePlayer(state, ct, t, 500, ZONE_BODY, AWP, ct.x, ct.y, ct.z, BODEGA, events);
    run(state, events, FREEZE_TICKS + ROUND_OVER_TICKS + 2);
    expect(state.round.number).toBe(2);
    expect(ct.alive).toBe(true);
    expect(ct.slots[0]).toBe(AWP);
    expect(ct.ammo[0]).toBe(5);
  });

  it("en la carrera de armas se reaparece, cada baja da la siguiente arma y la del cuchillo gana", () => {
    const state = createGameState();
    const a = createPlayer(1, TEAM_T);
    const b = createPlayer(2, TEAM_CT);
    state.players.push(a, b);
    const events: SimEvent[] = [];
    startMatch(state, 1, BODEGA, 5, events, MODE_ARMS);
    expect(a.slots[1]).toBe(ARMS_LADDER[0]);
    expect(state.round.winRounds).toBe(ARMS_LADDER.length);
    run(state, events, FREEZE_TICKS);
    expect(state.round.phase).toBe("live");

    // Una baja: la siguiente arma, y el muerto vuelve a los 3 s en su lado.
    damagePlayer(state, b, a, 500, ZONE_BODY, ARMS_LADDER[0]!, b.x, b.y, b.z, BODEGA, events);
    expect(b.alive).toBe(false);
    run(state, events, 1);
    expect(a.slots.includes(ARMS_LADDER[1]!)).toBe(true);
    expect(state.round.phase).toBe("live");
    expect(state.drops.length).toBe(0);
    run(state, events, ARMS_RESPAWN_TICKS - 2);
    expect(b.alive).toBe(false);
    run(state, events, 2);
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(100);
    expect(b.z).toBeLessThan(0);
    expect(state.round.score[0]).toBe(1);

    // En el último escalón sólo queda el cuchillo; esa baja termina el partido.
    a.kills = ARMS_LADDER.length - 1;
    run(state, events, 1);
    expect(a.slots[0]).toBe(-1);
    expect(a.slots[1]).toBe(-1);
    expect(a.active).toBe(2);
    damagePlayer(state, b, a, 500, ZONE_BODY, KNIFE, b.x, b.y, b.z, BODEGA, events);
    run(state, events, 1);
    expect(state.phase).toBe("ended");
    expect(state.winnerTeam).toBe(TEAM_T);
    expect(events.some((e) => e.t === "match" && e.winner === TEAM_T)).toBe(true);
  });
});
