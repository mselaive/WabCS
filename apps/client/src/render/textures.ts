import * as THREE from "three";
import {
  TEX_CONCRETE,
  TEX_COUNT,
  TEX_CRATE,
  TEX_CT,
  TEX_FLOOR,
  TEX_METAL,
  TEX_ROOF,
  TEX_T,
  TEX_WALL,
  TEX_WOOD,
} from "@wabcs/shared";

/**
 * Texturas "de prototipo", generadas por código: un color plano con una grilla
 * de 1 m y una más fina de 25 cm, como las de los kits de prototipado (Kenney,
 * dev_textures), con un bisel en cada baldosa y un poco de ruido y manchas
 * para que no se vea plano. Un tile = 1 m del mundo: la geometría escala los
 * UV por el tamaño de cada cara, así la grilla mide lo mismo en todas partes.
 */

const SIZE = 512;

interface Style {
  base: string;
  line: string;
  fine: string;
  /** Un dibujo extra por tile: planchas, remaches, baldosas, nada. */
  deco?: "planks" | "rivets" | "tiles" | "stripes" | "bricks";
  /** Cuánto se nota el bisel de las baldosas. */
  bevel: number;
  /** Manchas y desgaste. */
  grime: number;
}

const STYLES: Record<number, Style> = {
  [TEX_FLOOR]: { base: "#b4b9bf", line: "#8b9199", fine: "#a9afb5", deco: "tiles", bevel: 0.35, grime: 0.5 },
  [TEX_WALL]: { base: "#dc9560", line: "#a2663b", fine: "#d08a55", deco: "bricks", bevel: 0.45, grime: 0.4 },
  [TEX_CRATE]: { base: "#ad7742", line: "#6b4420", fine: "#9d6a37", deco: "planks", bevel: 0.3, grime: 0.5 },
  [TEX_METAL]: { base: "#6e7985", line: "#444c55", fine: "#657079", deco: "rivets", bevel: 0.6, grime: 0.3 },
  [TEX_T]: { base: "#d3773f", line: "#9b5125", fine: "#c86f38", deco: "stripes", bevel: 0.2, grime: 0.2 },
  [TEX_CT]: { base: "#4f7fb3", line: "#2f5478", fine: "#4876a8", deco: "stripes", bevel: 0.2, grime: 0.2 },
  [TEX_CONCRETE]: { base: "#a2a9af", line: "#767e85", fine: "#989fa5", bevel: 0.4, grime: 0.6 },
  [TEX_WOOD]: { base: "#c69a66", line: "#84603a", fine: "#b88d5a", deco: "planks", bevel: 0.25, grime: 0.4 },
  [TEX_ROOF]: { base: "#5d636b", line: "#3b4046", fine: "#565c63", deco: "tiles", bevel: 0.4, grime: 0.5 },
};

let seed = 12345;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function noise(ctx: CanvasRenderingContext2D, amount: number): void {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i]! + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
}

