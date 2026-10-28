/**
 * Corta `npm run dev` si el Node es demasiado viejo para el servidor local.
 *
 * Wrangler necesita Node 22. Con uno más viejo el servidor muere al arrancar,
 * pero el cliente levanta igual: se ve el menú y ninguna sala conecta, con el
 * error perdido entre las líneas de Vite. Mejor no arrancar nada y decir por qué.
 */
const NEEDED = 22;
const major = Number(process.versions.node.split(".")[0]);

if (major < NEEDED) {
  console.error(
    [
      "",
      `WabCS necesita Node ${NEEDED} o más nuevo: el servidor local (wrangler) no arranca con el ${process.version}.`,
      `Instalalo con tu gestor de versiones (por ejemplo \`nvm install ${NEEDED}\`) o poné un Node ${NEEDED} primero en el PATH.`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}
