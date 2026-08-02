/**
 * Lado alumno: completar lecciones, resolver quizzes y llevar la inscripcion a la ruta.
 * Como en el resto de modulos nuevos, todas reciben el `client` primero.
 */

/**
 * ON CONFLICT DO NOTHING y no un INSERT a secas: el trigger
 * trg_route_enrollments_refresh es FOR EACH ROW y re-agrega todas las inscripciones de la
 * ruta y bloquea su fila en routes en cada disparo. Asi salta una vez por (usuario, ruta) en
 * toda la vida en lugar de una vez por leccion completada, que serializaria a todos los
 * alumnos de una ruta popular sobre la misma fila.
 * Por la misma razon no se toca last_activity_at: esa columna el trigger ni la lee.
 */
export const enrollInRoute = async (client, { routeId, userId }) => {
    await client.query(
        `INSERT INTO route_enrollments (route_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (route_id, user_id) DO NOTHING`,
        [routeId, userId]
    );
}

/** Devuelve null si ya estaba completada: el endpoint es idempotente, no un error. */
export const completeLesson = async (client, { lessonId, userId }) => {
    const { rows } = await client.query(
        `INSERT INTO lesson_completions (lesson_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (lesson_id, user_id) DO NOTHING
         RETURNING lesson_id`,
        [lessonId, userId]
    );

    return rows[0] ?? null;
}

export const uncompleteLesson = async (client, { lessonId, userId }) => {
    const { rowCount } = await client.query(
        `DELETE FROM lesson_completions WHERE lesson_id = $1 AND user_id = $2`,
        [lessonId, userId]
    );

    return rowCount > 0;
}

/**
 * Marca la ruta como terminada solo si no queda ninguna leccion sin completar ni ningun
 * quiz sin aprobar. El "completed_at IS NULL" hace dos cosas: la vuelve idempotente y
 * convierte el RETURNING en la señal de "acaba de terminarse ahora mismo", que es lo que
 * dispara el premio de ROUTE_COMPLETED una sola vez.
 *
 * Efecto asumido: si el autor añade una leccion a una ruta que alguien ya termino, esa
 * persona no queda des-terminada. Revocarle el logro seria peor.
 */
export const completeRouteIfDone = async (client, { routeId, userId, passScore }) => {
    const { rows } = await client.query(
        `UPDATE route_enrollments SET completed_at = now()
          WHERE route_id = $1 AND user_id = $2 AND completed_at IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM lessons l
                 WHERE l.route_id = $1
                   AND NOT EXISTS (SELECT 1 FROM lesson_completions lc
                                    WHERE lc.lesson_id = l.id AND lc.user_id = $2))
            AND NOT EXISTS (
                SELECT 1 FROM quizzes q
                 WHERE q.route_id = $1
                   AND NOT EXISTS (SELECT 1 FROM quiz_attempts qa
                                    WHERE qa.quiz_id = q.id AND qa.user_id = $2
                                      AND qa.completed_at IS NOT NULL AND qa.score >= $3))
          RETURNING route_id`,
        [routeId, userId, passScore]
    );

    return rows[0] ?? null;
}


// ============================================================
//  CALIFICACION
// ============================================================

export const countQuizQuestions = async (client, quizId) => {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM quiz_questions WHERE quiz_id = $1`,
        [quizId]
    );

    return rows[0].n;
}

/**
 * Cuantos de los pares (pregunta, opcion) enviados existen de verdad Y pertenecen a este
 * quiz. Si el numero no coincide con lo enviado, el cliente mando una pregunta ajena o una
 * opcion de otra pregunta, y el envio entero se rechaza. Sin este join se podria mandar el
 * id de una opcion correcta de otro quiz y se calificaria como buena.
 */
export const countValidAnswers = async (client, { quizId, questionIds, optionIds }) => {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM unnest($2::uuid[], $3::uuid[]) AS s(question_id, option_id)
           JOIN quiz_questions qq ON qq.id = s.question_id AND qq.quiz_id = $1
           JOIN quiz_options   qo ON qo.id = s.option_id   AND qo.question_id = qq.id`,
        [quizId, questionIds, optionIds]
    );

    return rows[0].n;
}

/**
 * Califica contra la base y nunca contra lo que diga el cliente. Parte de quiz_questions y
 * no de lo enviado, asi que una pregunta sin responder aparece igual, como saltada, y no
 * puede inflar el porcentaje quedandose fuera del recuento.
 */