/** Manchas suaves al azar: desgaste, humedad, sombras de uso. */
function grime(ctx: CanvasRenderingContext2D, amount: number): void {
  for (let i = 0; i < 14 * amount; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const r = 20 + rnd() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.7;
    g.addColorStop(0, dark ? `rgba(0,0,0,${0.12 * amount})` : `rgba(255,255,255,${0.08 * amount})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Un bisel en cada baldosa: luz arriba y a la izquierda, sombra abajo y a la derecha. */
function bevel(ctx: CanvasRenderingContext2D, cells: number, strength: number): void {
  const s = SIZE / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = i * s;
      const y = j * s;
      ctx.fillStyle = `rgba(255,255,255,${0.22 * strength})`;
      ctx.fillRect(x, y, s, 3);
      ctx.fillRect(x, y, 3, s);
      ctx.fillStyle = `rgba(0,0,0,${0.28 * strength})`;
      ctx.fillRect(x, y + s - 3, s, 3);
      ctx.fillRect(x + s - 3, y, 3, s);
    }
  }
}

export function makeTexture(tex: number): THREE.Texture {
  const style = STYLES[tex] ?? STYLES[TEX_CONCRETE]!;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  seed = 12345 + tex * 977;

  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, SIZE, SIZE);
  noise(ctx, 18);
  grime(ctx, style.grime);

  switch (style.deco) {
    case "planks": {
      ctx.strokeStyle = style.line;
      ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        const y = (SIZE / 4) * i + SIZE / 8;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(SIZE, y);
        ctx.stroke();
      }
      // Vetas de la madera.
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 40; i++) {
        const y = rnd() * SIZE;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(SIZE / 3, y + (rnd() - 0.5) * 12, (SIZE * 2) / 3, y + (rnd() - 0.5) * 12, SIZE, y);
        ctx.stroke();
      }
      // Clavos.
      ctx.fillStyle = style.line;
      for (let i = 0; i < 4; i++) {
        const y = (SIZE / 4) * i + SIZE / 8;
        ctx.fillRect(28, y - 5, 7, 7);
        ctx.fillRect(SIZE - 36, y - 5, 7, 7);
      }
      bevel(ctx, 1, style.bevel);
      break;
    }
    case "rivets": {
      bevel(ctx, 2, style.bevel);
      ctx.fillStyle = style.line;
      for (const x of [22, SIZE / 2 - 4, SIZE - 30]) for (const y of [22, SIZE / 2 - 4, SIZE - 30]) ctx.fillRect(x, y, 8, 8);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (const x of [22, SIZE / 2 - 4, SIZE - 30]) for (const y of [22, SIZE / 2 - 4, SIZE - 30]) ctx.fillRect(x + 1, y + 1, 3, 3);
      break;
    }
    case "tiles": {
      bevel(ctx, 4, style.bevel);
      ctx.fillStyle = style.line;
      ctx.fillRect(SIZE / 2 - 4, SIZE / 2 - 4, 8, 8);
      break;
    }
    case "bricks": {
      // Hiladas de ladrillos grandes, corridas media pieza por fila.
      const rows = 4;
      const h = SIZE / rows;
      const w = SIZE / 2;
      for (let r = 0; r < rows; r++) {
        const off = r % 2 === 0 ? 0 : w / 2;
        for (let c = -1; c < 3; c++) {
          const x = c * w + off;
          const y = r * h;
          ctx.fillStyle = `rgba(255,255,255,${0.2 * style.bevel})`;
          ctx.fillRect(x, y, w, 3);
          ctx.fillRect(x, y, 3, h);
          ctx.fillStyle = `rgba(0,0,0,${0.3 * style.bevel})`;
          ctx.fillRect(x, y + h - 4, w, 4);
          ctx.fillRect(x + w - 4, y, 4, h);
        }
      }
      break;
    }
    case "stripes": {
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 18;
      for (let i = -SIZE; i < SIZE * 2; i += 96) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + SIZE, SIZE);
        ctx.stroke();
      }
      break;
    }
    default:
      bevel(ctx, 2, style.bevel);
  }

  // Grilla fina de 25 cm, muy sutil.
  ctx.strokeStyle = style.fine;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (SIZE / 4) * i + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, SIZE);
    ctx.moveTo(0, p);
    ctx.lineTo(SIZE, p);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Grilla de 1 m: el borde del tile.
  ctx.strokeStyle = style.line;
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, SIZE, SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function makeAllMaterials(): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < TEX_COUNT; i++) {
    const metal = i === TEX_METAL;
    out.push(
      new THREE.MeshStandardMaterial({
        map: makeTexture(i),
        roughness: metal ? 0.55 : 0.88,
        metalness: metal ? 0.35 : 0.0,
        envMapIntensity: metal ? 0.8 : 0.35,
      }),
    );
  }
  return out;
}

/** Una textura redonda suave para chispas, polvo y sangre. */
export function makePuffTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Un agujero de bala: un disco oscuro con el borde quemado y un poco irregular. */
export function makeBulletHoleTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(20,16,12,1)");
  g.addColorStop(0.35, "rgba(30,24,18,0.95)");
  g.addColorStop(0.6, "rgba(60,50,40,0.5)");
  g.addColorStop(1, "rgba(80,70,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Un cartelito con texto, para los nombres sobre los compañeros. */
export function makeLabelTexture(text: string, color: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 34px Rajdhani, ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
