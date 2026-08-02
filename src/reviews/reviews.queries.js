/**
 * Estrellas de una ruta. No hay agregacion que mantener aqui: el trigger
 * trg_route_ratings_refresh recalcula routes.rating_avg y routes.rating_count solo, en
 * cada INSERT, UPDATE y DELETE de esta tabla.
 */

/** Una puntuacion por usuario y ruta, editable: por eso es upsert y no insert. */
export const upsertRouteRating = async (client, { routeId, userId, rating }) => {
    const { rows } = await client.query(
        `INSERT INTO route_ratings (route_id, user_id, rating)
         VALUES ($1, $2, $3)
         ON CONFLICT (route_id, user_id) DO UPDATE SET rating = EXCLUDED.rating
         RETURNING route_id, rating, created_at, updated_at`,
        [routeId, userId, rating]
    );

    return rows[0];
}

export const deleteRouteRating = async (client, { routeId, userId }) => {
    const { rowCount } = await client.query(
        `DELETE FROM route_ratings WHERE route_id = $1 AND user_id = $2`,
        [routeId, userId]
    );

    return rowCount > 0;
}

export const findRouteRating = async (client, { routeId, userId }) => {
    const { rows } = await client.query(
        `SELECT rating, created_at, updated_at FROM route_ratings
          WHERE route_id = $1 AND user_id = $2`,
        [routeId, userId]
    );

    return rows[0] ?? null;
}

/**
 * La media desnormalizada que ya vive en routes, mas el desglose por estrella para pintar
 * las barritas del histograma. rating_avg es NUMERIC, que `pg` devuelve como string: se
 * castea aqui y no en el servicio, igual que el resto del codebase hace COUNT(*)::int.
 */
export const getRouteRatingSummary = async (client, routeId) => {
    const { rows } = await client.query(
        `SELECT r.rating_avg::float8 AS rating_avg,
                r.rating_count,
                COALESCE(
                    (SELECT json_object_agg(rating, n)
                       FROM (SELECT rating, COUNT(*)::int AS n
                               FROM route_ratings WHERE route_id = $1
                              GROUP BY rating) breakdown),
                    '{}'
                ) AS breakdown
           FROM routes r WHERE r.id = $1`,
        [routeId]
    );

    return rows[0] ?? null;
}
