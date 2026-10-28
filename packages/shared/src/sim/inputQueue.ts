import { MAX_INPUT_BUFFER } from "../constants.js";
import type { PlayerInput } from "./types.js";

/** Inputs que se dejan esperando sin hacer nada. Con más, se procesa uno extra. */
const QUEUE_TARGET = 1;

/**
 * La cola de inputs de un jugador en el servidor.
 *
 * Cada input se procesa exactamente una vez y en orden, que es lo mismo que
 * hace la predicción del cliente con ellos: así el servidor llega a la misma
 * posición y dispara en los mismos inputs, sin nada que corregir.
 *
 * - Si no llegó nada, el jugador espera. El WebSocket es TCP y no pierde nada,
 *   sólo atrasa: repetir el último input haría dar pasos (o tiros) que el
 *   cliente no dio.
 * - Si se juntaron varios, se procesa uno extra para ponerse al día, pero sólo
 *   recuperando ticks en que no llegó nada: un cliente modificado que mandara
 *   inputs al doble de ritmo no camina al doble de velocidad.
 */
export class InputQueue {
  private queue: PlayerInput[] = [];
  private lastSeq = 0;
  private credit = 0;

  /** Agrega un input. Los repetidos o fuera de orden se descartan: el seq sólo avanza. */
  push(input: PlayerInput): void {
    const tail = this.queue[this.queue.length - 1]?.seq ?? this.lastSeq;
    if (input.seq <= tail) return;
    this.queue.push(input);
    while (this.queue.length > MAX_INPUT_BUFFER) this.queue.shift();
  }

  /** Los inputs a procesar en este tick: ninguno, uno, o dos si hay atraso. */
  take(): PlayerInput[] {
    this.credit = Math.min(this.credit + 1, MAX_INPUT_BUFFER);
    const batch: PlayerInput[] = [];

    const next = this.queue.shift();
    if (next) batch.push(next);
    if (this.queue.length > QUEUE_TARGET && this.credit > 1) batch.push(this.queue.shift()!);

    this.credit -= batch.length;
    const last = batch[batch.length - 1];
    if (last) this.lastSeq = last.seq;
    return batch;
  }

  get length(): number {
    return this.queue.length;
  }

  /** El cliente vuelve a numerar desde 1 (recargó la página). */
  clear(): void {
    this.queue.length = 0;
    this.lastSeq = 0;
    this.credit = 0;
  }
}
