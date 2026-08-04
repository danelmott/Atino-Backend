/**
 * El RETURNING no puede traer el topic ya resuelto (slug, nombre, disciplina) porque un
 * INSERT no admite JOIN, asi que devuelve topic_id y el service lo completa.
 */
export const insertRoute = async (client, { userId, title, description, image, topicId }) => {
    const { rows } = await client.query(
        `INSERT INTO routes (user_id, title, description, image, topic_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, description, image, is_published, topic_id, created_at`,
        [userId, title, description, image, topicId]
    );

    return rows[0];
}

/**
 * Guard de autorizacion compartido: lessons y quizzes empiezan toda mutacion llamandolo,
 * para no repetir el "(user_id = $2 OR $3 = TRUE)" en cada query de cada modulo.
 */
export const findRouteForOwner = async (client, { routeId, userId, isAdmin }) => {
    const { rows } = await client.query(
        `SELECT id, user_id, title FROM routes
          WHERE id = $1 AND (user_id = $2 OR $3 = TRUE)`,
        [routeId, userId, isAdmin]
    );

    return rows[0] ?? null;
}

/**
 * El guard del lado alumno, complementario de findRouteForOwner: deja pasar a cualquiera si
 * la ruta esta publicada, y solo al autor (o un admin) si no lo esta. findRouteForOwner no
 * sirve aqui porque es solo-dueño y bloquearia a todos los que vienen a aprender.
 *
 * Devuelve user_id porque el que llama lo necesita para dos cosas: distinguir al autor y
 * aplicar la regla de que el contenido propio no da XP.
 */
export const findRouteForConsumer = async (client, { routeId, userId, isAdmin }) => {
    const { rows } = await client.query(
        `SELECT id, user_id, is_published FROM routes
          WHERE id = $1 AND (is_published = 'PUBLIC' OR user_id = $2 OR $3 = TRUE)`,
        [routeId, userId, isAdmin]
    );

    return rows[0] ?? null;
}

export const findRouteById = async (client, routeId) => {
    const { rows } = await client.query(
        `SELECT r.*, u.name AS author_name, u.image AS author_image, u.is_verified AS author_verified,
                t.slug AS topic_slug, t.name AS topic_name
           FROM routes r
           JOIN users u  ON u.id = r.user_id
           JOIN topics t ON t.id = r.topic_id
          WHERE r.id = $1`,
        [routeId]
    );

    return rows[0] ?? null;
}

/**
 * Lecciones y quizzes ya intercalados en el orden real de la ruta. El sub_pos = 0 de las
 * lecciones garantiza que la leccion salga antes que los quizzes colgados de ella, y un
 * quiz sin leccion (after_lesson_id NULL) cae al final. created_at desempata entre varios
 * quizzes finales, que es el unico caso donde uq_quizzes_slot no impone unicidad.
 */
export const getRouteOutline = async (client, routeId) => {
    const { rows } = await client.query(
        `SELECT 'LESSON' AS item_type, l.id, l.title, l.content_type,
                l.position AS lesson_pos, 0 AS sub_pos, l.created_at
           FROM lessons l
          WHERE l.route_id = $1
          UNION ALL
         SELECT 'QUIZ', q.id, q.title, NULL,
                COALESCE(l.position, 2147483647), q.position, q.created_at
           FROM quizzes q
           LEFT JOIN lessons l ON l.id = q.after_lesson_id
          WHERE q.route_id = $1
          ORDER BY lesson_pos, sub_pos, created_at`,
        [routeId]
    );

    return rows.map(({ item_type, id, title, content_type }) => ({
        type: item_type,
        id,
        title,
        ...(item_type === 'LESSON' ? { contentType: content_type } : {}),
    }));
}

export const listPublishedRoutes = async (client, { take, skip }) => {
    const { rows } = await client.query(
        `SELECT r.id, r.title, r.description, r.image, r.rating_avg, r.rating_count,
                r.enrollment_count, r.completion_count, r.created_at, r.topic_id,
                u.name AS author_name, u.is_verified AS author_verified,
                t.slug AS topic_slug, t.name AS topic_name
           FROM routes r
           JOIN users u  ON u.id = r.user_id
           JOIN topics t ON t.id = r.topic_id
          WHERE r.is_published = 'PUBLIC'
          ORDER BY r.created_at DESC
          LIMIT $1 OFFSET $2`,
        [take, skip]
    );

    return rows;
}

/**
 * Las rutas de un autor tal y como las ve otro usuario. No vale listRoutesByUser, que es el
 * "mis rutas" del propio autor y por eso devuelve tambien las PRIVATE.
 */
