import { withServiceError } from '../lib/withServiceError.js';
import { withTransaction, dbConnection } from '../../database/connection.js';
import { findRouteForConsumer } from '../routes/routes.queries.js';
import { findLessonWithRoute } from '../lessons/lessons.queries.js';
import { findQuizWithRoute } from '../quizzes/quizzes.queries.js';
import { recordActivity, QUIZ_PASS_SCORE } from '../gamification/gamification.services.js';
import {
    enrollInRoute,
    completeLesson as completeLessonQuery,
    uncompleteLesson,
    completeRouteIfDone,
    countQuizQuestions,
    countValidAnswers,
    gradeAnswers,
    insertAttempt,
    insertAttemptAnswers,
    listAttempts,
    getRouteProgress,
    listUserProgress,
    findEnrollment,
} from './progress.queries.js';

const isAdminRole = (role) => role === 'ADMIN';

/**
 * El guard del lado alumno. Es el espejo de assertRouteOwner de lessons/quizzes: alli toda
 * mutacion empieza confirmando que la ruta es tuya, aqui toda accion empieza confirmando
 * que puedes consumirla, o sea que esta publicada o es tuya.
 */
const assertRouteConsumable = async (client, user, routeId) => {
    const route = await findRouteForConsumer(client, {
        routeId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
    });

    if (!route) throw { code: 'ROUTE_NOT_FOUND', message: 'No fue posible encontrar la ruta' };
    return route;
};

const formatAttempt = (row, answers = []) => ({
    id: row.id,
    score: row.score,
    correctCount: row.correct_count,
    totalQuestions: row.total_questions,
    passed: row.score >= QUIZ_PASS_SCORE,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    ...(answers.length > 0 ? { answers } : {}),
});

/**
 * Cierra la ruta si ya no queda nada pendiente y, solo en ese caso, premia. Se llama al
 * final de completar una leccion y de resolver un quiz, que son los dos unicos sucesos que
 * pueden dejarla terminada.
 */
const closeRouteIfDone = async (client, { user, routeId, ownerId }) => {
    const done = await completeRouteIfDone(client, {
        routeId,
        userId: user.userId,
        passScore: QUIZ_PASS_SCORE,
    });

    if (!done) return null;

    return recordActivity(client, {
        userId: user.userId,
        eventType: 'ROUTE_COMPLETED',
        targetId: routeId,
        ownerId,
    });
};

export const markLessonComplete = withServiceError(async (user, lessonId) => {
    return withTransaction(async (client) => {
        const lesson = await findLessonWithRoute(client, lessonId);
        if (!lesson) throw { code: 'LESSON_NOT_FOUND', message: 'No fue posible encontrar la leccion' };

        const route = await assertRouteConsumable(client, user, lesson.route_id);
        await enrollInRoute(client, { routeId: route.id, userId: user.userId });

        const created = await completeLessonQuery(client, { lessonId, userId: user.userId });

        // Ya estaba completada: ni evento ni premio, solo se confirma el estado. Repetir la
        // llamada (un doble tap) no puede inflar el heatmap ni reactivar la racha.
        if (!created) {
            return { lessonId, completed: true, alreadyCompleted: true, activity: null, route: null };
        }

        const activity = await recordActivity(client, {
            userId: user.userId,
            eventType: 'LESSON_COMPLETED',
            targetId: lessonId,
            ownerId: route.user_id,
        });

        const routeActivity = await closeRouteIfDone(client, {
            user, routeId: route.id, ownerId: route.user_id,
        });

        return { lessonId, completed: true, alreadyCompleted: false, activity, route: routeActivity };
    });
}, { code: 'ERROR_COMPLETING_LESSON', message: 'Hubo un error al intentar completar la leccion' });

/**
 * Descompletar no borra el evento ni resta XP: el ledger es append-only y el heatmap
 * refleja lo que paso ese dia, no el estado actual. Es un cambio de progreso, no de historia.
 */
export const unmarkLessonComplete = withServiceError(async (user, lessonId) => {
    return withTransaction(async (client) => {
        const lesson = await findLessonWithRoute(client, lessonId);
        if (!lesson) throw { code: 'LESSON_NOT_FOUND', message: 'No fue posible encontrar la leccion' };

        await assertRouteConsumable(client, user, lesson.route_id);
        const removed = await uncompleteLesson(client, { lessonId, userId: user.userId });

        return { lessonId, completed: false, changed: removed };
    });
}, { code: 'ERROR_UNCOMPLETING_LESSON', message: 'Hubo un error al intentar descompletar la leccion' });

