import { withServiceError } from '../lib/withServiceError.js';
import { withTransaction, dbConnection } from '../../database/connection.js';
import { isStorageKey, orphanKeys, enqueueDeletions, verifyUpload, urlOfReading, drainPendingDeletions } from '../uploads/uploads.services.js';
import { recordActivity } from '../gamification/gamification.services.js';
import { findRouteForOwner } from '../routes/routes.queries.js';
import {
    nextLessonPosition,
    insertLesson,
    insertLessonBlocks,
    findLessonWithRoute,
    getLessonBlocks,
    collectLessonKeys,
    updateLessonById,
    deleteLessonBlocks,
    deleteLessonById,
    listLessonIds,
    applyLessonOrder,
} from './lessons.queries.js';

const isAdminRole = (role) => role === 'ADMIN';
const drainInBackground = () => { drainPendingDeletions().catch(() => {}); };

const blockKeys = (blocks = []) => blocks.map((b) => b.key).filter(isStorageKey);

/** Toda mutacion de contenido empieza confirmando que la ruta es del usuario. */
const assertRouteOwner = async (client, user, routeId) => {
    const route = await findRouteForOwner(client, {
        routeId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
    });

    if (!route) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };
    return route;
};

const formatBlock = async (row) => ({
    id: row.id,
    blockType: row.block_type,
    text: row.text,
    key: row.url,
    url: await urlOfReading(row.url, row.block_type === 'VIDEO' ? 'VIDEO' : 'IMAGE'),
    position: row.position,
});

const formatLesson = async (lesson, blocks = []) => ({
    id: lesson.id,
    routeId: lesson.route_id,
    title: lesson.title,
    contentType: lesson.content_type,
    content: lesson.content,
    position: lesson.position,
    blocks: await Promise.all(blocks.map(formatBlock)),
});

/**
 * Alta por lotes, todo o nada: o entran las N lecciones o no entra ninguna.
 *
 * El orden del array manda. Se pide la siguiente posicion UNA vez y se le suma el indice, en vez de
 * consultarla por leccion: dentro de la transaccion daria lo mismo -- cada MAX veria el insert
 * anterior -- pero son N-1 consultas de menos.
 */
export const createLessons = withServiceError(async (user, routeId, lessons) => {
    // Fuera de la transaccion: verifyUpload golpea S3 y no debe alargar el lock.
    for (const lesson of lessons) {
        for (const key of blockKeys(lesson.blocks)) await verifyUpload(user, key, 'lesson-block');
    }

    const created = await withTransaction(async (client) => {
        await assertRouteOwner(client, user, routeId);

        const base = await nextLessonPosition(client, routeId);
        const inserted = [];

        for (const [index, { title, contentType, content, blocks = [] }] of lessons.entries()) {
            const lesson = await insertLesson(client, {
                routeId,
                title,
                contentType,
                content: contentType === 'PARAGRAPH' ? content : null,
                position: base + index,
            });

            const rows = contentType === 'SLIDES'
                ? await insertLessonBlocks(client, lesson.id, blocks)
                : [];

            inserted.push({ lesson, rows });
        }

        /* Los N eventos al final, DESPUES de todos los INSERT. Intercalar uno por leccion tomaria
           user_stats en medio y volveria a tomar routes despues, que es justo el orden de locks
           que recordActivity existe para evitar. */
        for (const { lesson } of inserted) {
            await recordActivity(client, {
                userId: user.userId,
                eventType: 'LESSON_CREATED',
                targetId: lesson.id,
            });
        }

        return inserted;
    });

    return Promise.all(created.map(({ lesson, rows }) => formatLesson(lesson, rows)));
}, { code: 'ERROR_CREATING_LESSON', message: 'Hubo un error al intentar crear las lecciones' });

