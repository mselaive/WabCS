# WabCS

Shooter táctico por rondas en primera persona, estilo Counter-Strike, para jugar 1v1 o 2v2 con
amigos desde el navegador. Low-poly con texturas de prototipo, todo generado por código: no se
descarga ni un asset.

- **Cliente**: Vite + TypeScript + Three.js → se despliega en Vercel.
- **Servidor**: Cloudflare Worker + Durable Objects (`partyserver`) → una sala = un Durable Object
  con su propio game loop a 20 Hz.
- **Simulación compartida**: `packages/shared` corre igual en el cliente y en el servidor. Eso es lo
  que permite la predicción del cliente y que el servidor sea el único que decide quién le pegó a quién.

Es hermano de WabBR (el battle royale 2D): misma estructura de proyecto, mismo despliegue, mismo
netcode de base. Lo nuevo es todo lo 3D: movimiento con gravedad y colisiones contra cajas, tiros
por rayo con zonas de impacto, patrón de retroceso, economía y rondas.

## Empezar

Hace falta **Node 22** o más nuevo (lo pide wrangler, el servidor local). Está en `.nvmrc`.

```bash
npm install
npm run dev          # levanta el servidor (:8787) y el cliente (:5173) a la vez
```

Abrí <http://localhost:5173>, creá una sala, copiá el link y abrilo en otra pestaña (o pasáselo a
alguien en tu red). Con uno en cada equipo y todos listos arranca el partido.

Para probar solo, sin segunda pestaña:

```bash
node scripts/bot.mjs --room PRB7X9 --bots 1 --seconds 900 --humano
```

y entrá a la sala `PRB7X9` desde el navegador. El bot se pone en el otro equipo, espera a que
marques listo y te busca para dispararte (es tonto: camina derecho hacia vos y tira sin apuntar
demasiado; alcanza para probar el ciclo entero).

### Controles

| Tecla | Acción |
|---|---|
| `WASD` | moverse |
| Mouse | mirar (el primer click captura el puntero; `Esc` lo suelta) |
| Click izquierdo | disparar |
| Click derecho | mira del AWP (mantener) |
| `Shift` | caminar: más lento, sin ruido |
| `Ctrl` / `C` | agacharse: más lento, más preciso, más bajo |
| `Espacio` | saltar |
| `R` | recargar |
| `1` / `2` / `3` | principal, pistola, cuchillo |
| `Q` | la última arma que tenías |
| `B` | menú de compra (en el tiempo de compra y los primeros 10 s, cerca de tu spawn) |
| `E` | levantar el arma del piso que tengas adelante |
| `G` | tirar el arma que tenés en la mano |
| `Tab` | tabla |
| `Enter` | chat del equipo |
| Muerto: click / `Espacio` | cambiar a quién mirás; sin compañeros vivos, cámara libre con `WASD` |

## Cómo se juega

Dos equipos, **Terroristas** y **Antiterroristas**, por rondas. Gana la ronda el equipo que
elimina al otro. Si se acaba el tiempo (1:45), ganan los CT: son los que defienden, como en CS sin
bomba, así que los T tienen que ir a buscarlos.

Cada ronda empieza con **6 segundos de compra**: nadie se mueve, todos compran (`B`). Después se
puede seguir comprando 10 segundos más, pero sólo a menos de 9 m del centro de tu spawn.

Gana el partido el primero en llegar a las rondas que eligió el host (5, 8 o 13). A una ronda de
la mitad se **cambia de lado**: los T pasan a CT y al revés, con el dinero y las armas de vuelta a
cero. El marcador se da vuelta con ellos.

El que entra con el partido empezado mira como espectador y juega desde la ronda siguiente, en el
equipo con menos gente.

### Dinero

| | |
|---|---|
| Arranque (y después del cambio de lado) | $800 |
| Ganar la ronda | +$3250 |
| Perder la ronda | +$1400, más $500 por cada derrota seguida (hasta $3400) |
| Kill | +$300 (con cuchillo, +$1500) |
| Tope | $16 000 |

El que sobrevive **conserva** sus armas, su munición y su chaleco. El que muere arranca la ronda
siguiente con la pistola de su equipo y el cuchillo. Las armas del que cae quedan en el piso:
cualquiera las levanta con `E` (y las propias se tiran con `G`, para pasarle el rifle al compañero).

### Armas

| | Precio | Daño | Cargador | Cadencia | Notas |
|---|---|---|---|---|---|
| Cuchillo | — | 45 | — | 2/s | 1,3 m de alcance; matar con él paga $1500 |
| Glock-18 (T) | $200 | 28 | 20 + 120 | semi | la pistola de arranque de los T |
| USP-S (CT) | $200 | 35 | 12 + 24 | semi | la de los CT, silenciada |
| Desert Eagle | $700 | 53 | 7 + 35 | semi | mata de un tiro en la cabeza con casco; mucho retroceso |
| MP5-SD | $1500 | 27 | 30 + 120 | auto | la más rápida para moverse |
| Nova | $1050 | 26 × 9 | 8 + 32 | 1/0,9 s | escopeta: devastadora de cerca, inútil de lejos |
| AK-47 (T) | $2700 | 36 | 30 + 90 | auto | mata de un tiro en la cabeza con casco |
| M4A4 (CT) | $3100 | 33 | 30 + 90 | auto | más precisa, menos daño |
| AWP | $4750 | 115 | 5 + 30 | 1/1,5 s | mata de un tiro al cuerpo; sin la mira es una moneda al aire |
| Chaleco | $650 | | | | 100 de chaleco |
| Chaleco y casco | $1000 | | | | sólo el casco, $350, si ya tenés el chaleco entero |

