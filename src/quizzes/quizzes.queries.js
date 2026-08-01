/** Siguiente posicion dentro de la ranura, que es la leccion de la que cuelga el quiz. */
export const nextQuizPosition = async (client, routeId, afterLessonId) => {
    const { rows } = await client.query(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next
           FROM quizzes
          WHERE route_id = $1 AND after_lesson_id IS NOT DISTINCT FROM $2`,
        [routeId, afterLessonId]
    );

    return rows[0].next;
}

/** Confirma que la leccion existe y pertenece a esa misma ruta antes de colgar el quiz. */
export const lessonBelongsToRoute = async (client, lessonId, routeId) => {
    const { rows } = await client.query(
        `SELECT id FROM lessons WHERE id = $1 AND route_id = $2`,
        [lessonId, routeId]
    );

    return rows.length > 0;
}

export const insertQuiz = async (client, { routeId, title, afterLessonId, position }) => {
    const { rows } = await client.query(
        `INSERT INTO quizzes (route_id, title, after_lesson_id, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, route_id, title, after_lesson_id, position, created_at`,
        [routeId, title, afterLessonId, position]
    );

    return rows[0];
}

export const insertQuestion = async (client, { quizId, question, image, position }) => {
    const { rows } = await client.query(
        `INSERT INTO quiz_questions (quiz_id, question, image, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, question, image, position`,
        [quizId, question, image, position]
    );

    return rows[0];
}

export const insertOptions = async (client, questionId, options) => {
    const { rows } = await client.query(
        `INSERT INTO quiz_options (question_id, text, is_correct, position)
         SELECT $1, o.text, o.is_correct, o.position
           FROM unnest($2::text[], $3::bool[], $4::int[]) AS o(text, is_correct, position)
         RETURNING id, text, is_correct, position`,
        [
            questionId,
            options.map((o) => o.text),
            options.map((o) => o.isCorrect === true),
            options.map((_, i) => i + 1),
        ]
    );

    return rows;
}

export const findQuizWithRoute = async (client, quizId) => {
    const { rows } = await client.query(
        `SELECT q.id, q.route_id, q.title, q.after_lesson_id, q.position, r.user_id
           FROM quizzes q JOIN routes r ON r.id = q.route_id
          WHERE q.id = $1`,
        [quizId]
    );

    return rows[0] ?? null;
}

export const getQuizQuestions = async (client, quizId) => {
    const { rows } = await client.query(
        `SELECT qq.id, qq.question, qq.image, qq.position,
                COALESCE(
                    json_agg(json_build_object('id', qo.id, 'text', qo.text,
                                               'isCorrect', qo.is_correct, 'position', qo.position)
                             ORDER BY qo.position)
                    FILTER (WHERE qo.id IS NOT NULL), '[]'
                ) AS options
           FROM quiz_questions qq
           LEFT JOIN quiz_options qo ON qo.question_id = qq.id
          WHERE qq.quiz_id = $1
          GROUP BY qq.id
          ORDER BY qq.position`,
        [quizId]
    );

    return rows;
}

/** Keys de S3 de las imagenes de las preguntas. Llamar ANTES de borrar o reemplazar. */
export const collectQuizKeys = async (client, quizId) => {
    const { rows } = await client.query(
        `SELECT image AS key FROM quiz_questions WHERE quiz_id = $1 AND image IS NOT NULL`,
        [quizId]
    );

    return rows.map((row) => row.key);
}

export const updateQuizById = async (client, { id, title, afterLessonId, position }) => {
    const { rows } = await client.query(
        `UPDATE quizzes SET title = $2, after_lesson_id = $3, position = $4
          WHERE id = $1
          RETURNING id, route_id, title, after_lesson_id, position`,
        [id, title, afterLessonId, position]
    );

    return rows[0] ?? null;
}

export const deleteQuizQuestions = async (client, quizId) => {
    await client.query(`DELETE FROM quiz_questions WHERE quiz_id = $1`, [quizId]);
}

export const deleteQuizById = async (client, quizId) => {
    const { rows } = await client.query(
        `DELETE FROM quizzes WHERE id = $1 RETURNING id`,
        [quizId]
    );

    return rows[0] ?? null;
}
