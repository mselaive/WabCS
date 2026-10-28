/**
 * Compila el cliente y verifica que el bundle de producción realmente arranque.
 *
 *   node scripts/smoke-build.mjs
 *
 * Existe porque hay una familia entera de fallas que solo aparecen al
 * empaquetar: Vite sirve los módulos sueltos, Rollup los agrupa en chunks y
 * cambia el orden de evaluación. La prueba es a propósito tonta: ¿aparece el
 * canvas y se habilita el botón de crear sala? Si no, el juego no existe.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const client = resolve(here, "../apps/client");
const PORT = 4178;

const run = (cmd, args, opts = {}) =>
  new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: client, shell: true, stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} salió con ${code}`))));
  });

console.log("Compilando...");
await run("npx", ["vite", "build"]);

console.log(`Sirviendo el build en :${PORT}...`);
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: client,
  shell: true,
  stdio: "ignore",
});

const problemas = [];
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on("pageerror", (e) => problemas.push(`excepción: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problemas.push(`error: ${m.text()}`);
  });
  page.on("requestfailed", (r) => problemas.push(`petición fallida: ${r.url()}`));

  for (let i = 0; i < 30; i++) {
    try {
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 2000 });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // El botón se habilita recién cuando `Game.init()` resolvió: el renderizador arrancó.
  await page.waitForFunction(
    () => document.getElementById("btnCreate") && !document.getElementById("btnCreate").disabled,
    { timeout: 30000 },
  );

  const canvas = await page.evaluate(() => !!document.querySelector("#stage canvas"));
  if (!canvas) problemas.push("no se creó el canvas dentro de #stage");
  console.log(canvas ? "El bundle arranca y dibuja." : "SIN CANVAS.");
} catch (err) {
  problemas.push(`no arrancó: ${err.message}`);
} finally {
  await browser.close();
  server.kill();
}

if (problemas.length) {
  console.log("\n--- problemas ---");
  for (const p of [...new Set(problemas)]) console.log(`  ${p}`);
  process.exit(1);
}
console.log("OK: el build de producción arranca.");
