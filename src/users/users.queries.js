import { dbConnection } from '../../database/connection.js';

export const findUserById = async (id) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM users WHERE id = $1`,
        [id]
    );
    return rows[0] ?? null;
}

export const findUserByEmail = async (email) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM users WHERE email = $1`,
        [email]
    );
    return rows[0] ?? null;
}

/**
 * Las tres funciones de abajo siguen la convencion nueva (client primero); las de arriba
 * son las viejas, que consume `auth` y no se tocan para no arrastrarlo a un refactor.
 */

export const findUserProfile = async (client, userId) => {
    const { rows } = await client.query(
        `SELECT id, email, email_verified, name, username, image, role, timezone, is_verified,
                onboarding_completed_at, followers_count, following_count, created_at
           FROM users WHERE id = $1`,
        [userId]
    );

    return rows[0] ?? null;
}

/**
 * El perfil que ve OTRO usuario. Deliberadamente no selecciona email, role, timezone ni
 * onboarding_completed_at: eso es de findUserProfile y solo sale por /users/me.
 *
 * Los dos LEFT JOIN resuelven la relacion en las dos direcciones de una sola pasada: si yo
 * le sigo (is_following, el estado del boton) y si el me sigue a mi (follows_you, el "te
 * sigue" de la ficha).
 */
export const findPublicProfile = async (client, { userId, viewerId }) => {
    const { rows } = await client.query(
        `SELECT u.id, u.name, u.username, u.image, u.is_verified, u.followers_count, u.following_count, u.created_at,
                (mine.follower_id   IS NOT NULL) AS is_following,
                (theirs.follower_id IS NOT NULL) AS follows_you
           FROM users u
           LEFT JOIN user_follows mine
                  ON mine.follower_id = $2 AND mine.following_id = u.id
           LEFT JOIN user_follows theirs
                  ON theirs.follower_id = u.id AND theirs.following_id = $2
          WHERE u.id = $1`,
        [userId, viewerId]
    );

    return rows[0] ?? null;
}

/**
 * El mismo perfil resuelto por handle en vez de por uuid, que es como enruta el front
 * (/profile/danel-mantilla). Se repite el SELECT en vez de parametrizar la columna del WHERE
 * porque lo segundo obliga a interpolar un identificador en el SQL, y eso es justo lo que los
 * bind params existen para evitar.
 */
export const findPublicProfileByUsername = async (client, { username, viewerId }) => {
    const { rows } = await client.query(
        `SELECT u.id, u.name, u.username, u.image, u.is_verified, u.followers_count, u.following_count, u.created_at,
                (mine.follower_id   IS NOT NULL) AS is_following,
                (theirs.follower_id IS NOT NULL) AS follows_you
           FROM users u
           LEFT JOIN user_follows mine
                  ON mine.follower_id = $2 AND mine.following_id = u.id
           LEFT JOIN user_follows theirs
                  ON theirs.follower_id = u.id AND theirs.following_id = $2
          WHERE u.username = $1`,
        [username, viewerId]
    );

    return rows[0] ?? null;
}

export const findUserIdByUsername = async (client, username) => {
    const { rows } = await client.query(
        `SELECT id FROM users WHERE username = $1`,
        [username]
    );

    return rows[0]?.id ?? null;
}

/**
 * La mitad de personas de /search. Busca contra `name` y NO contra `username`: el handle es un
 * detalle de enrutado que se genera solo, y nadie escribe "danel-mantilla" en un buscador.
 *
 * routes_count es una subconsulta y no un JOIN + GROUP BY porque agrupar obligaria a meter en
 * el GROUP BY las ocho columnas de users, y con ello el LEFT JOIN de `mine` empezaria a
 * multiplicar filas. Cuenta solo las publicas: son las que el que mira puede abrir.
 *
 * El LEFT JOIN contra `mine` resuelve por fila si el que mira ya sigue a esa persona, el mismo
 * patron de listFollowers, para que el boton de seguir se pinte sin N peticiones extra.
 */
