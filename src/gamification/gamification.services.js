import { withServiceError } from '../lib/withServiceError.js';
import { dbConnection } from '../../database/connection.js';
import { urlOfReading } from '../uploads/uploads.services.js';
import {
    lockUserStats,
    hasEarnedXpFor,
    insertActivityEvent,
    applyActivityToStats,
    addSeasonXp,
    claimOpenCohort,
    insertCohort,
    insertSeasonMember,
    incrementCohortCount,
    findUserStats,
    findUserCounters,
    getActivityDays,
    getActivityBounds,
    findSeasonMembership,
    listCohort,
    getCohortStanding,
    getGlobalStanding,
    listGlobalRanking,
} from './gamification.queries.js';

/**
 * Tabla de politica del juego, en el mismo espiritu que UPLOAD_SCOPES en uploads: el
 * balance se ajusta aqui y en ningun otro sitio.
 *
 * Solo dan XP las TERMINACIONES. Crear contenido pinta cuadrito en el heatmap y mantiene
 * la racha, pero paga 0. Eso es lo que permite no tener ningun tope diario de XP: un tope
 * castiga al usuario nuevo que quiere ponerse al dia en un fin de semana, y aqui la unica
 * forma de ganar es terminar cosas, que ya esta deduplicada por subject_id.
 */
export const XP_RULES = {
    LESSON_COMPLETED: { xp: 10 },
    QUIZ_COMPLETED:   { xp: (score) => 20 + Math.round((score ?? 0) * 0.3) },
    ROUTE_COMPLETED:  { xp: 100 },

    ROUTE_CREATED:    { xp: 0 },
    LESSON_CREATED:   { xp: 0 },
    QUIZ_CREATED:     { xp: 0 },
    ROUTE_PUBLISHED:  { xp: 0 },
    ROUTE_RATED:      { xp: 0 },
};

/**
 * La liga sale del XP total de por vida, y el multiplicador BAJA al subir: cada liga cuesta
 * mas que la anterior sin necesidad de ningun tope artificial.
 * El suelo es 0.40 y no menos porque por debajo de eso el jugador de Diamante siente que ya
 * no avanza y deja de jugar, que es el fallo opuesto al que se quiere evitar.
 */
export const LEAGUES = [
    { level: 0, name: 'BRONCE',    label: 'Bronce',    minXp: 0,     multiplier: 1.00 },
    { level: 1, name: 'PLATA',     label: 'Plata',     minXp: 1000,  multiplier: 0.90 },
    { level: 2, name: 'ORO',       label: 'Oro',       minXp: 3000,  multiplier: 0.80 },
    { level: 3, name: 'ZAFIRO',    label: 'Zafiro',    minXp: 7500,  multiplier: 0.70 },
    { level: 4, name: 'RUBI',      label: 'Rubi',      minXp: 15000, multiplier: 0.60 },
    { level: 5, name: 'ESMERALDA', label: 'Esmeralda', minXp: 30000, multiplier: 0.50 },
    { level: 6, name: 'DIAMANTE',  label: 'Diamante',  minXp: 60000, multiplier: 0.40 },
];

/** Tamaño maximo de una cohorte. El mismo numero esta en el indice parcial de la migracion. */
export const COHORT_SIZE = 30;

/** A partir de aqui un intento cuenta como aprobado para dar la ruta por terminada. */
export const QUIZ_PASS_SCORE = 60;

export const leagueOf = (xp) =>
    LEAGUES.reduce((current, league) => (xp >= league.minXp ? league : current), LEAGUES[0]);

export const formatLeague = (xp) => {
    const league = leagueOf(xp);
    const next = LEAGUES[league.level + 1] ?? null;

    return {
        level: league.level,
        name: league.name,
        label: league.label,
        multiplier: league.multiplier,
        nextLabel: next?.label ?? null,
        nextXp: next?.minXp ?? null,
        xpToNext: next ? next.minXp - xp : null,
    };
};

/**
 * Cuanto paga este evento. Devuelve 0 -- que significa "cuenta para el heatmap y la racha,
 * pero no para el ranking" -- en tres casos:
 *   - el evento no puntua (crear, publicar, puntuar);
 *   - el usuario ya cobro por ese mismo sujeto (rehacer una leccion no paga dos veces);
 *   - el contenido es suyo, para que el autor de una ruta de 50 lecciones no pueda
 *     autopagarse recorriendola con las respuestas en la mano.
 */
const resolveXp = async (client, { userId, eventType, subjectId, ownerId, score, totalXp }) => {
    const rule = XP_RULES[eventType];
    if (!rule) throw { code: 'UNKNOWN_ACTIVITY_EVENT', message: `Evento de actividad desconocido: ${eventType}` };

    const base = typeof rule.xp === 'function' ? rule.xp(score) : rule.xp;
    if (base <= 0) return 0;

    if (ownerId && ownerId === userId) return 0;
    if (await hasEarnedXpFor(client, { userId, eventType, subjectId })) return 0;

    // Nunca menos de 1: un evento que puntua siempre tiene que notarse.
    return Math.max(1, Math.round(base * leagueOf(totalXp).multiplier));
};

