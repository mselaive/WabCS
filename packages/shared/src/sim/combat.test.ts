import { describe, expect, it } from "vitest";
import { BODEGA } from "../map/bodega.js";
import { HEAD_HEIGHT, LAG_COMP_MAX_TICKS, TAG_TICKS, TEAM_CT, TEAM_T, ZONE_BODY, ZONE_HEAD } from "../constants.js";
import { AK47, AWP, GLOCK, KNIFE, NOVA, SLOT_PRIMARY, SLOT_SECONDARY, USP, weapon } from "../weapons.js";
import { applyArmor, recordTrail, resetTrail, resolveShot, shotDirections, shotRewind, stepWeaponState } from "./combat.js";
import { eyeHeightOf, maxSpeedOf, stepPlayerMovement } from "./movement.js";
import { createGameState, createPlayer } from "./step.js";
import type { PlayerInput, SimEvent } from "./types.js";

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1, fwd: 0, side: 0, yaw: 0, pitch: 0, shoot: false, reload: false, jump: false, crouch: false, walk: false, scope: false, use: false, act: 0, view: -1,
  ...over,
});

function armed(id: number, team: number, wid: number, x: number, z: number) {
  const p = createPlayer(id, team);
  p.alive = true;
  p.x = x;
  p.z = z;
  const w = weapon(wid);
  p.slots[w.slot] = wid;
  p.ammo[w.slot] = w.mag;
  p.reserve[w.slot] = w.reserve;
  p.active = w.slot;
  resetTrail(p);
  return p;
}

describe("el arma", () => {
  it("una semiautomática dispara una vez por click aunque se mantenga apretado", () => {
    const p = armed(1, TEAM_T, GLOCK, 0, 0);
    let shots = 0;
    for (let i = 0; i < 20; i++) if (stepWeaponState(p, input({ shoot: true }), true) >= 0) shots++;
    expect(shots).toBe(1);
    // Soltar y volver a apretar: otra.
    stepWeaponState(p, input(), true);
    for (let i = 0; i < 5; i++) if (stepWeaponState(p, input({ shoot: true }), true) >= 0) shots++;
    expect(shots).toBe(2);
  });

  it("una automática respeta la cadencia", () => {
    const p = armed(1, TEAM_T, AK47, 0, 0);
    let shots = 0;
    for (let i = 0; i < 20; i++) if (stepWeaponState(p, input({ shoot: true }), true) >= 0) shots++;
    expect(shots).toBe(10); // cada 2 ticks
    expect(p.ammo[SLOT_PRIMARY]).toBe(20);
  });

  it("con el cargador vacío el gatillo recarga", () => {
    const p = armed(1, TEAM_T, GLOCK, 0, 0);
    p.ammo[SLOT_SECONDARY] = 0;
    expect(stepWeaponState(p, input({ shoot: true }), true)).toBe(-1);
    expect(p.reloading).toBe(true);
    for (let i = 0; i < weapon(GLOCK).reloadTicks; i++) stepWeaponState(p, input(), true);
    expect(p.reloading).toBe(false);
    expect(p.ammo[SLOT_SECONDARY]).toBe(20);
    expect(p.reserve[SLOT_SECONDARY]).toBe(100);
  });

  it("en el tiempo de compra no sale el tiro", () => {
    const p = armed(1, TEAM_T, GLOCK, 0, 0);
    expect(stepWeaponState(p, input({ shoot: true }), false)).toBe(-1);
    expect(p.ammo[SLOT_SECONDARY]).toBe(20);
  });

  it("la dispersión es determinista y crece con el retroceso", () => {
    const p = armed(1, TEAM_T, AK47, 0, 0);
    const a = shotDirections(p, AK47, 7);
    const b = shotDirections(p, AK47, 7);
    expect(a).toEqual(b);
    const q = armed(1, TEAM_T, AK47, 0, 0);
    q.recoil = 8;
    const spread = (dirs: { x: number; y: number; z: number }[]) => Math.hypot(dirs[0]!.x, dirs[0]!.y);
    // Mismo seq: el mismo punto del disco, más lejos del centro.
    expect(spread(shotDirections(q, AK47, 7))).toBeGreaterThan(spread(a));
    expect(shotDirections(p, NOVA, 1)).toHaveLength(9);
  });
});

