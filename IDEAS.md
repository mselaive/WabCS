# Ideas para WabCS

Lo que hay, lo que quedó en la lista y por qué. Primera versión: 28 de octubre de 2026.

## Lo que hay

| Qué | Detalle | Cómo se probó |
|---|---|---|
| Movimiento 3D | Correr, caminar, agacharse, saltar, escalones de hasta 45 cm, colisiones contra cajas | 6 tests + caminar en el navegador comparando predicción y servidor (coinciden al centímetro) |
| Armas | 9 armas con daño por zona, caída con la distancia, chaleco y casco con las fórmulas de CS | 9 tests (semi/auto, recarga, cabeza, AWP, pared, cuchillo) |
| Retroceso | Patrón determinista por arma (sube, se aplana, zigzaguea) más dispersión por movimiento y aire; sacudida de cámara | 4 tests |
| Rondas y economía | Compra, 1:45, CT por tiempo, racha de derrotas, cambio de lado a la mitad, fin del partido | 7 tests + 2 bots headless jugando 6 rondas |
| Comprar, tirar, levantar | Menú con teclas numéricas; las armas del muerto quedan en el piso | Tests + navegador |
| Predicción y compensación de lag | Igual que WabBR, en 3D y con la mira en cada input | Test del rebobinado + navegador |
| Visibilidad | Snapshot por jugador con sólo los rivales a la vista; tiros y pasos que se oyen sin verse | Revisado; sin test propio todavía |
| Gráficos | Texturas de prototipo generadas, cielo con degradé, mapa de entorno, sombras, agujeros de bala, fogonazos con luz, muñecos y armas de cajas | Capturas en el navegador embebido |
| Sonido | Generado por código: tiros por arma, recarga, pasos, hitmarker, rondas | **No lo escuché**: el navegador de prueba no tiene salida. Probalo |
| Reconexión | 15 s de gracia en partida; recargar la página vuelve al asiento | Revisado, sin probar a mano |

## Lo que falta, en orden

1. **Bots del servidor.** Hoy el único bot es el script headless (`scripts/bot.mjs`), que camina
   derecho y tira sin pensar. Para practicar solo hace falta un bot adentro del Durable Object como
   en WabBR: una grilla de caminos (A* sobre las cajas), que compre, que se cubra, con tiempo de
   reacción y error de puntería por dificultad. La estructura ya está (`Seat.bot` en WabBR).
2. **Granadas.** HE, flash y humo. La física de la granada rebotando contra cajas es la misma
   colisión que el jugador. El humo necesita que la visibilidad del servidor lo respete.
3. **Modo bomba.** Plantar en A o B, desactivar, 40 s de mecha. Es una máquina de estados más
   sobre `rounds.ts` y dos zonas en el mapa; el mapa actual tendría que crecer un poco.
4. **Más mapas.** Uno es poco. Con la lista de cajas es rápido; lo que lleva tiempo es que sea
   justo y divertido. Un editor en el navegador (dibujar cajas y exportar el archivo) ahorraría mucho.
5. **Teléfono.** Un FPS con el pulgar es otro juego. Si se hace, dos sticks y ayuda de puntería
   como en WabBR, pero no es prioridad.
6. **Cuentas y ranking.** Nada de esto tiene identidad: el nombre es lo que escribiste. Igual que
   en WabBR, no parece valer la pena mientras sea entre amigos.
7. **Mejores muñecos.** Los de cajas cumplen. Un modelo animado (Kenney o Quaternius tienen
   packs CC0 en glTF) se vería mejor, pero habría que descargarlo, convertirlo y animarlo.

## Dudas abiertas

- **20 Hz.** Es lo que WabBR eligió por el costo de Cloudflare (los mensajes entrantes cuentan 20 a
  1). Para un FPS 1v1 se siente bien con la predicción, pero 30 Hz sería más fino en los duelos de
  AWP. Es una constante (`TICK_RATE`): cambiarla y medir.
- **Tiempo de ronda.** 1:45 con dos jugadores puede ser largo si uno se esconde. Que ganen los CT
  por tiempo obliga a los T a ir; quizás alcance con 1:30.
- **AWP a $4750.** Con $800 de arranque tarda tres rondas en aparecer. En 1v1 es la que más
  decide. Puede ser que convenga bajarla o subir el dinero de arranque para partidos cortos.
