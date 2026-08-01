import { withServiceError } from '../lib/withServiceError.js';
import { withTransaction } from '../../database/connection.js';
import { dbConnection } from '../../database/connection.js';
import { isStorageKey, enqueueDeletions, verifyUpload, urlOfReading, drainPendingDeletions } from '../uploads/uploads.services.js';
import {
    collectRouteAttachmentKeys,
    deleteRouteById,
    updateRouteImage as updateRouteImageQuery,
    insertRoute,
    findRouteById,
    getRouteOutline,
    listPublishedRoutes,
    listRoutesByUser,
    updateRouteById,
    publishRouteById,
    countRouteLessons,
    replaceRouteTopics,
    getRouteTopics,
    listTopics,
} from './routes.queries.js';

const isAdminRole = (role) => role === 'ADMIN';

/** Se lanza sin await: si falla, la key sigue encolada y el worker la reintenta. */
const drainInBackground = () => { drainPendingDeletions().catch(() => {}); };

const formatRouteCard = async (row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    image: await urlOfReading(row.image),
    isPublished: row.is_published,
    ratingAvg: Number(row.rating_avg ?? 0),
    ratingCount: row.rating_count,
    enrollmentCount: row.enrollment_count,
    completionCount: row.completion_count,
    createdAt: row.created_at,
    ...(row.author_name ? { author: { name: row.author_name } } : {}),
});

export const getTopics = withServiceError(async () => {
    return listTopics(dbConnection);
}, { code: 'ERROR_GETTING_TOPICS', message: 'Hubo un error al intentar obtener las categorias' });

export const createRoute = withServiceError(async (user, { title, description, image, topicIds }) => {
    // Antes de guardar la key hay que confirmar que el objeto existe y es del usuario.
    if (isStorageKey(image)) await verifyUpload(user, image, 'route-cover');

    const route = await withTransaction(async (client) => {
        const created = await insertRoute(client, {
            userId: user.userId,
            title,
            description: description ?? null,
            image: image ?? null,
        });

        await replaceRouteTopics(client, created.id, topicIds ?? []);
        return created;
    });

    return { ...(await formatRouteCard(route)), topics: [] };
}, { code: 'ERROR_CREATING_ROUTE', message: 'Hubo un error al intentar crear la ruta' });

export const getRoute = withServiceError(async (user, routeId) => {
    const route = await findRouteById(dbConnection, routeId);
    if (!route) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };

    // Una ruta privada solo la ve su autor (o un admin).
    const isOwner = route.user_id === user.userId || isAdminRole(user.role);
    if (route.is_published !== 'PUBLIC' && !isOwner) {
        throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };
    }

    const [items, topics] = await Promise.all([
        getRouteOutline(dbConnection, routeId),
        getRouteTopics(dbConnection, routeId),
    ]);

    return {
        ...(await formatRouteCard(route)),
        author: { name: route.author_name, image: await urlOfReading(route.author_image) },
        topics,
        items,
    };
}, { code: 'ERROR_GETTING_ROUTE', message: 'Hubo un error al intentar obtener la ruta' });

export const listRoutes = withServiceError(async (user, { mine, take, skip }) => {
    const rows = mine
        ? await listRoutesByUser(dbConnection, { userId: user.userId, take, skip })
        : await listPublishedRoutes(dbConnection, { take, skip });

    return Promise.all(rows.map(formatRouteCard));
}, { code: 'ERROR_GETTING_ROUTES', message: 'Hubo un error al intentar obtener las rutas' });

export const updateRoute = withServiceError(async (user, routeId, { title, description, topicIds }) => {
    const updated = await withTransaction(async (client) => {
        const row = await updateRouteById(client, {
            id: routeId,
            userId: user.userId,
            isAdmin: isAdminRole(user.role),
            title: title ?? null,
            description: description ?? null,
        });

        if (!row) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta que intentas editar' };

        if (topicIds) await replaceRouteTopics(client, routeId, topicIds);
        return row;
    });

    return { ...(await formatRouteCard(updated)), topics: await getRouteTopics(dbConnection, routeId) };
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