/**
 * Mete al usuario en su cohorte del mes la primera vez que puntua, sin cron ni job mensual:
 * la asignacion es perezosa y ocurre dentro de esta misma transaccion, asi que es correcta
 * aunque corran varias instancias del server y no hay ninguna tarea que pueda no ejecutarse.
 */
const addToSeason = async (client, { season, userId, xp, league }) => {
    if (await addSeasonXp(client, { season, userId, xp })) return;

    const cohort = await claimOpenCohort(client, { season, league, size: COHORT_SIZE })
        ?? await insertCohort(client, { season, league });

    const member = await insertSeasonMember(client, { season, userId, cohortId: cohort.id, league, xp });

    // Solo se cuenta el alta real: si la fila ya existia, el cupo de la cohorte no cambia.
    if (member.inserted) await incrementCohortCount(client, cohort.id);
};

/**
 * Punto de entrada unico de la gamificacion. Recibe el `client` de la transaccion del que
 * llama para que el XP sea atomico con la accion que lo genera -- es una excepcion
 * deliberada a la convencion de que solo la capa de queries recibe client.
 *
 * Tiene que ser la ULTIMA sentencia de la transaccion: asi todos los caminos toman los
 * locks en el mismo orden (routes antes que user_stats) y el camino del creador no puede
 * hacer deadlock con el del alumno.
 *
 * No va envuelto en withServiceError a proposito: ese helper reenvia cualquier error con
 * .code, asi que la transaccion aborta igual, pero el cliente veria "error al registrar la
 * actividad" cuando lo que fallo de verdad fue crear la ruta.
 */
export const recordActivity = async (client, { userId, eventType, subjectId, ownerId = null, score = null }) => {
    const stats = await lockUserStats(client, userId);

    const xp = await resolveXp(client, {
        userId, eventType, subjectId, ownerId, score, totalXp: stats.xp,
    });

    await insertActivityEvent(client, {
        userId, eventType, subjectId, xp, activityDate: stats.today,
    });

    const updated = await applyActivityToStats(client, { userId, xp, day: stats.today });

    if (xp > 0) {
        await addToSeason(client, {
            season: stats.season,
            userId,
            xp,
            league: leagueOf(stats.xp).level,
        });
    }

    return {
        xpEarned: xp,
        xp: updated.xp,
        currentStreak: updated.current_streak,
        longestStreak: updated.longest_streak,
        league: formatLeague(updated.xp),
    };
};


// ============================================================
//  LECTURAS
// ============================================================

const formatStats = async (row, counters) => ({
    user: { id: row.id, name: row.name, image: await urlOfReading(row.image), verified: row.is_verified },
    xp: row.xp,
    league: formatLeague(row.xp),
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    lastActivityDate: row.last_activity_date,
    counters: {
        lessonsCompleted: counters.lessons_completed,
        quizzesCompleted: counters.quizzes_completed,
        routesCreated: counters.routes_created,
        routesEnrolled: counters.routes_enrolled,
        routesCompleted: counters.routes_completed,
    },
});

export const getUserStats = withServiceError(async (userId) => {
    const row = await findUserStats(dbConnection, userId);
    if (!row) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    return formatStats(row, await findUserCounters(dbConnection, userId));
}, { code: 'ERROR_GETTING_STATS', message: 'Hubo un error al intentar obtener las estadisticas' });

/**
 * Los cuatro tonos del cuadrito, por cuartiles de los dias CON actividad del propio usuario
 * y no contra una constante global. Asi el verde oscuro significa "un dia fuerte para ti",
 * que es lo que hace GitHub: con un umbral fijo, quien va tranquilo ve el año entero en el
 * tono mas claro y el widget deja de decirle nada.
 */
const levelScale = (days) => {
    const counts = days.filter((day) => day.count > 0).map((day) => day.count).sort((a, b) => a - b);
    if (counts.length === 0) return () => 0;

    const at = (quantile) => counts[Math.min(counts.length - 1, Math.floor(counts.length * quantile))];
    const [first, second, third] = [at(0.25), at(0.5), at(0.75)];

    return (count) => {
        if (count <= 0) return 0;
        if (count <= first) return 1;
        if (count <= second) return 2;
        if (count <= third) return 3;
        return 4;
    };
};

const eachDay = function* (from, to) {
    const cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);

    while (cursor <= end) {
        yield cursor.toISOString().slice(0, 10);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
};

