import { withServiceError } from '../lib/withServiceError.js';
import { withTransaction } from '../../database/connection.js';
import { dbConnection } from '../../database/connection.js';
import { isStorageKey, enqueueDeletions, verifyUpload, urlOfReading, drainPendingDeletions } from '../uploads/uploads.services.js';
import { recordActivity } from '../gamification/gamification.services.js';
import {
    collectRouteAttachmentKeys,
    deleteRouteById,
    updateRouteImage as updateRouteImageQuery,
    insertRoute,
    findRouteById,
    getRouteOutline,
    listPublishedRoutes,
    searchPublishedRoutes,
    listPublicRoutesByUser,
    listRoutesByUser,
    updateRouteById,
    publishRouteById,
    countRouteLessons,
    findTopicById,
    listTopics,
} from './routes.queries.js';

const isAdminRole = (role) => role === 'ADMIN';

/** Se lanza sin await: si falla, la key sigue encolada y el worker la reintenta. */
const drainInBackground = () => { drainPendingDeletions().catch(() => {}); };

/**
 * Las filas de listado traen el topic ya resuelto por el JOIN; las que salen de un INSERT o
 * un UPDATE solo traen topic_id, y en ese caso el service lo completa antes de formatear.
 */
const formatTopic = (row) => (row.topic_slug
    ? { id: row.topic_id, slug: row.topic_slug, name: row.topic_name }
    : null);

/**
 * El autor de la tarjeta, o null cuando la consulta no lo trae -- listRoutesByUser es el "mis
 * rutas" del propio autor y no hace JOIN con users, porque ahi ya se sabe de quien son.
 *
 * Se mira author_id y NO author_name: `users.name` es nullable, asi que un autor que aun no ha
 * pasado por el onboarding dejaria la tarjeta sin autor y sin enlace a su perfil. undefined
 * distingue "la columna no se ha pedido" de "el usuario no tiene nombre todavia".
 */
const formatAuthor = async (row) => (row.author_id === undefined ? null : {
    id: row.author_id,
    name: row.author_name,
    // El handle con el que el front enruta el perfil. Sin el, la tarjeta no puede enlazar a
    // quien la ha escrito.
    username: row.author_username,
    image: await urlOfReading(row.author_image),
    verified: row.author_verified,
});

export const formatRouteCard = async (row) => {
    const author = await formatAuthor(row);

    return {
        id: row.id,
        title: row.title,
        description: row.description,
        image: await urlOfReading(row.image),
        isPublished: row.is_published,
        topic: formatTopic(row),
        ratingAvg: Number(row.rating_avg ?? 0),
        ratingCount: row.rating_count,
        enrollmentCount: row.enrollment_count,
        completionCount: row.completion_count,
        createdAt: row.created_at,
        ...(author ? { author } : {}),
    };
};

/** Convierte un topic suelto en las columnas que espera formatTopic. */
const withTopicColumns = (row, topic) => ({
    ...row,
    topic_id: topic.id,
    topic_slug: topic.slug,
    topic_name: topic.name,
});

export const getTopics = withServiceError(async () => {
    return listTopics(dbConnection);
}, { code: 'ERROR_GETTING_TOPICS', message: 'Hubo un error al intentar obtener las categorias' });

export const createRoute = withServiceError(async (user, { title, description, image, topicId }) => {
    // Antes de guardar la key hay que confirmar que el objeto existe y es del usuario.
    if (isStorageKey(image)) await verifyUpload(user, image, 'route-cover');

    const topic = await findTopicById(dbConnection, topicId);
    if (!topic) throw { code: 'TOPIC_NOT_FOUND', message: 'La categoria elegida no existe' };

    const route = await withTransaction(async (client) => {
        const created = await insertRoute(client, {
            userId: user.userId,
            title,
            description: description ?? null,
            image: image ?? null,
            topicId,
        });

        // Ultima sentencia de la transaccion, por el orden de locks: ver recordActivity.
        // Crear no da XP, pero pinta cuadrito en el heatmap y mantiene viva la racha.
        await recordActivity(client, {
            userId: user.userId,
            eventType: 'ROUTE_CREATED',
            subjectId: created.id,
        });

        return created;
    });

    return formatRouteCard(withTopicColumns(route, topic));
}, { code: 'ERROR_CREATING_ROUTE', message: 'Hubo un error al intentar crear la ruta' });

export const getRoute = withServiceError(async (user, routeId) => {
    const route = await findRouteById(dbConnection, routeId);
    if (!route) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };

    // Una ruta privada solo la ve su autor (o un admin).
    const isOwner = route.user_id === user.userId || isAdminRole(user.role);
    if (route.is_published !== 'PUBLIC' && !isOwner) {
        throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };
    }

    const items = await getRouteOutline(dbConnection, routeId);

    // El author ya lo arma formatRouteCard a partir de las mismas columnas: antes se repetia
    // aqui, y era la via por la que el detalle podia acabar emitiendo una ficha del autor
    // distinta de la que emite la tarjeta.
    return { ...(await formatRouteCard(route)), items };
}, { code: 'ERROR_GETTING_ROUTE', message: 'Hubo un error al intentar obtener la ruta' });

