import { withServiceError } from '../lib/withServiceError.js';
import { dbConnection } from '../../database/connection.js';
import { urlOfReading } from '../uploads/uploads.services.js';
import {
    userExists,
    insertFollow,
    deleteFollow,
    findFollow,
    getFollowCounts,
    listFollowers,
    listFollowing,
} from './follows.queries.js';

/**
 * Seguir no pasa por recordActivity a proposito. Los eventos de 0 XP existen para acciones
 * que son trabajo real -- crear una ruta, publicarla -- y ahi tiene sentido que pinten
 * cuadrito y mantengan la racha. Seguir es un clic: si contase, cualquiera mantendria la
 * racha viva siguiendo gente al azar y la racha dejaria de significar "aprendi algo".
 */

const formatUserCard = async (row) => ({
    id: row.id,
    name: row.name,
    // El handle con el que el front enruta el perfil. Igual que `verified`: si una respuesta
    // que pinta un usuario se olvida de emitirlo, el enlace se rompe solo en esa pantalla.
    username: row.username,
    image: await urlOfReading(row.image),
    verified: row.is_verified,
    followersCount: row.followers_count,
    // Si el que mira sigue ya a esta persona, para pintar el boton correcto en cada fila.
    isFollowing: row.is_following,
    followedAt: row.followed_at,
});

/** Los contadores devueltos son los del usuario objetivo, que es lo que repinta el front. */
const formatFollowState = (counts, isFollowing) => ({
    isFollowing,
    followersCount: counts?.followers_count ?? 0,
    followingCount: counts?.following_count ?? 0,
});

/**
 * Se comprueba que el usuario existe en vez de dejar que reviente la FK: el 23503 no esta en
 * ERROR_STATUS, asi que saldria como un 500 en lugar de un 404. Mismo patron que createRoute
 * con findTopicById.
 */
const assertUserExists = async (client, userId) => {
    if (!(await userExists(client, userId))) {
        throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };
    }
};

export const followUser = withServiceError(async (user, targetId) => {
    if (targetId === user.userId) {
        throw { code: 'CANNOT_FOLLOW_SELF', message: 'No puedes seguirte a ti mismo' };
    }

    await assertUserExists(dbConnection, targetId);
    await insertFollow(dbConnection, { followerId: user.userId, followingId: targetId });

    return formatFollowState(await getFollowCounts(dbConnection, targetId), true);
}, { code: 'ERROR_FOLLOWING_USER', message: 'Hubo un error al intentar seguir al usuario' });

/**
 * Idempotente: si no lo seguias, responde 200 con el estado actual en vez de lanzar. Se
 * aparta a proposito de removeRouteRating, que si lanza RATING_NOT_FOUND -- dejar de seguir
 * es un boton facil de pulsar dos veces, y un 404 ahi solo produce un error que el front
 * tiene que aprender a ignorar.
 */
export const unfollowUser = withServiceError(async (user, targetId) => {
    await assertUserExists(dbConnection, targetId);
    await deleteFollow(dbConnection, { followerId: user.userId, followingId: targetId });

    return formatFollowState(await getFollowCounts(dbConnection, targetId), false);
}, { code: 'ERROR_UNFOLLOWING_USER', message: 'Hubo un error al intentar dejar de seguir al usuario' });

export const getFollowState = withServiceError(async (user, targetId) => {
    await assertUserExists(dbConnection, targetId);

    const [counts, mine] = await Promise.all([
        getFollowCounts(dbConnection, targetId),
        findFollow(dbConnection, { followerId: user.userId, followingId: targetId }),
    ]);

    return formatFollowState(counts, mine !== null);
}, { code: 'ERROR_GETTING_FOLLOW_STATE', message: 'Hubo un error al intentar obtener la relacion' });

export const getFollowers = withServiceError(async (user, targetId, { take, skip }) => {
    await assertUserExists(dbConnection, targetId);

    const rows = await listFollowers(dbConnection, {
        userId: targetId,
        viewerId: user.userId,
        take,
        skip,
    });

    return Promise.all(rows.map(formatUserCard));
}, { code: 'ERROR_GETTING_FOLLOWERS', message: 'Hubo un error al intentar obtener los seguidores' });

export const getFollowing = withServiceError(async (user, targetId, { take, skip }) => {
    await assertUserExists(dbConnection, targetId);

    const rows = await listFollowing(dbConnection, {
        userId: targetId,
        viewerId: user.userId,
        take,
        skip,
    });

    return Promise.all(rows.map(formatUserCard));
}, { code: 'ERROR_GETTING_FOLLOWING', message: 'Hubo un error al intentar obtener los seguidos' });
