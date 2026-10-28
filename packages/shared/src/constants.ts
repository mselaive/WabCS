/**
 * Todo lo que ajusta el juego, en un solo lugar. Unidades: metros, segundos,
 * radianes. Eje Y hacia arriba (como Three.js). El tick es de 50 ms.
 */

// ------------------------------------------------------------ tiempo y red

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;
export const MS_PER_TICK = 1000 / TICK_RATE;

/** Los demás se dibujan este tiempo en el pasado, interpolando entre snapshots. */
export const INTERP_DELAY_MS = 100;

/**
 * Hasta cuántos ticks se rebobina a los demás para decidir un tiro (ver la
 * compensación de lag). 8 ticks = 400 ms: alcanza para pings de unos 200 ms, y
 * mentir sobre lo que veías no da más que esto.
 */
export const LAG_COMP_MAX_TICKS = 8;
/** Cuántas posiciones pasadas se recuerdan de cada jugador. */
export const TRAIL_LENGTH = 16;

/** Sube cuando el cliente y el servidor dejan de entenderse (ver el README). */
export const PROTOCOL_VERSION = 1;

export const MIN_PLAYERS = 2;
/** Pensado para 1v1 y 2v2; hasta 5v5 entra sin cambiar nada. */
export const MAX_PLAYERS = 10;
export const MAX_NAME_LENGTH = 14;
export const ROOM_CODE_LENGTH = 6;

/** Inputs que se guardan por jugador en el servidor antes de tirar los viejos. */
export const MAX_INPUT_BUFFER = 8;
/** Cuánto se le guarda el lugar a alguien que se desconectó en partida. */
export const RECONNECT_GRACE_MS = 15_000;
/** Sala sin humanos durante esto: se apaga el loop. */
export const EMPTY_ROOM_SHUTDOWN_TICKS = 30 * TICK_RATE;

/** Cuenta regresiva en el lobby antes de la primera ronda. */
export const COUNTDOWN_TICKS = 3 * TICK_RATE;
/** Cuánto se muestra el resultado antes de volver al lobby. */
export const ENDED_TICKS = 12 * TICK_RATE;

// ------------------------------------------------------------ jugador

/** Caja de colisión: 0,6 m de ancho, 1,8 m de alto. */
export const PLAYER_HALF_W = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.25;
/** Altura de los ojos, de pie y agachado. */
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.07;
/** El tramo de arriba de la caja que cuenta como cabeza, y el de abajo como piernas. */
export const HEAD_HEIGHT = 0.3;
export const LEG_HEIGHT = 0.8;

export const MAX_HP = 100;
export const MAX_ARMOR = 100;

export const GRAVITY = 20;
/** Con 20 de gravedad, 7,3 m/s de salto llegan a 1,33 m: lo justo para subirse a un cajón de 1,2. */
export const JUMP_SPEED = 7.3;
/** Caminar (Shift) y agacharse frenan: y caminar no hace ruido. */
export const WALK_FACTOR = 0.52;
/** Un tiro recibido frena: estos ticks a esta fracción de la velocidad, recuperando de a poco. */
export const TAG_TICKS = 8;
export const TAG_FACTOR = 0.45;
export const CROUCH_FACTOR = 0.34;
/** Qué tan rápido se alcanza la velocidad máxima en el piso (1/s) y cuánto frena soltar. */
export const GROUND_ACCEL = 14;
export const GROUND_FRICTION = 10;
/** En el aire casi no se corrige: el salto es una decisión. */
export const AIR_ACCEL = 1.2;
/** Hasta esta altura se sube caminando (cajones bajos, escalones). */
export const STEP_HEIGHT = 0.45;
/** Ticks que tarda pasar de pie a agachado y al revés (se interpola la altura). */
export const CROUCH_TICKS = 4;

// ------------------------------------------------------------ rondas y economía

/** Tiempo de compra al empezar la ronda: nadie se mueve. */
export const FREEZE_TICKS = 6 * TICK_RATE;
/** Duración de la ronda. Si se acaba, ganan los CT (defienden, como en CS sin bomba). */
export const ROUND_TICKS = 105 * TICK_RATE;
/** Después de decidirse la ronda, cuánto se sigue jugando antes de la siguiente. */
export const ROUND_OVER_TICKS = 5 * TICK_RATE;
/** Después del freeze, se puede seguir comprando este tiempo (cerca del spawn). */
export const BUY_TICKS = 10 * TICK_RATE;
/** A menos de esto del centro del spawn propio se puede comprar. */
export const BUY_RADIUS = 9;

export const START_MONEY = 800;
export const MAX_MONEY = 16_000;
export const KILL_REWARD = 300;
export const KNIFE_KILL_REWARD = 1500;
/** Caerse duele: por encima de esta velocidad de impacto (m/s), tantos HP por cada m/s de más. */
export const FALL_SAFE_SPEED = 9;
export const FALL_DAMAGE_PER_MS = 10;
export const WIN_REWARD = 3250;
/** Perder paga LOSS_BASE más LOSS_STEP por cada derrota seguida (hasta LOSS_MAX_STREAK). */
export const LOSS_BASE = 1400;
export const LOSS_STEP = 500;
export const LOSS_MAX_STREAK = 4;