describe("el chaleco", () => {
  it("absorbe parte del daño y se gasta", () => {
    const p = createPlayer(1);
    p.armor = 100;
    const after = applyArmor(p, 36, ZONE_BODY, 0.775);
    expect(after).toBeLessThan(36);
    expect(p.armor).toBeLessThan(100);
  });

  it("sin casco la cabeza no se protege", () => {
    const p = createPlayer(1);
    p.armor = 100;
    expect(applyArmor(p, 100, ZONE_HEAD, 0.5)).toBe(100);
    p.helmet = true;
    expect(applyArmor(p, 100, ZONE_HEAD, 0.5)).toBeLessThan(100);
  });
});

describe("el tiro", () => {
  function duel(wid: number, distance: number, pitchToHead = false) {
    const state = createGameState();
    state.phase = "playing";
    const shooter = armed(1, TEAM_T, wid, 0, 0);
    const target = armed(2, TEAM_CT, USP, 0, -distance);
    state.players.push(shooter, target);
    if (pitchToHead) {
      // Apuntar al centro de la cabeza, que está entre h-HEAD_HEIGHT y h.
      const dy = 1.8 - HEAD_HEIGHT / 2 - eyeHeightOf(shooter);
      shooter.pitch = Math.atan2(dy, distance);
    } else {
      // Al pecho.
      const dy = 1.1 - eyeHeightOf(shooter);
      shooter.pitch = Math.atan2(dy, distance);
    }
    const events: SimEvent[] = [];
    return { state, shooter, target, events };
  }

  it("le pega al rival que tiene enfrente y el tiro queda registrado", () => {
    const { state, shooter, target, events } = duel(USP, 8);
    resolveShot(state, shooter, USP, 1, 0, BODEGA, events);
    const hit = events.find((e) => e.t === "hit");
    expect(hit).toBeDefined();
    expect(target.hp).toBeLessThan(100);
    const shot = events.find((e) => e.t === "shot");
    expect(shot?.t === "shot" && shot.hits[3]).toBe(2);
  });

  it("en la cabeza hace cuatro veces el daño", () => {
    const { state, shooter, target, events } = duel(USP, 5, true);
    resolveShot(state, shooter, USP, 1, 0, BODEGA, events);
    const hit = events.find((e) => e.t === "hit");
    expect(hit?.t === "hit" && hit.zone).toBe(ZONE_HEAD);
    expect(target.hp).toBe(0);
    expect(events.some((e) => e.t === "kill" && e.headshot)).toBe(true);
    expect(shooter.kills).toBe(1);
    expect(shooter.money).toBe(1100);
  });

  it("el AWP mata de un tiro al cuerpo, la pistola no", () => {
    const a = duel(AWP, 10);
    a.shooter.scoped = true;
    resolveShot(a.state, a.shooter, AWP, 1, 0, BODEGA, a.events);
    expect(a.target.alive).toBe(false);
    const b = duel(USP, 10);
    resolveShot(b.state, b.shooter, USP, 1, 0, BODEGA, b.events);
    expect(b.target.alive).toBe(true);
  });

  it("la pared de la casita del mid frena la bala", () => {
    const { state, shooter, target, events } = duel(USP, 12);
    // Shooter en z=6 mirando a -Z: la pared sur de la casita está en z=4 (x -5..-1).
    shooter.x = -3;
    shooter.z = 6;
    target.x = -3;
    target.z = -6;
    resolveShot(state, shooter, USP, 1, 0, BODEGA, events);
    expect(events.some((e) => e.t === "hit")).toBe(false);
    const shot = events.find((e) => e.t === "shot");
    expect(shot?.t === "shot" && shot.hits[3]).toBe(1);
  });

  it("el AK atraviesa una pared fina con menos daño; la gruesa frena la bala", () => {
    const thin = { ...BODEGA, boxes: [{ minX: -2, minY: 0, minZ: -5.1, maxX: 2, maxY: 3, maxZ: -4.9, tex: 1 }] };
    const a = duel(AK47, 10);
    resolveShot(a.state, a.shooter, AK47, 1, 0, thin, a.events);
    const hit = a.events.find((e) => e.t === "hit");
    expect(hit).toBeDefined();
    const full = weapon(AK47).damage * Math.pow(weapon(AK47).range, 1);
    expect(hit?.t === "hit" && hit.amount).toBeLessThan(full);
    expect(hit?.t === "hit" && hit.amount).toBeGreaterThan(full * 0.4);
    // El evento trae los dos puntos: la pared y el cuerpo.
    const shot = a.events.find((e) => e.t === "shot");
    expect(shot?.t === "shot" && shot.hits.length).toBe(8);
    expect(shot?.t === "shot" && shot.hits[3]).toBe(1);
    expect(shot?.t === "shot" && shot.hits[7]).toBe(2);

    const thick = { ...BODEGA, boxes: [{ minX: -2, minY: 0, minZ: -5.5, maxX: 2, maxY: 3, maxZ: -4.5, tex: 1 }] };
    const b = duel(AK47, 10);
    resolveShot(b.state, b.shooter, AK47, 1, 0, thick, b.events);
    expect(b.events.some((e) => e.t === "hit")).toBe(false);

    // Pegado a la pared del otro lado también recibe (el tramo arranca en la cara de salida).
    const d = duel(AK47, 10);
    d.target.z = -(5.1 + 0.3 + 0.001);
    resolveShot(d.state, d.shooter, AK47, 1, 0, thin, d.events);
    expect(d.events.some((e) => e.t === "hit")).toBe(true);

    // La pistola no atraviesa ni la fina.
    const c = duel(USP, 10);
    resolveShot(c.state, c.shooter, USP, 1, 0, thin, c.events);
    expect(c.events.some((e) => e.t === "hit")).toBe(false);
  });

  it("un tiro recibido frena al que lo recibe por unos ticks", () => {
    const { state, shooter, target, events } = duel(AK47, 8);
    resolveShot(state, shooter, AK47, 1, 0, BODEGA, events);
    expect(target.tagged).toBe(TAG_TICKS);
    const slow = maxSpeedOf(target, input());
    expect(slow).toBeLessThan(weapon(USP).speed * 0.5);
    for (let i = 0; i < TAG_TICKS; i++) stepPlayerMovement(target, input(), BODEGA, true);
    expect(target.tagged).toBe(0);
    expect(maxSpeedOf(target, input())).toBe(weapon(USP).speed);
  });

  it("matar paga según el arma: poco con el AWP, mucho con la escopeta", () => {
    const a = duel(AWP, 10);
    a.shooter.scoped = true;
    resolveShot(a.state, a.shooter, AWP, 1, 0, BODEGA, a.events);
    expect(a.target.alive).toBe(false);
    expect(a.shooter.money).toBe(800 + 100);
    const b = duel(NOVA, 3);
    b.target.hp = 10;
    resolveShot(b.state, b.shooter, NOVA, 1, 0, BODEGA, b.events);
    expect(b.target.alive).toBe(false);
    expect(b.shooter.money).toBe(800 + 900);
  });

  it("al morir se le caen las armas", () => {
    const { state, shooter, target, events } = duel(AWP, 6);
    shooter.scoped = true;
    target.slots[SLOT_PRIMARY] = AK47;
    target.ammo[SLOT_PRIMARY] = 30;
    resolveShot(state, shooter, AWP, 1, 0, BODEGA, events);
    expect(target.alive).toBe(false);
    expect(state.drops.map((d) => d.weapon).sort()).toEqual([USP, AK47].sort());
  });

  it("el cuchillo sólo llega de cerca", () => {
    const far = duel(KNIFE, 3);
    resolveShot(far.state, far.shooter, KNIFE, 1, 0, BODEGA, far.events);
    expect(far.target.hp).toBe(100);
    const near = duel(KNIFE, 1.0);
    resolveShot(near.state, near.shooter, KNIFE, 1, 0, BODEGA, near.events);
    expect(near.target.hp).toBeLessThan(100);
  });

  it("compensación de lag: le pega a donde estaba el otro cuando disparó", () => {
    const { state, shooter, target, events } = duel(USP, 8);
    // El rival estaba enfrente hace 4 ticks y ahora se corrió 3 m a un costado.
    for (let t = 1; t <= 10; t++) {
      state.tick = t;
      target.x = t <= 6 ? 0 : 3;
      recordTrail(target, t);
    }
    const noRewind: SimEvent[] = [];
    resolveShot(state, shooter, USP, 1, 0, BODEGA, noRewind);
    expect(noRewind.some((e) => e.t === "hit")).toBe(false);
    resolveShot(state, shooter, USP, 2, shotRewind(10, 6), BODEGA, events);
    expect(events.some((e) => e.t === "hit")).toBe(true);
    expect(shotRewind(100, 0)).toBe(LAG_COMP_MAX_TICKS);
  });
});
