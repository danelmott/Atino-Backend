/**
 * Los contadores de users (followers_count / following_count) NO se tocan desde aqui: los
 * mantiene el trigger trg_user_follows_refresh en cada INSERT y DELETE de esta tabla.
 */

/** Existencia a secas, para dar un 404 legible en vez del 23503 de la FK, que seria un 500. */
export const userExists = async (client, userId) => {
    const { rows } = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);

    return rows.length > 0;
}

/**
 * ON CONFLICT DO NOTHING para que seguir dos veces no sea un 409: el mapeo global del 23505
 * convertiria el doble clic en un error, el mismo problema que ya resolvio lesson_completions.
 */
export const insertFollow = async (client, { followerId, followingId }) => {
    await client.query(
        `INSERT INTO user_follows (follower_id, following_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [followerId, followingId]
    );
}

export const deleteFollow = async (client, { followerId, followingId }) => {
    const { rowCount } = await client.query(
        `DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2`,
        [followerId, followingId]
    );

    return rowCount > 0;
}

export const findFollow = async (client, { followerId, followingId }) => {
    const { rows } = await client.query(
        `SELECT created_at FROM user_follows WHERE follower_id = $1 AND following_id = $2`,
        [followerId, followingId]
    );

    return rows[0] ?? null;
}

/** Se leen despues de escribir, cuando el trigger ya los ha recalculado. */
export const getFollowCounts = async (client, userId) => {
    const { rows } = await client.query(
        `SELECT followers_count, following_count FROM users WHERE id = $1`,
        [userId]
    );

    return rows[0] ?? null;
}

/**
 * Las dos listas son la misma consulta con el JOIN invertido. El LEFT JOIN contra `mine`
 * resuelve, por cada fila, si el que mira ya sigue a esa persona: sin el, el front tendria
 * que pedir el estado de cada boton por separado.
 */
export const listFollowers = async (client, { userId, viewerId, take, skip }) => {
    const { rows } = await client.query(
        `SELECT u.id, u.name, u.image, u.is_verified, u.followers_count,
                uf.created_at AS followed_at,
                (mine.follower_id IS NOT NULL) AS is_following
           FROM user_follows uf
           JOIN users u ON u.id = uf.follower_id
           LEFT JOIN user_follows mine
                  ON mine.follower_id = $2 AND mine.following_id = u.id
          WHERE uf.following_id = $1
          ORDER BY uf.created_at DESC
          LIMIT $3 OFFSET $4`,
        [userId, viewerId, take, skip]
    );

    return rows;
}

export const listFollowing = async (client, { userId, viewerId, take, skip }) => {
    const { rows } = await client.query(
        `SELECT u.id, u.name, u.image, u.is_verified, u.followers_count,
                uf.created_at AS followed_at,
                (mine.follower_id IS NOT NULL) AS is_following
           FROM user_follows uf
           JOIN users u ON u.id = uf.following_id
           LEFT JOIN user_follows mine
                  ON mine.follower_id = $2 AND mine.following_id = u.id
          WHERE uf.follower_id = $1
          ORDER BY uf.created_at DESC
          LIMIT $3 OFFSET $4`,
        [userId, viewerId, take, skip]
    );

    return rows;
}