export const searchUsers = async (client, { words, term, termLike, viewerId, take, skip }) => {
    const { rows } = await client.query(
        `SELECT u.id, u.name, u.username, u.image, u.is_verified, u.followers_count,
                (mine.follower_id IS NOT NULL) AS is_following,
                (SELECT COUNT(*)::int FROM routes r
                  WHERE r.user_id = u.id AND r.is_published = 'PUBLIC') AS routes_count
           FROM users u
           LEFT JOIN user_follows mine
                  ON mine.follower_id = $3 AND mine.following_id = u.id
          WHERE lower(atino_unaccent(coalesce(u.name, ''))) LIKE ALL ($4::text[])
          ORDER BY CASE
                       WHEN lower(atino_unaccent(u.name)) = $5                     THEN 4
                       WHEN lower(atino_unaccent(u.name)) LIKE $6 || '%'           THEN 3
                       WHEN lower(atino_unaccent(u.name)) LIKE '% ' || $6 || '%'   THEN 2
                       ELSE 1
                   END DESC,
                   u.followers_count DESC,
                   u.name
          LIMIT $1 OFFSET $2`,
        [take, skip, viewerId, words, term, termLike]
    );

    return rows;
}

export const updateUserVerified = async (client, { userId, verified }) => {
    const { rows } = await client.query(
        `UPDATE users SET is_verified = $2 WHERE id = $1 RETURNING id, name, is_verified`,
        [userId, verified]
    );

    return rows[0] ?? null;
}

export const updateUserName = async (client, { userId, name }) => {
    const { rows } = await client.query(
        `UPDATE users SET name = $2 WHERE id = $1 RETURNING id, name`,
        [userId, name]
    );

    return rows[0] ?? null;
}

/**
 * Sondea la zona contra Postgres antes de guardarla. No sobra pese a la validacion de zod:
 * el set de nombres de ICU que ve Node y el de pg_timezone_names no son identicos, y
 * "now() AT TIME ZONE <desconocida>" LANZA -- una sola fila mala dejaria a ese usuario sin
 * poder registrar actividad nunca mas, porque recordActivity usa justo esa expresion.
 */
export const probeTimezone = async (client, timezone) => {
    await client.query(`SELECT now() AT TIME ZONE $1`, [timezone]);
}

export const updateUserTimezone = async (client, { userId, timezone }) => {
    const { rows } = await client.query(
        `UPDATE users SET timezone = $2 WHERE id = $1 RETURNING id, timezone`,
        [userId, timezone]
    );

    return rows[0] ?? null;
}

export const updateUserImage = async (userId, image) => {
    const { rows } = await dbConnection.query(
        `UPDATE users SET image = $2 WHERE id = $1 RETURNING *`,
        [userId, image]
    );
    return rows[0] ?? null;
}


/* ===================== PREFERENCIAS DE SUBJECTS (ONBOARDING) ===================== */

export const getUserTopicPreferences = async (client, userId) => {
    const { rows } = await client.query(
        `SELECT t.id, t.slug, t.name
           FROM user_topic_preferences utp
           JOIN topics t ON t.id = utp.topic_id
          WHERE utp.user_id = $1
          ORDER BY t.name`,
        [userId]
    );

    return rows;
}

/** Cuenta cuantos de los ids recibidos existen de verdad, para no escribir basura. */
export const countExistingTopics = async (client, topicIds) => {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM topics WHERE id = ANY($1::uuid[])`,
        [topicIds]
    );

    return rows[0].n;
}

/** Reemplazo completo: se borra todo y se reinserta, para no tener que diffear en JS. */
export const replaceUserTopicPreferences = async (client, userId, topicIds) => {
    await client.query(`DELETE FROM user_topic_preferences WHERE user_id = $1`, [userId]);
    if (topicIds.length === 0) return;

    await client.query(
        `INSERT INTO user_topic_preferences (user_id, topic_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT DO NOTHING`,
        [userId, topicIds]
    );
}

/**
 * COALESCE y no `now()` a secas: el usuario puede volver a ajustar sus intereses desde
 * ajustes cuando quiera, y eso no debe reescribir la fecha en que completo el onboarding.
 */
export const markOnboardingCompleted = async (client, userId) => {
    const { rows } = await client.query(
        `UPDATE users
            SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
          WHERE id = $1
      RETURNING onboarding_completed_at`,
        [userId]
    );

    return rows[0] ?? null;
}
