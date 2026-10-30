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

Para jugar solo, **Practicar con bots** en el menú arma una sala propia con tres bots (2v2) que
arranca sola. En cualquier sala, el host puede **agregar bots** desde el lobby y elegirles la
dificultad.

### Bots

Viven en el servidor, dentro de la sala (`sim/bot.ts`): no se conectan desde ningún lado, así
que no cuestan mensajes de Cloudflare, y mandan inputs como cualquier jugador, sin hacer nada que
un jugador no pueda. Encuentran el camino con A* sobre una grilla de medio metro armada a partir
de las cajas del mapa (`sim/nav.ts`): cada celda tiene un nodo por nivel donde alguien parado no
choca con nada (el piso del garaje y su techo son dos nodos de la misma celda), se pasa a la celda
vecina subiendo un escalón como mucho o dejándose caer hasta 3,6 m (cuesta más, así prefieren la
escalera), y lo que no se alcanza desde los spawns se descarta (la tapa de un barril, el techo de
la casita del mid). Así suben al techo del garaje por la escalera, patrullan ahí arriba y te van a
buscar si te vieron ahí.

Compran en el tiempo de compra (rifle del equipo si les alcanza, si no subfusil o escopeta, el
chaleco si sobra, un AWP de vez en cuando), y después patrullan: los T van hacia la mitad CT, los
CT aguantan un rato en la suya y salen. Cuando ven a alguien se frenan, apuntan con un error que
va variando despacio, tardan un instante en reaccionar, tiran en ráfagas, se mueven de costado y,
sin balas, pasan a la pistola o recargan. Si les pegan o se oye un tiro cerca, saben por dónde
venir a buscarte. Ven en un cono delante de ellos: se los puede flanquear.

**Dificultad** (`BOT_SKILLS`): *Fácil* (tarda 14-24 ticks en reaccionar, tiembla mucho, no se
mueve al tirar), *Normal* (6-12 ticks) y *Difícil* (2-5 ticks, casi no tiembla, va a la cabeza
casi la mitad de las veces).

`node scripts/server-bots.mjs` prueba contra el servidor local que tres bots jueguen tres rondas
solos: compran, se encuentran y se matan.

Para probar desde afuera hay también clientes headless:

```bash
node scripts/bot.mjs --room PRB7X9 --bots 1 --seconds 900 --humano --manso
```

Entran a la sala `PRB7X9` por socket, esperan a que haya alguien de verdad y caminan hacia vos;
con `--manso` no disparan, para probar tus tiros tranquilo.

### Controles

| Tecla | Acción |
|---|---|
| `WASD` | moverse |
| Mouse | mirar (el primer click captura el puntero; `Esc` lo suelta) |
| Click izquierdo | disparar |
| Click derecho | mira del AWP (mantener) |
| `Shift` | caminar: más lento, sin ruido |
| `Ctrl` / `C` | agacharse: más lento, más preciso, más bajo |
| `Espacio` | saltar (caerse de más de ~2 m duele: del techo del garaje son ~25 de vida) |
| `Esc` | pausa (volumen, sensibilidad, salir); Esc otra vez sale de pantalla completa. Fuera de pantalla completa el navegador suelta el mouse con Esc, sí o sí: la opción "Pantalla completa al jugar" (menú o pausa, apagada de entrada) lo evita, porque ahí el navegador deja quedarse con la tecla |
| `R` | recargar |
| `1` / `2` / `3` | principal, pistola, cuchillo |
| `4` / `5` / `6` | granada HE, flash, humo (click para tirarla) |
| `Q` | la última arma que tenías |
| `F` | mirar el arma (el cuchillo da una vuelta) |
| `B` | menú de compra: `1`-`6` armas, `7`-`9` granadas, `0` chaleco, `C` casco (en el tiempo de compra y los primeros 10 s, cerca de tu spawn) |
| `E` | levantar el arma del piso que tengas adelante; sostenida, plantar o desactivar la bomba |
| `G` | tirar el arma que tenés en la mano |
| `Tab` | tabla |
| `Enter` | chat del equipo |
| Muerto: click / `Espacio` | cambiar a quién mirás; sin compañeros vivos, cámara libre con `WASD` |