El daño cae con la distancia (cada arma a su ritmo: la escopeta pierde la mitad cada 10 m, el AK
casi nada) y según dónde pega: **cabeza ×4**, cuerpo ×1, piernas ×0,75. El chaleco absorbe parte
del daño al cuerpo (y a la cabeza, con casco) y se va gastando; las piernas no tienen chaleco.
Las fórmulas son las de CS (`applyArmor` en `combat.ts`).

### Retroceso y dispersión

Para que no sea cuestión de apretar y mantener:

- **Patrón de retroceso** (`recoilOffset`): cada tiro seguido sale más arriba que el anterior,
  con una curva que se aplana a los ~8 tiros, y a partir del tercero zigzaguea a los costados. Es
  fijo por arma y determinista, así que se aprende: se compensa tirando el mouse hacia abajo y en
  contra. El retroceso vuelve a cero cuando se deja de disparar (un cargador entero tarda ~1,5 s).
  La cámara se sacude en la misma dirección para que se vea hacia dónde se fue la bala.
- **Dispersión** (`spreadOf`): una base por arma, más lo que suma cada tiro seguido, más lo que
  suma moverse (proporcional a la velocidad) y mucho más en el aire. Agachado baja un 40 %. Con la
  mira del AWP es casi nula; sin ella, enorme.

La dispersión es aleatoria pero **determinista**: sale de quién dispara, el número de input y el
número de perdigón (`hashUnit`). El cliente y el servidor calculan exactamente la misma bala sin
compartir ningún generador, y por eso el trazador que ves al apretar va por donde va la bala real.

## El mapa

**Bodega**: un depósito de 44 × 32 m con tres caminos entre los dos spawns. Mid es una casita con
cuatro puertas para pelear de cerca; a la izquierda, un pasillo largo con cajones, para rifles; a
la derecha, tabiques en zigzag y una plataforma baja a la que se sube caminando.

Está en `packages/shared/src/map/bodega.ts` como una lista de cajas alineadas a los ejes, con
funciones `box()` y `crate()`. Se dibuja la mitad de los T y se gira 180° para los CT: nadie tiene
ventaja de mapa, sólo de lado, y el lado se cambia a la mitad. Agregar un mapa es agregar otro
archivo así y ponerlo en `MAPS`.

Las texturas son de prototipo (color plano con grilla de 1 m y 25 cm, bisel en cada baldosa, un
poco de ruido y manchas), generadas con canvas en `render/textures.ts`. Un tile es un metro: la
geometría escala los UV por el tamaño de cada cara y los desplaza por su posición, así la grilla
sigue de una pared a la vecina.

## Cómo se siente fluido

Un shooter en el que el cliente sólo dibuja lo que manda el servidor se siente pesado. Acá:

1. **Predicción** (`net/prediction.ts`): tu input se aplica localmente al instante, con las mismas
   funciones que corre el servidor (`stepPlayerMovement`, `stepWeaponState`).
2. **Reconciliación**: cada snapshot trae el último `seq` que el servidor procesó. El cliente vuelve
   al estado autoritativo (posición, velocidad, munición, cadencia, retroceso) y re-aplica los
   inputs pendientes. Si coincidían, no se ve nada; si no, la diferencia se absorbe en ~80 ms.
3. **Interpolación** (`net/interpolation.ts`): los demás se dibujan 100 ms en el pasado,
   interpolando entre snapshots, así se mueven suave aunque lleguen a 20 Hz.
4. **La cámara entre dos pasos**: la simulación avanza 20 veces por segundo y la pantalla 60 o
   más; la cámara se dibuja interpolada entre el paso anterior y el actual. Mirar con el mouse no
   espera a nada: el yaw y el pitch son de la cámara y viajan con cada input.
5. **Disparos predichos**: tu tiro, el fogonazo, el trazador y el agujero en la pared salen en el
   mismo input en que apretás. El servidor decide el daño y manda el evento `shot` con dónde
   terminó cada perdigón; el tuyo se empareja por `seq`.
6. **Compensación de lag**: cada input dice qué tick del servidor tenías en pantalla (`vt`). El
   servidor guarda dónde estuvo cada uno en los últimos 16 ticks (`trail`) y prueba tu tiro contra
   los demás tal como los veías, rebobinando hasta 400 ms. Lo que ves es lo que pasa.

Para probarlo sin desplegar nada, agregá `?lag=200` a la URL: simula 200 ms de ida y vuelta.

