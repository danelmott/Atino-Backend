import { withServiceError } from '../lib/withServiceError.js';
import { withTransaction, dbConnection } from '../../database/connection.js';
import { findRouteForConsumer } from '../routes/routes.queries.js';
import { findEnrollment } from '../progress/progress.queries.js';
import { recordActivity } from '../gamification/gamification.services.js';
import {
    upsertRouteRating,
    deleteRouteRating,
    findRouteRating,
    getRouteRatingSummary,
} from './reviews.queries.js';

const isAdminRole = (role) => role === 'ADMIN';

const assertRouteConsumable = async (client, user, routeId) => {
    const route = await findRouteForConsumer(client, {
        routeId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
    });

    if (!route) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };
    return route;
};

const formatSummary = (summary, mine) => ({
    ratingAvg: summary.rating_avg,
    ratingCount: summary.rating_count,
    breakdown: summary.breakdown,
    myRating: mine?.rating ?? null,
});

/**
 * Puntuar exige haber terminado la ruta, y no se puede puntuar la propia.
 *
 * Lo primero porque una ruta se juzga por su contenido y quien no la hizo no lo ha visto;
 * ademas ata rating_avg al uso real, que es el numero por el que se va a ordenar el
 * catalogo. Lo segundo porque si no, todo creador esta en 5.00 y la media nace muerta --
 * y esto importa mas aqui que en otras apps, porque el XP ya pone a los creadores a
 * competir entre ellos.
 */
export const rateRoute = withServiceError(async (user, routeId, rating) => {
    return withTransaction(async (client) => {
        const route = await assertRouteConsumable(client, user, routeId);

        if (route.user_id === user.userId) {
            throw { code: 'CANNOT_RATE_OWN_ROUTE', message: 'No puedes puntuar tu propia ruta' };
        }

        const enrollment = await findEnrollment(client, { routeId, userId: user.userId });
        if (!enrollment?.completed_at) {
            throw { code: 'ROUTE_NOT_COMPLETED', message: 'Tienes que terminar la ruta antes de puntuarla' };
        }

        const saved = await upsertRouteRating(client, { routeId, userId: user.userId, rating });

        // Ultima sentencia de la transaccion, por el orden de locks: ver recordActivity.
        // No da XP; solo pinta cuadrito y mantiene viva la racha.
        await recordActivity(client, {
            userId: user.userId,
            eventType: 'ROUTE_RATED',
            subjectId: routeId,
        });

        // Se relee despues del upsert porque el trigger acaba de recalcular la media.
        const summary = await getRouteRatingSummary(client, routeId);
        return formatSummary(summary, saved);
    });
}, { code: 'ERROR_RATING_ROUTE', message: 'Hubo un error al intentar puntuar la ruta' });

export const removeRouteRating = withServiceError(async (user, routeId) => {
    return withTransaction(async (client) => {
        await assertRouteConsumable(client, user, routeId);

        const removed = await deleteRouteRating(client, { routeId, userId: user.userId });
        if (!removed) throw { code: 'RATING_NOT_FOUND', message: 'No has puntuado esta ruta' };

        return formatSummary(await getRouteRatingSummary(client, routeId), null);
    });
}, { code: 'ERROR_DELETING_RATING', message: 'Hubo un error al intentar borrar la puntuacion' });

export const getRouteRating = withServiceError(async (user, routeId) => {
    await assertRouteConsumable(dbConnection, user, routeId);

    const [summary, mine] = await Promise.all([
        getRouteRatingSummary(dbConnection, routeId),
        findRouteRating(dbConnection, { routeId, userId: user.userId }),
    ]);

    return formatSummary(summary, mine);
}, { code: 'ERROR_GETTING_RATING', message: 'Hubo un error al intentar obtener la puntuacion' });