## Cómo se juega

Dos equipos, **Terroristas** y **Antiterroristas**, por rondas. En **eliminación**, gana la ronda
el equipo que elimina al otro; si se acaba el tiempo (1:45), ganan los CT: son los que defienden,
así que los T tienen que ir a buscarlos. En **bomba** (ver más abajo), los T además pueden ganar
plantando la C4.

Cada ronda empieza con **6 segundos de compra**: nadie se mueve, todos compran (`B`). Después se
puede seguir comprando 10 segundos más, pero sólo a menos de 9 m del centro de tu spawn.

Gana el partido el primero en llegar a las rondas que eligió el host (5, 8 o 13). A una ronda de
la mitad se **cambia de lado**: los T pasan a CT y al revés, con el dinero y las armas de vuelta a
cero. El marcador se da vuelta con ellos.

El que entra con el partido empezado mira como espectador y juega desde la ronda siguiente, en el
equipo con menos gente.

### Modo bomba

El host lo elige en la sala. Un T al azar lleva la **C4** (se ve en el radar con un anillo): dentro
de un sitio (**A**, adentro del garaje CT; **B**, en la calle izquierda; están pintados en el piso
y en el radar) sostiene `E` 3,5 s sin moverse y la planta. Desde ahí hay **40 segundos** de mecha
con bips cada vez más seguidos, el reloj de la ronda se congela, y matar a todos los T ya no
termina la ronda: los CT tienen que **desactivarla**, sosteniendo `E` al lado durante 10 s (5 con
el **kit**, $400, sólo CT). Si estalla, mata a 16 m a la redonda atravesando paredes y ganan los
T; si la desactivan, ganan los CT. Si el portador muere, la bomba queda en el piso y cualquier T
la levanta al pasar. Plantar paga $800 aunque se pierda la ronda.

Los bots juegan el modo: los T van todos al sitio de la ronda y el que la lleva la planta; los CT
guardan un sitio, se compran el kit y, plantada, van a desactivarla (`sim/bomb.ts`, `bombGoal`
en `sim/bot.ts`).

### Sólo AWP

Rondas de eliminación, pero todos arrancan cada ronda con **AWP, cuchillo, chaleco y casco**, y no
hay tienda (el dinero no sirve para nada). Un tiro al cuerpo mata, así que es puntería y paciencia.

### Carrera de armas

No hay rondas ni compras: se **reaparece a los 3 segundos** en el lado propio, con chaleco y casco,
y cada baja te da **la siguiente arma de la escalera**: Glock, USP, Deagle, Nova, MP5, M4, AK, AWP
y, al final, **el cuchillo**. La baja con el cuchillo termina el partido y lo gana tu equipo. El
marcador de arriba muestra el nivel más alto de cada equipo; las armas de los muertos no quedan en
el piso (cada uno juega con la de su nivel). Los bots juegan igual que en eliminación, sin comprar.

### La mira

En el menú y en la pausa se elige: **dinámica** (se abre con la imprecisión real: moverse, saltar,
disparar seguido; es la que enseña cuándo no conviene tirar), **fija** (una cruz quieta) o
**punto**, y el color. Queda guardado en el navegador.

### Dinero

| | |
|---|---|
| Arranque (y después del cambio de lado) | $800 |
| Ganar la ronda | +$3250 |
| Perder la ronda | +$1400, más $500 por cada derrota seguida (hasta $3400) |
| Kill | +$300; con el AWP $100, con la MP5 $600, con la escopeta $900, con el cuchillo $1500 |
| Tope | $16 000 |

El que sobrevive **conserva** sus armas y su chaleco, y arranca la ronda con los cargadores y la
reserva llenos. El que muere arranca la ronda
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
| Granada HE | $300 | 98 | 1 | | estalla a los 1,6 s; el daño cae con la distancia y una pared lo frena |
| Flash | $200 | | 2 | | ciega al que la ve: hasta 3,6 s de frente, menos de costado y de lejos |
| Humo | $300 | | 1 | | 15 s de nube de 3 m que tapa la vista (no las balas) |

### Granadas