export const gradeAnswers = async (client, { quizId, questionIds, optionIds }) => {
    const { rows } = await client.query(
        `WITH submitted AS (
             SELECT * FROM unnest($2::uuid[], $3::uuid[]) AS s(question_id, option_id)
         )
         SELECT qq.id                          AS question_id,
                qq.question                    AS question_text,
                qq.position,
                qo.id                          AS option_id,
                qo.text                        AS option_text,
                COALESCE(qo.is_correct, FALSE) AS is_correct
           FROM quiz_questions qq
           LEFT JOIN submitted s  ON s.question_id = qq.id
           LEFT JOIN quiz_options qo ON qo.id = s.option_id AND qo.question_id = qq.id
          WHERE qq.quiz_id = $1
          ORDER BY qq.position`,
        [quizId, questionIds, optionIds]
    );

    return rows;
}

export const insertAttempt = async (client, { quizId, userId, score, correctCount, totalQuestions }) => {
    const { rows } = await client.query(
        `INSERT INTO quiz_attempts (quiz_id, user_id, score, correct_count, total_questions, completed_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, score::float8 AS score, correct_count, total_questions, started_at, completed_at`,
        [quizId, userId, score, correctCount, totalQuestions]
    );

    return rows[0];
}

export const insertAttemptAnswers = async (client, attemptId, graded) => {
    if (graded.length === 0) return [];

    const { rows } = await client.query(
        `INSERT INTO quiz_attempt_answers
                (attempt_id, question_id, option_id, is_correct, question_text, option_text, position)
         SELECT $1, a.question_id, a.option_id, a.is_correct, a.question_text, a.option_text, a.position
           FROM unnest($2::uuid[], $3::uuid[], $4::bool[], $5::text[], $6::text[], $7::int[])
                AS a(question_id, option_id, is_correct, question_text, option_text, position)
         RETURNING id`,
        [
            attemptId,
            graded.map((row) => row.question_id),
            graded.map((row) => row.option_id),
            graded.map((row) => row.is_correct),
            graded.map((row) => row.question_text),
            graded.map((row) => row.option_text),
            graded.map((row) => row.position),
        ]
    );

    return rows;
}

export const listAttempts = async (client, { quizId, userId }) => {
    const { rows } = await client.query(
        `SELECT id, score::float8 AS score, correct_count, total_questions, started_at, completed_at
           FROM quiz_attempts
          WHERE quiz_id = $1 AND user_id = $2 AND completed_at IS NOT NULL
          ORDER BY completed_at DESC`,
        [quizId, userId]
    );

    return rows;
}


// ============================================================
//  PROGRESO DE LA RUTA
// ============================================================

/**
 * El mismo UNION ALL que getRouteOutline, con el estado del usuario pegado. sub_pos = 0 en
 * las lecciones mantiene la regla de que una leccion va antes que los quizzes que cuelgan
 * de ella.
 */
export const getRouteProgress = async (client, { routeId, userId, passScore }) => {
    const { rows } = await client.query(
        `SELECT item_type, id, title, position, sub_pos, done
           FROM (
               SELECT 'LESSON' AS item_type, l.id, l.title, l.position, 0 AS sub_pos,
                      EXISTS (SELECT 1 FROM lesson_completions lc
                               WHERE lc.lesson_id = l.id AND lc.user_id = $2) AS done,
                      l.created_at
                 FROM lessons l
                WHERE l.route_id = $1

               UNION ALL

               SELECT 'QUIZ', q.id, q.title,
                      COALESCE((SELECT l.position FROM lessons l WHERE l.id = q.after_lesson_id),
                               2147483647),
                      q.position,
                      EXISTS (SELECT 1 FROM quiz_attempts qa
                               WHERE qa.quiz_id = q.id AND qa.user_id = $2
                                 AND qa.completed_at IS NOT NULL AND qa.score >= $3),
                      q.created_at
                 FROM quizzes q
                WHERE q.route_id = $1
           ) items
          ORDER BY position, sub_pos, created_at`,
        [routeId, userId, passScore]
    );

    return rows;
}

export const findEnrollment = async (client, { routeId, userId }) => {
    const { rows } = await client.query(
        `SELECT route_id, started_at, completed_at FROM route_enrollments
          WHERE route_id = $1 AND user_id = $2`,
        [routeId, userId]
    );

    return rows[0] ?? null;
}