export const getLesson = withServiceError(async (user, lessonId) => {
    const lesson = await findLessonWithRoute(dbConnection, lessonId);
    if (!lesson) throw { code: 'LESSON_NOT_FOUND', message: 'No fue posible encontrar la leccion' };

    // El contenido de una ruta privada solo lo ve su autor (o un admin). Se responde
    // LESSON_NOT_FOUND y no ACCESS_DENIED, igual que getRoute: no se confirma la existencia
    // de recursos ajenos.
    const isOwner = lesson.user_id === user.userId || isAdminRole(user.role);
    if (lesson.is_published !== 'PUBLIC' && !isOwner) {
        throw { code: 'LESSON_NOT_FOUND', message: 'No fue posible encontrar la leccion' };
    }

    return formatLesson(lesson, await getLessonBlocks(dbConnection, lessonId));
}, { code: 'ERROR_GETTING_LESSON', message: 'Hubo un error al intentar obtener la leccion' });

export const updateLesson = withServiceError(async (user, lessonId, payload) => {
    const { title, contentType, content, blocks = [] } = payload;

    for (const key of blockKeys(blocks)) await verifyUpload(user, key, 'lesson-block');

    const { lesson, rows } = await withTransaction(async (client) => {
        const current = await findLessonWithRoute(client, lessonId);
        if (!current) throw { code: 'LESSON_NOT_FOUND', message: 'No fue posible encontrar la leccion' };
        await assertRouteOwner(client, user, current.route_id);

        const previousKeys = await collectLessonKeys(client, lessonId);

        const updated = await updateLessonById(client, {
            id: lessonId,
            title,
            contentType,
            content: contentType === 'PARAGRAPH' ? content : null,
        });

        await deleteLessonBlocks(client, lessonId);
        const inserted = contentType === 'SLIDES'
            ? await insertLessonBlocks(client, lessonId, blocks)
            : [];

        // Solo las keys que dejaron de usarse; las que el usuario conservo siguen vivas.
        await enqueueDeletions(client, orphanKeys(previousKeys, blockKeys(blocks)));

        return { lesson: updated, rows: inserted };
    });

    drainInBackground();

    return formatLesson(lesson, rows);
}, { code: 'ERROR_UPDATING_LESSON', message: 'Hubo un error al intentar editar la leccion' });

export const deleteLesson = withServiceError(async (user, lessonId) => {
    await withTransaction(async (client) => {
        const lesson = await findLessonWithRoute(client, lessonId);
        if (!lesson) throw { code: 'LESSON_NOT_FOUND', message: 'No fue posible encontrar la leccion' };
        await assertRouteOwner(client, user, lesson.route_id);

        // Antes del DELETE: el cascade se lleva los lesson_blocks con sus keys.
        const keys = await collectLessonKeys(client, lessonId);

        await deleteLessonById(client, lessonId);
        await enqueueDeletions(client, keys.filter(isStorageKey));
    });

    drainInBackground();
}, { code: 'ERROR_DELETING_LESSON', message: 'Hubo un error al intentar eliminar la leccion' });

export const reorderLessons = withServiceError(async (user, routeId, orderedIds) => {
    return withTransaction(async (client) => {
        await assertRouteOwner(client, user, routeId);

        const current = await listLessonIds(client, routeId);

        // La lista tiene que ser una permutacion exacta: si falta una leccion o sobra un
        // id ajeno, el UPDATE dejaria posiciones con huecos o tocaria otra ruta.
        const sameLength = current.length === orderedIds.length;
        const allBelong = orderedIds.every((id) => current.includes(id));
        const noDupes = new Set(orderedIds).size === orderedIds.length;

        if (!sameLength || !allBelong || !noDupes) {
            throw { code: 'INVALID_ORDER', message: 'La lista debe contener exactamente las lecciones de la ruta' };
        }

        await applyLessonOrder(client, routeId, orderedIds);

        return { order: orderedIds };
    });
}, { code: 'ERROR_REORDERING_LESSONS', message: 'Hubo un error al intentar reordenar las lecciones' });