### La cola de inputs del servidor

El servidor procesa cada input exactamente una vez y en orden (`InputQueue`), igual que la
predicción. Si no llegó nada, el jugador espera (el WebSocket no pierde paquetes, sólo los atrasa).
Si se juntaron varios, procesa uno extra, pero sólo recuperando ticks en que no llegó nada: un
cliente modificado que mandara inputs al doble de ritmo no camina al doble de velocidad.

### Lo que el servidor no manda

Cada jugador recibe un snapshot distinto con **sólo los rivales que puede ver**: siete rayos de
sus ojos a la cabeza, el pecho, los pies y los costados del otro, contra las cajas del mapa, con
seis ticks de gracia para que no parpadee al pasar detrás de una columna. Un wallhack no tiene con
qué trabajar. Los tiros de los que no ves llegan sin dónde terminaron y con la posición redondeada
a 4 m: se oyen apagados, "por allá". Los pasos de los rivales que corren cerca y no ves, igual.
Caminar con `Shift` no hace ruido.

Muerto con un compañero vivo, ves lo que ve él (si no, le podrías contar por dónde vienen).

## Estructura

```
packages/shared/     simulación, mapa y protocolo (TS puro, sin dependencias)
  src/constants.ts     todos los números del juego
  src/weapons.ts       la tabla de armas y lo que se compra
  src/map/             el mapa como cajas, y rayos contra cajas
  src/sim/movement.ts  moverse: fricción, salto, agacharse, escalones, colisiones
  src/sim/combat.ts    el arma, la dispersión, el retroceso, el tiro y el daño
  src/sim/inventory.ts comprar, tirar y levantar
  src/sim/rounds.ts    rondas, economía, cambio de lado, fin del partido
  src/sim/step.ts      el tick autoritativo
  src/protocol/        mensajes y códec
apps/server/         Worker + Durable Object
  src/GameRoom.ts      sala, lobby, loop de 20 Hz, visibilidad, snapshots
apps/client/         juego
  src/game.ts          mensajes, cuadros, cámara, HUD, espectador
  src/input.ts         teclado, mouse y pointer lock
  src/net/             conexión, predicción/reconciliación, interpolación
  src/render/          Three.js: mundo y texturas, muñecos, el arma en la mano, efectos
  src/ui.ts            menú, sala, HUD, compra, tabla, resultado
  src/audio.ts         sonido generado por código
scripts/
  bot.mjs              clientes headless que juegan
  smoke-build.mjs      compila y comprueba que el bundle arranque
```

## Tests

```bash
npm test             # vitest: movimiento, armas, retroceso, rondas, códec
npm run typecheck
npm run smoke        # compila el cliente y abre el bundle en Chromium (hace falta playwright)
node scripts/bot.mjs --bots 2 --seconds 60   # contra el servidor local: 2 bots juegan rondas
```

Los tests de la simulación corren la misma función que corre el servidor, sin red: un duelo se
arma con dos jugadores y `resolveShot`. El de compensación de lag mueve al rival 3 m y comprueba
que el tiro le pegue donde estaba. El script de bots mide el ritmo real del tick (tiene que dar 20)
y el tamaño del snapshot (unos 300 bytes).

## Desplegar

### Servidor (Cloudflare)

```bash
npm run deploy:server
```

Anotá la URL que devuelve (`https://wabcs-server.<tu-cuenta>.workers.dev`). En
`apps/server/wrangler.jsonc`:

- `ALLOWED_ORIGINS`: tu dominio de Vercel. Si servís el juego desde un dominio propio, tiene que
  estar acá: el síntoma de que falta es "¿el servidor está andando?" con el servidor perfecto,
  porque el navegador no deja leer el 403 de un WebSocket rechazado.
- `DO_LOCATION_HINT`: región donde se crean las salas (`sam` para Sudamérica).

Durable Objects necesita el plan pago de Workers (5 USD/mes). Los mensajes entrantes por WebSocket
cuentan 20 a 1 y los salientes son gratis: con input a 20 Hz y 4 jugadores son 4 requests por
segundo, unas 70 horas de partidas por mes dentro del millón incluido.

### Cliente (Vercel)

Importá el repo y agregá la variable de entorno:

```
VITE_SERVER_URL = wabcs-server.<tu-cuenta>.workers.dev
```

Sin `https://` ni `wss://`. Vite la hornea en el bundle al compilar: si la cambiás, hay que volver
a desplegar. Hay dos `vercel.json` (raíz y `apps/client/`) para que ande con el Root Directory en
cualquiera de los dos.

### Si cambiás el protocolo

Desplegá primero el servidor y después el cliente. Si un cambio no se puede hacer compatible,
subí `PROTOCOL_VERSION` en `constants.ts`: el cliente la manda al conectarse y el servidor
rechaza las que no coinciden con "Hay una versión nueva del juego: recargá la página".

## Lo que falta

Está en [IDEAS.md](IDEAS.md): bots de verdad en el servidor, granadas, modo bomba, más mapas, teléfono.
