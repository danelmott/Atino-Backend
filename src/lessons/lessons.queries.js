export const nextLessonPosition = async (client, routeId) => {
    const { rows } = await client.query(
        `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM lessons WHERE route_id = $1`,
        [routeId]
    );

    return rows[0].next;
}

export const insertLesson = async (client, { routeId, title, contentType, content, position }) => {
    const { rows } = await client.query(
        `INSERT INTO lessons (route_id, title, content_type, content, position)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, route_id, title, content_type, content, position, created_at`,
        [routeId, title, contentType, content, position]
    );

    return rows[0];
}

/**
 * Inserta los bloques en una sola sentencia. La posicion la fija el orden del array, asi
 * que el cliente no puede mandar posiciones repetidas ni con huecos.
 */
export const insertLessonBlocks = async (client, lessonId, blocks) => {
    if (blocks.length === 0) return [];

    const { rows } = await client.query(
        `INSERT INTO lesson_blocks (lesson_id, block_type, text, url, position)
         SELECT $1, b.block_type::lesson_block_type, b.text, b.url, b.position
           FROM unnest($2::text[], $3::text[], $4::text[], $5::int[])
                AS b(block_type, text, url, position)
         RETURNING id, block_type, text, url, position`,
        [
            lessonId,
            blocks.map((b) => b.blockType),
            blocks.map((b) => b.text ?? null),
            blocks.map((b) => b.key ?? null),
            blocks.map((_, i) => i + 1),
        ]
    );

    return rows;
}

export const findLessonWithRoute = async (client, lessonId) => {
    const { rows } = await client.query(
        // r.user_id y r.is_published vienen de aqui para poder autorizar en la misma
        // consulta que resuelve leccion -> ruta, sin un viaje extra a la base.
        `SELECT l.id, l.route_id, l.title, l.content_type, l.content, l.position,
                r.user_id, r.is_published
           FROM lessons l JOIN routes r ON r.id = l.route_id
          WHERE l.id = $1`,
        [lessonId]
    );

    return rows[0] ?? null;
}

export const getLessonBlocks = async (client, lessonId) => {
    const { rows } = await client.query(
        `SELECT id, block_type, text, url, position
           FROM lesson_blocks WHERE lesson_id = $1 ORDER BY position`,
        [lessonId]
    );

    return rows;
}

/** Keys de S3 de los bloques. Hay que llamarla ANTES de borrar o reemplazar los bloques. */
export const collectLessonKeys = async (client, lessonId) => {
    const { rows } = await client.query(
        `SELECT url AS key FROM lesson_blocks WHERE lesson_id = $1 AND url IS NOT NULL`,
        [lessonId]
    );

    return rows.map((row) => row.key);
}

export const updateLessonById = async (client, { id, title, contentType, content }) => {
    const { rows } = await client.query(
        `UPDATE lessons SET title = $2, content_type = $3, content = $4
          WHERE id = $1
          RETURNING id, route_id, title, content_type, content, position`,
        [id, title, contentType, content]
    );

    return rows[0] ?? null;
}

export const deleteLessonBlocks = async (client, lessonId) => {
    await client.query(`DELETE FROM lesson_blocks WHERE lesson_id = $1`, [lessonId]);
}

export const deleteLessonById = async (client, lessonId) => {
    const { rows } = await client.query(
        `DELETE FROM lessons WHERE id = $1 RETURNING id`,
        [lessonId]
    );

    return rows[0] ?? null;
}

export const listLessonIds = async (client, routeId) => {
    const { rows } = await client.query(
        `SELECT id FROM lessons WHERE route_id = $1 ORDER BY position`,
        [routeId]
    );

    return rows.map((row) => row.id);
}

/**
 * Reordena en un solo UPDATE. Difiere uq_lessons_route_position porque a mitad de la
 * sentencia hay posiciones repetidas; con el constraint inmediato Postgres abortaria
 * antes de terminar. Para eso se declaro DEFERRABLE en el schema inicial.
 */
export const applyLessonOrder = async (client, routeId, orderedIds) => {
    await client.query(`SET CONSTRAINTS uq_lessons_route_position DEFERRED`);
    await client.query(
        `UPDATE lessons AS l
            SET position = o.position
           FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, position)
          WHERE l.id = o.id AND l.route_id = $1`,
        [routeId, orderedIds]
    );
}