export const listPublicRoutesByUser = async (client, { userId, take, skip }) => {
    const { rows } = await client.query(
        `SELECT r.id, r.title, r.description, r.image, r.rating_avg, r.rating_count,
                r.enrollment_count, r.completion_count, r.created_at, r.topic_id,
                u.name AS author_name, u.is_verified AS author_verified,
                t.slug AS topic_slug, t.name AS topic_name
           FROM routes r
           JOIN users u  ON u.id = r.user_id
           JOIN topics t ON t.id = r.topic_id
          WHERE r.is_published = 'PUBLIC' AND r.user_id = $1
          ORDER BY r.created_at DESC
          LIMIT $2 OFFSET $3`,
        [userId, take, skip]
    );

    return rows;
}

export const listRoutesByUser = async (client, { userId, take, skip }) => {
    const { rows } = await client.query(
        `SELECT r.id, r.title, r.description, r.image, r.is_published, r.rating_avg,
                r.rating_count, r.enrollment_count, r.completion_count, r.created_at, r.topic_id,
                t.slug AS topic_slug, t.name AS topic_name
           FROM routes r
           JOIN topics t ON t.id = r.topic_id
          WHERE r.user_id = $1
          ORDER BY r.created_at DESC
          LIMIT $2 OFFSET $3`,
        [userId, take, skip]
    );

    return rows;
}

export const updateRouteById = async (client, { id, userId, isAdmin, title, description, topicId }) => {
    const { rows } = await client.query(
        `UPDATE routes
            SET title       = COALESCE($4, title),
                description = COALESCE($5, description),
                topic_id    = COALESCE($6, topic_id)
          WHERE id = $1 AND (user_id = $2 OR $3 = TRUE)
          RETURNING id, title, description, image, is_published, topic_id`,
        [id, userId, isAdmin, title, description, topicId]
    );

    return rows[0] ?? null;
}

export const publishRouteById = async (client, { id, userId, isAdmin, status }) => {
    const { rows } = await client.query(
        `UPDATE routes SET is_published = $4
          WHERE id = $1 AND (user_id = $2 OR $3 = TRUE)
          RETURNING id, is_published`,
        [id, userId, isAdmin, status]
    );

    return rows[0] ?? null;
}

export const countRouteLessons = async (client, routeId) => {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM lessons WHERE route_id = $1`,
        [routeId]
    );

    return rows[0].n;
}

/**
 * Se valida el subject aparte en vez de dejar que reviente la FK: un 23503 no esta en el
 * mapa de ERROR_STATUS, asi que saldria como un 500 en lugar de un 404 con su mensaje.
 */
export const findTopicById = async (client, topicId) => {
    const { rows } = await client.query(
        `SELECT id, slug, name FROM topics WHERE id = $1`,
        [topicId]
    );

    return rows[0] ?? null;
}

// Las catorce materias son un unico nivel, sin agrupacion por encima, asi que el orden es
// alfabetico. El orden con el que /explore pinta su rejilla es cosa del cliente.
export const listTopics = async (client) => {
    const { rows } = await client.query(
        `SELECT id, slug, name FROM topics ORDER BY name`
    );

    return rows;
}

/**
 * Recoge todas las keys de S3 que cuelgan de una ruta. Hay que llamarla ANTES del DELETE:
 * el cascade se lleva lessons -> lesson_blocks y quizzes -> quiz_questions en silencio, y
 * despues ya no queda ninguna referencia a esos objetos en ninguna parte.
 */
export const collectRouteAttachmentKeys = async (client, routeId) => {
    const { rows } = await client.query(
        `SELECT image AS key FROM routes
          WHERE id = $1 AND image IS NOT NULL
         UNION ALL
         SELECT lb.url FROM lesson_blocks lb
           JOIN lessons l ON l.id = lb.lesson_id
          WHERE l.route_id = $1 AND lb.url IS NOT NULL
         UNION ALL
         SELECT qq.image FROM quiz_questions qq
           JOIN quizzes q ON q.id = qq.quiz_id
          WHERE q.route_id = $1 AND qq.image IS NOT NULL`,
        [routeId]
    );

    return rows.map((row) => row.key);
}

export const deleteRouteById = async (client, { id, userId, isAdmin }) => {
    const { rows } = await client.query(
        `DELETE FROM routes
          WHERE id = $1 AND (user_id = $2 OR $3 = TRUE)
          RETURNING id`,
        [id, userId, isAdmin]
    );

    return rows[0] ?? null;
}

/**
 * El CTE ve el snapshot anterior al UPDATE, asi que devuelve la key vieja para poder
 * encolarla. Una subconsulta dentro del RETURNING daria lo mismo pero por un detalle
 * sutil de evaluacion; el CTE lo deja explicito.
 */
export const updateRouteImage = async (client, { id, userId, isAdmin, image }) => {
    const { rows } = await client.query(
        `WITH previous AS (SELECT image FROM routes WHERE id = $1)
         UPDATE routes r
            SET image = $4
           FROM previous
          WHERE r.id = $1 AND (r.user_id = $2 OR $3 = TRUE)
          RETURNING previous.image AS old_key, r.image AS new_key`,
        [id, userId, isAdmin, image]
    );

    return rows[0] ?? null;
}