export const getUserActivity = withServiceError(async (userId, { from, to }) => {
    const rows = await getActivityDays(dbConnection, { userId, from, to });

    // Si no hubo ni un evento, la consulta agregada no devuelve limites: se piden aparte.
    const bounds = rows[0] ?? await getActivityBounds(dbConnection, { userId, from, to });
    if (!bounds) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    const byDate = new Map(rows.map((row) => [row.date, row]));
    const level = levelScale(rows);

    // El calendario se rellena entero, tambien los dias vacios: el front pinta una rejilla,
    // no una lista, y no deberia tener que inventarse los huecos.
    const days = [...eachDay(bounds.from_day, bounds.to_day)].map((date) => {
        const row = byDate.get(date);
        const count = row?.count ?? 0;

        return { date, count, xp: row?.xp ?? 0, level: level(count) };
    });

    return {
        from: bounds.from_day,
        to: bounds.to_day,
        days,
        totals: {
            events: rows.reduce((sum, row) => sum + row.count, 0),
            xp: rows.reduce((sum, row) => sum + row.xp, 0),
            activeDays: rows.length,
        },
    };
}, { code: 'ERROR_GETTING_ACTIVITY', message: 'Hubo un error al intentar obtener la actividad' });


// ============================================================
//  RANKING
// ============================================================

/** La temporada corre en UTC: una competicion tiene que empezar y acabar a la vez para todos. */
export const currentSeason = () => new Date().toISOString().slice(0, 7);

const percentBeaten = ({ beaten, total }) =>
    (total > 1 ? Math.round((beaten / (total - 1)) * 1000) / 10 : 100);

const formatRankUser = async (row) => ({
    id: row.user_id,
    name: row.name,
    image: await urlOfReading(row.image),
    verified: row.is_verified,
});

/**
 * El ranking global va con el XP DE POR VIDA: es el mismo numero que decide la liga, asi que
 * formatLeague(row.xp) es correcto aqui.
 */
const formatGlobalRow = async (row) => ({
    position: row.position,
    user: await formatRankUser(row),
    xp: row.xp,
    ...(row.current_streak !== undefined ? { currentStreak: row.current_streak } : {}),
    league: formatLeague(row.xp),
});

/**
 * La cohorte va con el XP DE LA TEMPORADA, que arranca en cero cada mes. Se emite como
 * `seasonXp` y no como `xp` para que no se pueda confundir con el acumulado: son dos
 * magnitudes distintas y mezclarlas dejaria el ranking mensual congelado.
 *
 * Y la liga sale de ranking_members.league, la que se congelo al entrar en la temporada, NO de
 * formatLeague(seasonXp): con el XP del mes, el dia 1 todo el mundo seria Bronce.
 */
const formatCohortRow = async (row) => {
    const league = LEAGUES[row.league] ?? LEAGUES[0];

    return {
        position: row.position,
        user: await formatRankUser(row),
        seasonXp: row.xp,
        league: { level: league.level, name: league.name, label: league.label },
    };
};

/** La cohorte del usuario en una temporada: contra quienes compite este mes. */
export const getSeasonRanking = withServiceError(async (userId, season) => {
    const membership = await findSeasonMembership(dbConnection, { season, userId });

    // Todavia no gano XP este mes: no esta en ninguna cohorte, y eso no es un error.
    if (!membership) {
        return { season, joined: false, league: null, cohortSize: 0, members: [] };
    }

    const rows = await listCohort(dbConnection, membership.cohort_id);

    return {
        season,
        joined: true,
        league: LEAGUES[membership.league] ?? LEAGUES[0],
        cohortSize: rows.length,
        members: await Promise.all(rows.map(formatCohortRow)),
    };
}, { code: 'ERROR_GETTING_RANKING', message: 'Hubo un error al intentar obtener el ranking' });

/**
 * Lo que pinta la pantalla de ranking: posicion, XP y porcentaje de gente superada, tanto
 * dentro de la cohorte del mes como en la tabla historica.
 */
export const getMyStanding = withServiceError(async (userId, season) => {
    const stats = await findUserStats(dbConnection, userId);
    if (!stats) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    const [membership, global] = await Promise.all([
        findSeasonMembership(dbConnection, { season, userId }),
        getGlobalStanding(dbConnection, stats.xp),
    ]);

    const cohort = membership
        ? await getCohortStanding(dbConnection, { cohortId: membership.cohort_id, xp: membership.xp })
        : null;

    return {
        season,
        xp: stats.xp,
        league: formatLeague(stats.xp),
        currentStreak: stats.current_streak,
        global: {
            position: global.position,
            totalRanked: global.total,
            percentBeaten: percentBeaten(global),
        },
        // joined: false = este mes todavia no ha puntuado, asi que no tiene rival asignado.
        cohort: cohort
            ? {
                joined: true,
                seasonXp: membership.xp,
                position: cohort.position,
                cohortSize: cohort.total,
                percentBeaten: percentBeaten(cohort),
            }
            : { joined: false, seasonXp: 0, position: null, cohortSize: 0, percentBeaten: 0 },
    };
}, { code: 'ERROR_GETTING_STANDING', message: 'Hubo un error al intentar obtener la posicion' });

export const getGlobalRanking = withServiceError(async ({ take, skip }) => {
    const rows = await listGlobalRanking(dbConnection, { take, skip });

    return Promise.all(rows.map(formatGlobalRow));
}, { code: 'ERROR_GETTING_RANKING', message: 'Hubo un error al intentar obtener el ranking' });
