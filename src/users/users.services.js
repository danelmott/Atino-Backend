import { withServiceError } from '../lib/withServiceError.js';
import { dbConnection, withTransaction } from '../../database/connection.js';
import { ensureUniqueUsername } from '../lib/username.js';
import { urlOfReading } from '../uploads/uploads.services.js';
import { getUserStats } from '../gamification/gamification.services.js';
import {
    findUserProfile,
    findPublicProfile,
    findPublicProfileByUsername,
    findUserIdByUsername,
    searchUsers as searchUsersQuery,
    probeTimezone,
    updateUserTimezone,
    updateUserName,
    updateUserVerified,
    getUserTopicPreferences,
    countExistingTopics,
    replaceUserTopicPreferences,
    markOnboardingCompleted,
} from './users.queries.js';

/** Minimo y maximo de subjects que puede elegir el usuario. El schema deriva de aqui. */
export const TOPIC_SELECTION = { min: 1, max: 5 };

const formatTopic = (row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
});

const formatProfile = async (row) => ({
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    // Puede ser null entre el registro y el onboarding: el handle se deriva del nombre y hasta
    // entonces no hay ninguno. Ver src/lib/username.js.
    username: row.username,
    image: await urlOfReading(row.image),
    role: row.role,
    timezone: row.timezone,
    // La insignia editorial. Nada que ver con emailVerified, que es la confirmacion del
    // correo y la que decide si se puede iniciar sesion.
    verified: row.is_verified,
    // La fecha ademas de la bandera: el front solo necesita el booleano, pero tenerla
    // permite responder "cuanta gente termina el onboarding" sin otra migracion.
    onboardingCompleted: row.onboarding_completed_at !== null,
    onboardingCompletedAt: row.onboarding_completed_at,
    followersCount: row.followers_count,
    followingCount: row.following_count,
    createdAt: row.created_at,
});

/**
 * El perfil publico es un formatter aparte y NO formatProfile con campos borrados: la lista
 * de lo que se expone tiene que leerse de un vistazo, porque añadir una columna sensible a
 * findUserProfile no puede filtrarla aqui por descuido.
 */
const formatPublicProfile = async (row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    image: await urlOfReading(row.image),
    verified: row.is_verified,
    followersCount: row.followers_count,
    followingCount: row.following_count,
    isFollowing: row.is_following,
    followsYou: row.follows_you,
    createdAt: row.created_at,
});

/**
 * El perfil trae la gamificacion pegada porque es lo que pinta la cabecera de la app: quien
 * eres, en que liga vas y cuantos dias llevas de racha, en una sola llamada.
 */