/** Rondas que hay que ganar: lo elige el host. Se cambia de lado a la mitad. */
export const WIN_ROUNDS_OPTIONS = [5, 8, 13] as const;
export const DEFAULT_WIN_ROUNDS = 8;

// ------------------------------------------------------------ granadas

/** Mecha de la HE y la flash desde que salen de la mano. */
export const GRENADE_FUSE_TICKS = 32;
/** El humo tarda esto en estallar y después dura SMOKE_TICKS. */
export const SMOKE_FUSE_TICKS = 30;
export const SMOKE_TICKS = 15 * TICK_RATE;
/** Radio de la nube de humo. */
export const SMOKE_RADIUS = 3;
/** Con qué velocidad sale una granada de la mano (m/s), y cuánto rebota (0 a 1). */
export const GRENADE_THROW_SPEED = 17;
export const GRENADE_BOUNCE = 0.45;
export const GRENADE_RADIUS = 0.08;
/** La HE: daño en el centro y hasta dónde llega (cae lineal, y una pared la frena). */
export const HE_DAMAGE = 98;
export const HE_RADIUS = 7;
/** La flash: hasta dónde ciega, y cuánto (ticks) de frente, de costado y de espaldas. */
export const FLASH_RANGE = 28;
export const FLASH_FULL_TICKS = 3.6 * TICK_RATE;
export const FLASH_SIDE_TICKS = 1.6 * TICK_RATE;
export const FLASH_BACK_TICKS = 0.5 * TICK_RATE;
/** Cuántas se pueden llevar de cada una: [HE, flash, humo]. */
export const GRENADE_MAX = [1, 2, 1] as const;

// ------------------------------------------------------------ la bomba

/** Modos de juego: eliminación (gana el que elimina al otro) o bomba. */
export const MODE_ELIM = 0;
export const MODE_BOMB = 1;
/** Plantar: sostener E dentro del sitio. Desactivar: sostener E al lado de la bomba. */
export const BOMB_PLANT_TICKS = Math.round(3.5 * TICK_RATE);
export const BOMB_DEFUSE_TICKS = 10 * TICK_RATE;
export const BOMB_DEFUSE_KIT_TICKS = 5 * TICK_RATE;
/** Desde que se planta hasta que estalla. */
export const BOMB_TIMER_TICKS = 40 * TICK_RATE;
/** A menos de esto de la bomba se la puede desactivar (y se la levanta si está tirada). */
export const BOMB_USE_RANGE = 1.3;
export const BOMB_PICKUP_RANGE = 1.0;
/** La explosión: daño en el centro y hasta dónde llega (atraviesa paredes, como en CS). */
export const BOMB_DAMAGE = 320;
export const BOMB_RADIUS = 16;
export const DEFUSE_KIT_PRICE = 400;

/** Hasta dónde se recoge un arma del piso. */
export const PICKUP_RANGE = 1.8;
/** Cuánto vive un arma tirada (ticks). Al terminar la ronda se limpian todas. */
export const DROP_TICKS = ROUND_TICKS;

// ------------------------------------------------------------ input

/** Bits de `btn` en el input. */
export const BTN_SHOOT = 1;
export const BTN_RELOAD = 2;
export const BTN_JUMP = 4;
export const BTN_CROUCH = 8;
export const BTN_WALK = 16;
export const BTN_SCOPE = 32;
/** E sostenida: plantar o desactivar la bomba. */
export const BTN_USE = 64;

/** Acciones puntuales (`act`): una por input, en el tick en que se aprieta. */
export const ACT_NONE = 0;
export const ACT_SLOT_0 = 1;
export const ACT_SLOT_1 = 2;
export const ACT_SLOT_2 = 3;
export const ACT_PICKUP = 4;
export const ACT_DROP = 5;
/** ACT_GRENADE_BASE + tipo (0 HE, 1 flash, 2 humo): sacar esa granada. */
export const ACT_GRENADE_BASE = 6;
/** ACT_BUY_BASE + índice en BUY_ITEMS. */
export const ACT_BUY_BASE = 16;

/** Equipos. */
export const TEAM_T = 0;
export const TEAM_CT = 1;
export const TEAM_NAMES = ["Terroristas", "Antiterroristas"] as const;
export const TEAM_SHORT = ["T", "CT"] as const;

/** Zonas de impacto. */
export const ZONE_HEAD = 0;
export const ZONE_BODY = 1;
export const ZONE_LEGS = 2;
export const ZONE_MULT = [4, 1, 0.75] as const;

/** Vista normal y con la mira del francotirador (grados verticales). */
export const FOV = 75;
export const FOV_SCOPED = 20;