export const listRoutes = withServiceError(async (user, { mine, topic, sort, take, skip }) => {
    const rows = mine
        ? await listRoutesByUser(dbConnection, { userId: user.userId, take, skip })
        : await listPublishedRoutes(dbConnection, { topicSlug: topic, sort, take, skip });

    return Promise.all(rows.map(formatRouteCard));
}, { code: 'ERROR_GETTING_ROUTES', message: 'Hubo un error al intentar obtener las rutas' });

/**
 * La mitad de rutas de /search. Vive en este modulo y no en `search` por el mismo motivo que
 * listPublicRoutesOfUser: el SQL de rutas y formatRouteCard son de aqui, y search solo compone.
 */
export const searchRoutes = withServiceError(async ({ words, term, termLike, take, skip }) => {
    const rows = await searchPublishedRoutes(dbConnection, { words, term, termLike, take, skip });

    return Promise.all(rows.map(formatRouteCard));
}, { code: 'ERROR_SEARCHING_ROUTES', message: 'Hubo un error al intentar buscar rutas' });

/**
 * Las rutas publicas de un autor, para su perfil. Vive aqui y no en users porque el SQL de
 * rutas y formatRouteCard son de este modulo; users solo pone la URL.
 */
export const listPublicRoutesOfUser = withServiceError(async (userId, { take, skip }) => {
    const rows = await listPublicRoutesByUser(dbConnection, { userId, take, skip });

    return Promise.all(rows.map(formatRouteCard));
}, { code: 'ERROR_GETTING_ROUTES', message: 'Hubo un error al intentar obtener las rutas' });

export const updateRoute = withServiceError(async (user, routeId, { title, description, topicId }) => {
    // Se comprueba antes de abrir la transaccion: si el subject no existe, la FK abortaria
    // con un 23503 que el errorHandler no mapea y saldria como un 500.
    if (topicId) {
        const exists = await findTopicById(dbConnection, topicId);
        if (!exists) throw { code: 'TOPIC_NOT_FOUND', message: 'La categoria elegida no existe' };
    }

    const updated = await withTransaction(async (client) => {
        const row = await updateRouteById(client, {
            id: routeId,
            userId: user.userId,
            isAdmin: isAdminRole(user.role),
            title: title ?? null,
            description: description ?? null,
            topicId: topicId ?? null,
        });

        if (!row) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta que intentas editar' };

        return row;
    });

    // El UPDATE devuelve topic_id pero no el topic resuelto, y puede no haber cambiado.
    const topic = await findTopicById(dbConnection, updated.topic_id);

    return formatRouteCard(withTopicColumns(updated, topic));
}, { code: 'ERROR_UPDATING_ROUTE', message: 'Hubo un error al intentar editar la ruta' });

export const setRouteVisibility = withServiceError(async (user, routeId, status) => {
    return withTransaction(async (client) => {
        // Publicar una ruta sin contenido es el error mas facil de cometer, y deja
        // basura en el feed publico que nadie puede consumir.
        if (status === 'PUBLIC' && (await countRouteLessons(client, routeId)) === 0) {
            throw { code: 'ROUTE_EMPTY', message: 'La ruta necesita al menos una leccion para publicarse' };
        }

        const row = await publishRouteById(client, {
            id: routeId,
            userId: user.userId,
            isAdmin: isAdminRole(user.role),
            status,
        });

        if (!row) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };

        // Solo al publicar: despublicar y volver a publicar no deberia pintar cuadrito.
        if (status === 'PUBLIC') {
            await recordActivity(client, {
                userId: user.userId,
                eventType: 'ROUTE_PUBLISHED',
                subjectId: row.id,
            });
        }

        return { id: row.id, isPublished: row.is_published };
    });
}, { code: 'ERROR_PUBLISHING_ROUTE', message: 'Hubo un error al intentar cambiar la visibilidad de la ruta' });

export const deleteRoute = withServiceError(async (user, routeId) => {
    await withTransaction(async (client) => {
        // Antes del DELETE, porque despues el cascade ya se llevo las filas con las keys.
        const keys = await collectRouteAttachmentKeys(client, routeId);

        const deleted = await deleteRouteById(client, {
            id: routeId,
            userId: user.userId,
            isAdmin: isAdminRole(user.role),
        });

        if (!deleted) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta que intentas eliminar' };

        // Encolar dentro de la transaccion es lo que hace imposible perder una key:
        // o se borra la ruta y se encolan sus adjuntos, o no ocurre ninguna de las dos.
        await enqueueDeletions(client, keys.filter(isStorageKey));
    });

    drainInBackground();
}, { code: 'ERROR_DELETING_ROUTE', message: 'Hubo un error al intentar eliminar la ruta' });

export const updateRouteCover = withServiceError(async (user, routeId, imageKey) => {
    if (isStorageKey(imageKey)) await verifyUpload(user, imageKey, 'route-cover');

    const updated = await withTransaction(async (client) => {
        const row = await updateRouteImageQuery(client, {
            id: routeId,
            userId: user.userId,
            isAdmin: isAdminRole(user.role),
            image: imageKey,
        });

        if (!row) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta que intentas editar' };

        // La portada anterior deja de estar referenciada en cuanto se confirma el UPDATE.
        if (isStorageKey(row.old_key) && row.old_key !== row.new_key) {
            await enqueueDeletions(client, [row.old_key]);
        }

        return row;
    });

    drainInBackground();

    return { image: updated.new_key };
}, { code: 'ERROR_UPDATING_ROUTE', message: 'Hubo un error al intentar editar la ruta' });