export const getMyProfile = withServiceError(async (user) => {
    const row = await findUserProfile(dbConnection, user.userId);
    if (!row) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    const [profile, stats, topics] = await Promise.all([
        formatProfile(row),
        getUserStats(user.userId),
        getUserTopicPreferences(dbConnection, user.userId),
    ]);

    return {
        ...profile,
        topics: topics.map(formatTopic),
        xp: stats.xp,
        league: stats.league,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
    };
}, { code: 'ERROR_GETTING_PROFILE', message: 'Hubo un error al intentar obtener el perfil' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El identificador de la URL puede venir de dos formas, porque el front enruta los perfiles por
 * handle (/profile/danel-mantilla) mientras que el resto de la API los referencia por uuid.
 *
 * La forma se comprueba aqui y no con validate() en el router a proposito: un identificador que
 * no existe es un 404 -- que es lo que dispara el notFound() del cliente -- y no el 400 de zod,
 * con el que la pantalla se quedaria atascada en un error.
 */
export const resolveUserId = withServiceError(async (identifier) => {
    if (UUID.test(identifier)) return identifier;

    const id = await findUserIdByUsername(dbConnection, identifier);
    if (!id) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    return id;
}, { code: 'ERROR_GETTING_PROFILE', message: 'Hubo un error al intentar obtener el perfil' });

/**
 * El perfil de otro usuario. Lleva la gamificacion pegada por el mismo motivo que el propio
 * -- liga y racha son parte de la ficha -- pero nunca los datos de cuenta.
 *
 * Las dos ramas resuelven el perfil en UNA consulta cada una en vez de traducir el handle a
 * uuid y volver a preguntar: son el mismo SELECT cambiando la columna del WHERE.
 */
export const getPublicProfile = withServiceError(async (user, identifier) => {
    const row = UUID.test(identifier)
        ? await findPublicProfile(dbConnection, { userId: identifier, viewerId: user.userId })
        : await findPublicProfileByUsername(dbConnection, { username: identifier, viewerId: user.userId });

    if (!row) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    const [profile, stats] = await Promise.all([
        formatPublicProfile(row),
        // Con el id de la fila, no con el identificador de la URL: puede ser un handle.
        getUserStats(row.id),
    ]);

    return {
        ...profile,
        xp: stats.xp,
        league: stats.league,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
    };
}, { code: 'ERROR_GETTING_PROFILE', message: 'Hubo un error al intentar obtener el perfil' });

/**
 * La ficha de persona que devuelve /search. Es la de follows mas routesCount, que es lo que el
 * bloque de "resultado principal" escribe debajo del nombre.
 *
 * followersCount y routesCount salen siempre como numero: el cliente los pinta con
 * toLocaleString() sin comprobar antes, y un null ahi revienta la pantalla entera.
 */
const formatSearchUser = async (row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    image: await urlOfReading(row.image),
    verified: row.is_verified,
    followersCount: row.followers_count ?? 0,
    isFollowing: row.is_following,
    routesCount: row.routes_count ?? 0,
});

export const searchPeople = withServiceError(async (viewerId, { words, term, termLike, take, skip }) => {
    const rows = await searchUsersQuery(dbConnection, { words, term, termLike, viewerId, take, skip });

    return Promise.all(rows.map(formatSearchUser));
}, { code: 'ERROR_SEARCHING_USERS', message: 'Hubo un error al intentar buscar personas' });

/**
 * La insignia la concede un ADMIN, nunca el propio usuario: el router lo garantiza con
 * requireRole('ADMIN'), asi que aqui no se vuelve a comprobar el rol.
 */
export const setUserVerified = withServiceError(async (userId, verified) => {
    const updated = await updateUserVerified(dbConnection, { userId, verified });
    if (!updated) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    return { id: updated.id, name: updated.name, verified: updated.is_verified };
}, { code: 'ERROR_UPDATING_VERIFIED', message: 'Hubo un error al intentar cambiar la insignia' });

export const updateMyProfile = withServiceError(async (user, { name }) => {
    const updated = await updateUserName(dbConnection, { userId: user.userId, name });
    if (!updated) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    return { name: updated.name };
}, { code: 'ERROR_UPDATING_PROFILE', message: 'Hubo un error al intentar actualizar el perfil' });

/**
 * Los ids se deduplican ANTES de contarlos: [a, a, b] tiene tres elementos pero solo dos
 * topics, y comparar 2 contra 3 rechazaria una peticion perfectamente valida.
 */
const replaceTopics = async (client, userId, topicIds) => {
    const unique = [...new Set(topicIds)];

    const existing = await countExistingTopics(client, unique);
    if (existing !== unique.length) {
        throw { code: 'TOPIC_NOT_FOUND', message: 'Alguna de las categorias elegidas no existe' };
    }

    await replaceUserTopicPreferences(client, userId, unique);
    return (await getUserTopicPreferences(client, userId)).map(formatTopic);
};

/**
 * El alta: nombre e intereses en una sola transaccion, porque el modal de onboarding los pide
 * juntos y a medias no sirven de nada.
 *
 * El nombre es obligatorio aqui y no en el registro porque POST /auth/register solo recibe
 * correo y contraseña, asi que un usuario local nace con name NULL. El cliente dibuja el
 * avatar con las iniciales del nombre: sin pasar por aqui no tiene ni avatar ni nombre que
 * pintar. Los de Google llegan con el suyo y el modal lo prerrellena, pero pasan igual.
 *
 * Es el UNICO sitio que marca onboarding_completed_at. Si lo marcase tambien la edicion de
 * intereses desde ajustes, un usuario sin nombre completaria el onboarding por la puerta de
 * atras y volveria el problema que este endpoint existe para cerrar.
 */
export const completeOnboarding = withServiceError(async (user, { name, topicIds }) => {
    return withTransaction(async (client) => {
        const updated = await updateUserName(client, { userId: user.userId, name });
        if (!updated) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

        // El handle se genera aqui porque este es el primer momento en que existe un nombre del
        // que derivarlo: un usuario local nace con name NULL. Los de Google ya lo traen puesto
        // desde el alta, y ensureUniqueUsername lo reescribe con el nombre que confirmen aqui.
        const username = await ensureUniqueUsername(client, { userId: user.userId, base: name });

        const topics = await replaceTopics(client, user.userId, topicIds);
        const marked = await markOnboardingCompleted(client, user.userId);

        return {
            name: updated.name,
            username,
            topics,
            onboardingCompleted: true,
            onboardingCompletedAt: marked?.onboarding_completed_at ?? null,
        };
    });
}, { code: 'ERROR_COMPLETING_ONBOARDING', message: 'Hubo un error al intentar completar tu perfil' });

/**
 * Editar intereses desde ajustes. Reemplazo completo, y deliberadamente NO toca el onboarding:
 * ver completeOnboarding.
 */
export const setMyTopics = withServiceError(async (user, topicIds) => {
    return withTransaction(async (client) => ({
        topics: await replaceTopics(client, user.userId, topicIds),
    }));
}, { code: 'ERROR_UPDATING_TOPICS', message: 'Hubo un error al intentar guardar tus intereses' });

/**
 * La zona horaria decide donde corta el dia para la racha y para el heatmap, asi que se
 * valida dos veces: en el borde con zod y contra el propio Postgres antes de escribirla.
 * El sondeo va primero y fuera de cualquier escritura: si Postgres la rechaza, todavia no
 * se ha tocado nada.
 */
export const changeTimezone = withServiceError(async (user, timezone) => {
    try {
        await probeTimezone(dbConnection, timezone);
    }
    catch {
        throw { code: 'INVALID_TIMEZONE', message: 'La zona horaria no es valida' };
    }

    const updated = await updateUserTimezone(dbConnection, { userId: user.userId, timezone });
    if (!updated) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    return { timezone: updated.timezone };
}, { code: 'ERROR_UPDATING_TIMEZONE', message: 'Hubo un error al intentar cambiar la zona horaria' });