export const submitQuizAttempt = withServiceError(async (user, quizId, answers) => {
    const questionIds = answers.map((answer) => answer.questionId);
    const optionIds = answers.map((answer) => answer.optionId);

    return withTransaction(async (client) => {
        const quiz = await findQuizWithRoute(client, quizId);
        if (!quiz) throw { code: 'QUIZ_NOT_FOUND', message: 'No fue posible encontrar el quiz' };

        const route = await assertRouteConsumable(client, user, quiz.route_id);

        const totalQuestions = await countQuizQuestions(client, quizId);
        if (totalQuestions === 0) {
            throw { code: 'QUIZ_EMPTY', message: 'El quiz no tiene preguntas' };
        }

        // Todo par (pregunta, opcion) tiene que pertenecer a ESTE quiz. Si alguno no
        // sobrevive al join, el envio entero se rechaza en vez de calificarse a medias.
        const valid = await countValidAnswers(client, { quizId, questionIds, optionIds });
        if (valid !== answers.length) {
            throw { code: 'INVALID_ANSWERS', message: 'Alguna respuesta no pertenece a este quiz' };
        }

        const graded = await gradeAnswers(client, { quizId, questionIds, optionIds });
        const correctCount = graded.filter((row) => row.is_correct).length;

        // El total sale de la base, nunca de answers.length: si no, bastaria mandar una
        // sola respuesta acertada para sacar un 100.
        const score = Math.round((correctCount / totalQuestions) * 10000) / 100;

        const attempt = await insertAttempt(client, {
            quizId, userId: user.userId, score, correctCount, totalQuestions,
        });

        await insertAttemptAnswers(client, attempt.id, graded);
        await enrollInRoute(client, { routeId: route.id, userId: user.userId });

        const activity = await recordActivity(client, {
            userId: user.userId,
            eventType: 'QUIZ_COMPLETED',
            targetId: quizId,
            ownerId: route.user_id,
            score,
        });

        const routeActivity = await closeRouteIfDone(client, {
            user, routeId: route.id, ownerId: route.user_id,
        });

        return {
            attempt: formatAttempt(attempt, graded.map((row) => ({
                questionId: row.question_id,
                question: row.question_text,
                optionId: row.option_id,
                option: row.option_text,
                isCorrect: row.is_correct,
                position: row.position,
            }))),
            activity,
            route: routeActivity,
        };
    });
}, { code: 'ERROR_SUBMITTING_ATTEMPT', message: 'Hubo un error al intentar enviar el quiz' });

export const getQuizAttempts = withServiceError(async (user, quizId) => {
    const quiz = await findQuizWithRoute(dbConnection, quizId);
    if (!quiz) throw { code: 'QUIZ_NOT_FOUND', message: 'No fue posible encontrar el quiz' };

    await assertRouteConsumable(dbConnection, user, quiz.route_id);

    const rows = await listAttempts(dbConnection, { quizId, userId: user.userId });
    return rows.map((row) => formatAttempt(row));
}, { code: 'ERROR_GETTING_ATTEMPTS', message: 'Hubo un error al intentar obtener los intentos' });

/**
 * `total` viaja SIEMPRE junto a `done`, y ese es el punto: el cliente no puede sacar el
 * denominador de ningun otro campo. Antes lo deducia del numero de quizzes de la ruta, pero
 * `done` cuenta lecciones completadas ademas de quizzes aprobados, asi que una ruta de diez
 * lecciones y dos quizzes se pintaba terminada en la segunda leccion.
 *
 * `completed` sale de route_enrollments.completed_at y NO de done === total. Son cosas
 * distintas en cuanto el autor añade una leccion a una ruta que alguien ya termino: la
 * inscripcion sigue completada -- y el XP ya se pago -- aunque queden items sin hacer.
 */
const formatProgressRow = (row) => ({
    routeId: row.route_id,
    done: row.done,
    total: row.total,
    percent: row.total === 0 ? 0 : Math.round((row.done / row.total) * 100),
    completed: row.completed_at !== null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
});

export const getMyProgress = withServiceError(async (user, { take, skip }) => {
    const rows = await listUserProgress(dbConnection, {
        userId: user.userId,
        passScore: QUIZ_PASS_SCORE,
        take,
        skip,
    });

    return rows.map(formatProgressRow);
}, { code: 'ERROR_GETTING_PROGRESS', message: 'Hubo un error al intentar obtener tu progreso' });

export const getRouteProgressForUser = withServiceError(async (user, routeId) => {
    await assertRouteConsumable(dbConnection, user, routeId);

    const [items, enrollment] = await Promise.all([
        getRouteProgress(dbConnection, { routeId, userId: user.userId, passScore: QUIZ_PASS_SCORE }),
        findEnrollment(dbConnection, { routeId, userId: user.userId }),
    ]);

    const done = items.filter((item) => item.done).length;

    return {
        routeId,
        startedAt: enrollment?.started_at ?? null,
        completedAt: enrollment?.completed_at ?? null,
        // Igual que en el listado: almacenado, no derivado de done === total.
        completed: (enrollment?.completed_at ?? null) !== null,
        total: items.length,
        done,
        percent: items.length === 0 ? 0 : Math.round((done / items.length) * 100),
        items: items.map((item) => ({
            type: item.item_type,
            id: item.id,
            title: item.title,
            done: item.done,
        })),
    };
}, { code: 'ERROR_GETTING_PROGRESS', message: 'Hubo un error al intentar obtener el progreso' });
