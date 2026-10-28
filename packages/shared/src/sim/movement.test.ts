import { describe, expect, it } from "vitest";
import { BODEGA } from "../map/bodega.js";
import { JUMP_SPEED, PLAYER_HEIGHT, STEP_HEIGHT, TICK_RATE } from "../constants.js";
import { heightOf, stepPlayerMovement } from "./movement.js";
import { createPlayer } from "./step.js";
import type { PlayerInput } from "./types.js";

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({
  seq: 1,
  fwd: 0,
  side: 0,
  yaw: 0,
  pitch: 0,
  shoot: false,
  reload: false,
  jump: false,
  crouch: false,
  walk: false,
  scope: false,
  act: 0,
  view: -1,
  ...over,
});

function spawn(x: number, z: number) {
  const p = createPlayer(1);
  p.alive = true;
  p.x = x;
  p.z = z;
  p.y = 0;
  p.onGround = true;
  return p;
}

describe("movimiento", () => {
  it("camina hacia adelante a la velocidad del arma y frena al soltar", () => {
    const p = spawn(0, 12);
    for (let i = 0; i < 20; i++) stepPlayerMovement(p, input({ fwd: 1 }), BODEGA, true);
    // yaw 0 mira a -Z: se aleja del spawn T hacia el centro.
    expect(p.z).toBeLessThan(8);
    expect(Math.hypot(p.vx, p.vz)).toBeGreaterThan(4.5);
    for (let i = 0; i < 10; i++) stepPlayerMovement(p, input(), BODEGA, true);
    expect(Math.hypot(p.vx, p.vz)).toBeLessThan(0.1);
  });

  it("no se mueve en el tiempo de compra pero sí mira", () => {
    const p = spawn(0, 12);
    for (let i = 0; i < 10; i++) stepPlayerMovement(p, input({ fwd: 1, yaw: 1.2 }), BODEGA, false);
    expect(p.z).toBeCloseTo(12, 3);
    expect(p.yaw).toBe(1.2);
  });

  it("no atraviesa las paredes del perímetro", () => {
    const p = spawn(0, 12);
    for (let i = 0; i < 200; i++) stepPlayerMovement(p, input({ fwd: -1 }), BODEGA, true);
    expect(p.z).toBeLessThan(16);
    expect(p.z).toBeGreaterThan(15.5);
  });

  it("salta y vuelve a caer al piso", () => {
    const p = spawn(0, 12);
    stepPlayerMovement(p, input({ jump: true }), BODEGA, true);
    expect(p.onGround).toBe(false);
    expect(p.vy).toBeGreaterThan(JUMP_SPEED * 0.8);
    let maxY = 0;
    for (let i = 0; i < TICK_RATE * 2; i++) {
      stepPlayerMovement(p, input(), BODEGA, true);
      maxY = Math.max(maxY, p.y);
    }
    expect(maxY).toBeGreaterThan(1);
    expect(p.onGround).toBe(true);
    expect(p.y).toBeCloseTo(0, 2);
  });

  it("sube un escalón bajo caminando y no una pared", () => {
    // Plataforma de 0,4 m en el lado derecho (x 18..22, z 4.5..5.5 y 1..4.5 a 0,8).
    const p = spawn(20, 7);
    for (let i = 0; i < 6; i++) stepPlayerMovement(p, input({ fwd: 1 }), BODEGA, true);
    // Primero el escalón de 0,4...
    expect(p.y).toBeCloseTo(0.4, 2);
    for (let i = 0; i < 6; i++) stepPlayerMovement(p, input({ fwd: 1 }), BODEGA, true);
    // ...y de ahí a la plataforma de 0,8: cada uno entra en STEP_HEIGHT.
    expect(p.y).toBeCloseTo(0.8, 2);
    expect(STEP_HEIGHT).toBeGreaterThan(0.4);
    // Una pared de 2,6 m no se sube: queda apoyado contra ella.
    const q = spawn(13, 7);
    for (let i = 0; i < 40; i++) stepPlayerMovement(q, input({ fwd: 1 }), BODEGA, true);
    expect(q.y).toBeCloseTo(0, 2);
    expect(q.z).toBeGreaterThan(5);
  });

  it("agachado baja la altura y no se levanta sin lugar", () => {
    const p = spawn(0, 12);
    for (let i = 0; i < 10; i++) stepPlayerMovement(p, input({ crouch: true }), BODEGA, true);
    expect(heightOf(p)).toBeLessThan(PLAYER_HEIGHT);
    for (let i = 0; i < 10; i++) stepPlayerMovement(p, input(), BODEGA, true);
    expect(heightOf(p)).toBeCloseTo(PLAYER_HEIGHT, 5);
  });
});