Con `4`, `5` y `6` se saca la HE, la flash o el humo; click para tirarla. Sale de los ojos hacia
donde mirás, un poco hacia arriba, vuela con gravedad y rebota contra todo (`sim/grenade.ts`):
contra una pared de cerca te vuelve a los pies, así que ojo. La HE lastima también al que la tira
(a los compañeros no). La flash mira el ángulo entre tu vista y la granada: de frente es el
máximo, de espaldas casi nada; además una pared la tapa. El humo es de verdad una nube para el
servidor: los rivales detrás no te llegan en el snapshot (ni vos a ellos), y los bots tampoco
ven a través.

El daño cae con la distancia (cada arma a su ritmo: la escopeta pierde la mitad cada 10 m, el AK
casi nada) y según dónde pega: **cabeza ×4**, cuerpo ×1, piernas ×0,75. El chaleco absorbe parte
del daño al cuerpo (y a la cabeza, con casco) y se va gastando; las piernas no tienen chaleco.
Las fórmulas son las de CS (`applyArmor` en `combat.ts`).

**Paredes finas** (`bulletSegments`): los rifles y la Deagle atraviesan tabiques finos (el AK hasta
40 cm, el M4 35, el AWP 60, la Deagle 32, la MP5 16; las pistolas chicas, la escopeta y el cuchillo
no) con el daño reducido a entre la mitad y el 80 % según el grosor. Una sola pared por bala, y un
cuerpo la frena. Las paredes de las casitas y los garajes son de 30 cm: se puede castigar al que se
esconde detrás, pero no matarlo de un tiro. El cliente dibuja el trazador y el agujero del otro lado
con la misma función que usa el servidor para resolver el tiro.

**Frenado** (*tagging*): un tiro recibido te deja 0,4 s a menos de la mitad de la velocidad,
recuperando de a poco. No se escapa de un duelo a toda carrera: se contesta o se busca pared.

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

## Los mapas

El host elige el mapa en la sala (se ve de fondo). Los dos son de 44 × 32 m y simétricos por un
giro de 180° alrededor del centro: se dibuja la mitad de los T y se gira para los CT, así nadie
tiene ventaja de mapa, sólo de lado, y el lado se cambia a la mitad.

**Bodega**: un depósito con tres caminos. Mid es una casita de hormigón con cuatro puertas para
pelear de cerca; a la izquierda, un garaje con puerta, ventana y techo al que se sube por una
escalera pegada al muro (el puesto de francotirador, con parapeto); a la derecha, dos contenedores
en zigzag y una plataforma baja a la que se sube caminando. Sitios: A adentro del garaje CT, B en
la calle izquierda.

**Patio**: una plaza con una fuente escalonada en el medio (se sube de a 40 cm) y dos tiendas
enfrentadas con puerta a la plaza y ventana a la calle; a la izquierda una calle larga y abierta
con sacos de arena, para francotiradores; a la derecha un túnel techado y oscuro, para escopetas
y subfusiles. Sitios: A adentro de la tienda CT, B al final de la calle larga.

Están en `packages/shared/src/map/` como listas de cajas alineadas a los ejes, con funciones
`box()`, `crate()`, `barrel()`, `pillar()` y `sandbags()`. Agregar un mapa es agregar otro archivo
así y ponerlo en `MAPS`; `maps.test.ts` le exige lo mismo que a los demás: simetría, spawns
libres, sitios del lado CT, que se llegue caminando y con la grilla de los bots a todos lados, y
que nada flote.

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
  src/sim/grenade.ts   las granadas: física, HE, flash y humo
  src/sim/bomb.ts      la C4: plantar, desactivar, la mecha y la explosión
  src/sim/rounds.ts    rondas, economía, cambio de lado, fin del partido
  src/sim/step.ts      el tick autoritativo
  src/sim/nav.ts       la grilla de caminos y el A* de los bots
  src/sim/bot.ts       el cerebro de los bots
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
  bot.mjs              clientes headless que juegan desde afuera
  server-bots.mjs      prueba que los bots del servidor jueguen solos
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

Está en [IDEAS.md](IDEAS.md): más mapas, un editor de mapas, teléfono.
