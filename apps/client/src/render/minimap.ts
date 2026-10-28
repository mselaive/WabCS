import { SMOKE_RADIUS, TEAM_T, type GameMap, type SmokeState, type UnpackedBomb, type UnpackedGrenade, type UnpackedPlayer } from "@wabcs/shared";

/** Píxeles por metro del radar. */
const SCALE = 4;

/**
 * El radar: el mapa visto desde arriba (dibujado una vez), y encima vos con
 * tu dirección, tus compañeros, los rivales que estás viendo (los que no ves
 * no llegan del servidor: el radar no es un wallhack), las granadas y los
 * humos. Norte arriba (los CT), como el mapa.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private map: GameMap | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  load(map: GameMap): void {
    this.map = map;
    const w = (map.bounds.maxX - map.bounds.minX) * SCALE;
    const h = (map.bounds.maxZ - map.bounds.minZ) * SCALE;
    this.canvas.width = w;
    this.canvas.height = h;
    const base = document.createElement("canvas");
    base.width = w;
    base.height = h;
    const c = base.getContext("2d")!;
    c.fillStyle = "#1a1f26";
    c.fillRect(0, 0, w, h);
    // Lo más alto más claro: las paredes resaltan sobre los cajones.
    const sorted = [...map.boxes].filter((b) => !b.decal && b.maxY > 0.05).sort((a, b) => a.maxY - b.maxY);
    for (const b of sorted) {
      const shade = Math.min(1, b.maxY / 4);
      c.fillStyle = `rgb(${Math.round(70 + 110 * shade)},${Math.round(75 + 105 * shade)},${Math.round(82 + 100 * shade)})`;
      c.fillRect((b.minX - map.bounds.minX) * SCALE, (b.minZ - map.bounds.minZ) * SCALE, (b.maxX - b.minX) * SCALE, (b.maxZ - b.minZ) * SCALE);
    }
    // Las marcas de los spawns.
    for (const b of map.boxes) {
      if (!b.decal || (b.tex !== 4 && b.tex !== 5)) continue;
      c.fillStyle = b.tex === 4 ? "rgba(240,181,106,0.35)" : "rgba(143,193,255,0.35)";
      c.fillRect((b.minX - map.bounds.minX) * SCALE, (b.minZ - map.bounds.minZ) * SCALE, (b.maxX - b.minX) * SCALE, (b.maxZ - b.minZ) * SCALE);
    }
    this.base = base;
  }

  private px(x: number): number {
    return (x - this.map!.bounds.minX) * SCALE;
  }

  private pz(z: number): number {
    return (z - this.map!.bounds.minZ) * SCALE;
  }

  draw(
    me: { x: number; z: number; yaw: number; team: number; alive: boolean } | null,
    players: readonly UnpackedPlayer[],
    grenades: readonly UnpackedGrenade[],
    smokes: readonly SmokeState[],
    myId: number,
    bomb: UnpackedBomb | null = null,
  ): void {
    if (!this.base || !this.map) return;
    const c = this.ctx;
    c.drawImage(this.base, 0, 0);

    // Los sitios con su letra, y la bomba (plantada, parpadea).
    if (bomb) {
      c.font = "bold 11px Rajdhani, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      for (const s of this.map.sites) {
        c.fillStyle = "rgba(255,201,74,0.18)";
        c.fillRect(this.px(s.minX), this.pz(s.minZ), (s.maxX - s.minX) * SCALE, (s.maxZ - s.minZ) * SCALE);
        c.fillStyle = "#ffc94a";
        c.fillText(s.name, this.px((s.minX + s.maxX) / 2), this.pz((s.minZ + s.maxZ) / 2));
      }
      if (bomb.state > 0 && (bomb.state === 1 || Math.floor(performance.now() / 250) % 2 === 0)) {
        c.fillStyle = bomb.state === 2 ? "#ff3b3b" : "#ffc94a";
        c.beginPath();
        c.arc(this.px(bomb.x), this.pz(bomb.z), 4, 0, Math.PI * 2);
        c.fill();
      }
    }

    for (const s of smokes) {
      c.fillStyle = "rgba(220,220,220,0.5)";
      c.beginPath();
      c.arc(this.px(s.x), this.pz(s.z), SMOKE_RADIUS * SCALE, 0, Math.PI * 2);
      c.fill();
    }
    for (const g of grenades) {
      c.fillStyle = g.kind === 0 ? "#ffcc44" : g.kind === 1 ? "#ffffff" : "#bbbbbb";
      c.beginPath();
      c.arc(this.px(g.x), this.pz(g.z), 2, 0, Math.PI * 2);
      c.fill();
    }
    for (const p of players) {
      if (p.id === myId || !p.alive || !p.connected) continue;
      const mine = me !== null && p.team === me.team;
      c.fillStyle = mine ? (p.team === TEAM_T ? "#f0b56a" : "#8fc1ff") : "#ff4d4d";
      // El compañero que lleva la bomba, con un anillo.
      if (bomb && bomb.carrier === p.id && mine) {
        c.strokeStyle = "#ffc94a";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(this.px(p.x), this.pz(p.z), 6, 0, Math.PI * 2);
        c.stroke();
      }
      c.beginPath();
      c.arc(this.px(p.x), this.pz(p.z), 3.5, 0, Math.PI * 2);
      c.fill();
      // Hacia dónde mira.
      c.strokeStyle = c.fillStyle;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(this.px(p.x), this.pz(p.z));
      c.lineTo(this.px(p.x) - Math.sin(p.yaw) * 7, this.pz(p.z) - Math.cos(p.yaw) * 7);
      c.stroke();
    }
    if (me && me.alive) {
      const x = this.px(me.x);
      const z = this.pz(me.z);
      // El cono de lo que ves.
      c.fillStyle = "rgba(124,255,155,0.12)";
      c.beginPath();
      c.moveTo(x, z);
      c.arc(x, z, 40, -me.yaw - Math.PI / 2 - 0.65, -me.yaw - Math.PI / 2 + 0.65);
      c.closePath();
      c.fill();
      c.fillStyle = "#7cff9b";
      c.beginPath();
      c.arc(x, z, 4, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#7cff9b";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, z);
      c.lineTo(x - Math.sin(me.yaw) * 9, z - Math.cos(me.yaw) * 9);
      c.stroke();
    }
  }
}
