import { withServiceError } from '../lib/withServiceError.js';
import { withTransaction, dbConnection } from '../../database/connection.js';
import { isStorageKey, orphanKeys, enqueueDeletions, verifyUpload, urlOfReading, drainPendingDeletions } from '../uploads/uploads.services.js';
import { recordActivity } from '../gamification/gamification.services.js';
import { findRouteForOwner } from '../routes/routes.queries.js';
import {
    nextQuizPosition,
    lessonBelongsToRoute,
    insertQuiz,
    insertQuestion,
    insertOptions,
    findQuizWithRoute,
    getQuizQuestions,
    getQuizQuestionsForTaking,
    collectQuizKeys,
    updateQuizById,
    deleteQuizQuestions,
    deleteQuizById,
} from './quizzes.queries.js';

const isAdminRole = (role) => role === 'ADMIN';
const drainInBackground = () => { drainPendingDeletions().catch(() => {}); };

const questionKeys = (questions = []) => questions.map((q) => q.image).filter(isStorageKey);

const assertRouteOwner = async (client, user, routeId) => {
    const route = await findRouteForOwner(client, {
        routeId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
    });

    if (!route) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };
    return route;
};

/**
 * Sin esto se podria colgar un quiz de la leccion de otra ruta (incluso de otro usuario),
 * y el orden de la ruta quedaria apuntando a contenido ajeno.
 */
const assertLessonSlot = async (client, afterLessonId, routeId) => {
    if (!afterLessonId) return null;

    if (!(await lessonBelongsToRoute(client, afterLessonId, routeId))) {
        throw { code: 'INVALID_LESSON_REFERENCE', message: 'La leccion indicada no pertenece a esta ruta' };
    }

    return afterLessonId;
};

const formatQuestion = async (row) => ({
    id: row.id,
    question: row.question,
    key: row.image,
    image: await urlOfReading(row.image),
    position: row.position,
    options: row.options,
});

const formatQuiz = async (quiz, questions = []) => ({
    id: quiz.id,
    routeId: quiz.route_id,
    title: quiz.title,
    afterLessonId: quiz.after_lesson_id,
    position: quiz.position,
    questions: await Promise.all(questions.map(formatQuestion)),
});

/** Inserta preguntas y opciones anidadas; la posicion la fija el orden de los arrays. */
const insertQuestionTree = async (client, quizId, questions) => {
    const created = [];

    for (const [index, item] of questions.entries()) {
        const question = await insertQuestion(client, {
            quizId,
            question: item.question,
            image: item.image ?? null,
            position: index + 1,
        });

        const options = await insertOptions(client, question.id, item.options);
        created.push({ ...question, options: options.map((o) => ({ id: o.id, text: o.text, isCorrect: o.is_correct, position: o.position })) });
    }

    return created;
};

export const createQuiz = withServiceError(async (user, routeId, payload) => {
    const { title, afterLessonId = null, questions } = payload;

    for (const key of questionKeys(questions)) await verifyUpload(user, key, 'quiz-question');

    const { quiz, rows } = await withTransaction(async (client) => {
        await assertRouteOwner(client, user, routeId);
        const slot = await assertLessonSlot(client, afterLessonId, routeId);

        const created = await insertQuiz(client, {
            routeId,
            title,
            afterLessonId: slot,
            position: await nextQuizPosition(client, routeId, slot),
        });

        const rows = await insertQuestionTree(client, created.id, questions);

        // Ultima sentencia de la transaccion, por el orden de locks: ver recordActivity.
        await recordActivity(client, {
            userId: user.userId,
            eventType: 'QUIZ_CREATED',
            targetId: created.id,
        });

        return { quiz: created, rows };
    });

    return formatQuiz(quiz, rows);
}, { code: 'ERROR_CREATING_QUIZ', message: 'Hubo un error al intentar crear el quiz' });

export const getQuiz = withServiceError(async (user, quizId) => {
    const quiz = await findQuizWithRoute(dbConnection, quizId);
    if (!quiz) throw { code: 'QUIZ_NOT_FOUND', message: 'No fue posible encontrar el quiz' };

    // Un quiz de una ruta privada solo lo ve su autor (o un admin). Se responde
    // QUIZ_NOT_FOUND y no ACCESS_DENIED, igual que getRoute: no se confirma la existencia
    // de recursos ajenos.
    const isOwner = quiz.user_id === user.userId || isAdminRole(user.role);
    if (quiz.is_published !== 'PUBLIC' && !isOwner) {
        throw { code: 'QUIZ_NOT_FOUND', message: 'No fue posible encontrar el quiz' };
    }

    // El solucionario es solo para quien lo escribio: al alumno se le sirve la version sin
    // is_correct, o resolver el quiz seria un tramite.
    const questions = isOwner
        ? await getQuizQuestions(dbConnection, quizId)
        : await getQuizQuestionsForTaking(dbConnection, quizId);

    return formatQuiz(quiz, questions);
}, { code: 'ERROR_GETTING_QUIZ', message: 'Hubo un error al intentar obtener el quiz' });

export const updateQuiz = withServiceError(async (user, quizId, payload) => {
    const { title, afterLessonId = null, questions } = payload;

    for (const key of questionKeys(questions)) await verifyUpload(user, key, 'quiz-question');

    const { quiz, rows } = await withTransaction(async (client) => {
        const current = await findQuizWithRoute(client, quizId);
        if (!current) throw { code: 'QUIZ_NOT_FOUND', message: 'No fue posible encontrar el quiz' };
        await assertRouteOwner(client, user, current.route_id);

        const slot = await assertLessonSlot(client, afterLessonId, current.route_id);
        const previousKeys = await collectQuizKeys(client, quizId);

        // Si cambia de ranura hay que recalcular la posicion, o chocaria con uq_quizzes_slot.
        const position = slot === current.after_lesson_id
            ? current.position
            : await nextQuizPosition(client, current.route_id, slot);

        const updated = await updateQuizById(client, { id: quizId, title, afterLessonId: slot, position });

        await deleteQuizQuestions(client, quizId);
        const inserted = await insertQuestionTree(client, quizId, questions);

        // Solo las imagenes que dejaron de usarse; las que el usuario conservo siguen vivas.
        await enqueueDeletions(client, orphanKeys(previousKeys, questionKeys(questions)));

        return { quiz: updated, rows: inserted };
    });

    drainInBackground();

    return formatQuiz(quiz, rows);
}, { code: 'ERROR_UPDATING_QUIZ', message: 'Hubo un error al intentar editar el quiz' });

export const deleteQuiz = withServiceError(async (user, quizId) => {
    await withTransaction(async (client) => {
        const quiz = await findQuizWithRoute(client, quizId);
        if (!quiz) throw { code: 'QUIZ_NOT_FOUND', message: 'No fue posible encontrar el quiz' };
        await assertRouteOwner(client, user, quiz.route_id);

        // Antes del DELETE: el cascade se lleva las quiz_questions con sus imagenes.
        const keys = await collectQuizKeys(client, quizId);

        await deleteQuizById(client, quizId);
        await enqueueDeletions(client, keys.filter(isStorageKey));
    });

    drainInBackground();
}, { code: 'ERROR_DELETING_QUIZ', message: 'Hubo un error al intentar eliminar el quiz' });
