/**
 * La recomendacion es UNA sola consulta y no varias mas un merge en JS, por una razon
 * concreta: hay que paginar sobre el resultado ORDENADO. Traer candidatas por separado y
 * puntuarlas en Node obligaria a bajarse la tabla entera de rutas publicas en cada peticion
 * para poder aplicar el LIMIT/OFFSET al final.
 *
 * Los pesos entran como parametros ($4 en adelante) en vez de estar incrustados en el SQL,
 * asi que reajustar el balance del feed es tocar FEED_WEIGHTS y nada mas.
 */
export const recommendRoutes = async (client, { userId, take, skip, weights }) => {
    const { rows } = await client.query(
        `WITH pref AS (
            SELECT subject_slug FROM user_subject_preferences WHERE user_id = $1
         ),
         -- Afinidad por consumo: de que materias son las rutas que el usuario ya empezo.
         -- Se normaliza contra 5 y se corta en 1 para que alguien con 40 rutas de un mismo
         -- tema no aplaste al resto de senales y acabe viendo siempre lo mismo.
         affinity AS (
            SELECT r.subject_slug, LEAST(COUNT(*)::numeric / 5.0, 1.0) AS norm
              FROM route_enrollments re
              JOIN routes r ON r.id = re.route_id
             WHERE re.user_id = $1
             GROUP BY r.subject_slug
         ),
         -- Las que ya termino se excluyen; las empezadas y sin terminar solo bajan.
         mine AS (
            SELECT route_id, completed_at FROM route_enrollments WHERE user_id = $1
         ),
         -- Autores que sigue. Sirve para dos cosas a la vez: el termino del score y el
         -- isFollowing de la tarjeta, que si no obligaria a otra consulta desde el front.
         followed AS (
            SELECT following_id FROM user_follows WHERE follower_id = $1
         )
         SELECT r.id, r.title, r.description, r.image, r.rating_avg, r.rating_count,
                r.enrollment_count, r.completion_count, r.created_at, r.subject_slug,
                r.user_id AS author_id,
                u.name AS author_name,
                u.username AS author_username,
                u.is_verified AS author_verified,
                (f.following_id IS NOT NULL) AS author_followed,
                s.name AS subject_name,
                (mine.route_id IS NOT NULL) AS started,
                (
                    $4::numeric * (CASE WHEN p.subject_slug  IS NOT NULL THEN 1 ELSE 0 END)
                  + $5::numeric * (CASE WHEN f.following_id  IS NOT NULL THEN 1 ELSE 0 END)
                  + $6::numeric * COALESCE(a.norm, 0)
                  -- Amortiguacion bayesiana: sin el factor n/(n+5), una ruta con un solo
                  -- 5 estrellas se colaria por delante de otra con cincuenta 4,5.
                  + $7::numeric * (r.rating_avg / 5.0)
                                * (r.rating_count::numeric / (r.rating_count + 5))
                  + $8::numeric * exp(-EXTRACT(EPOCH FROM (now() - r.created_at)) / 2592000.0)
                  + $9::numeric * (CASE WHEN mine.route_id  IS NOT NULL THEN 1 ELSE 0 END)
                ) AS score
           FROM routes r
           JOIN users    u ON u.id = r.user_id
           JOIN subjects s ON s.slug = r.subject_slug
           LEFT JOIN pref     p ON p.subject_slug = r.subject_slug
           LEFT JOIN affinity a ON a.subject_slug = r.subject_slug
           LEFT JOIN mine       ON mine.route_id  = r.id
           LEFT JOIN followed f ON f.following_id = r.user_id
          WHERE r.is_published = 'PUBLIC'
            -- No tiene sentido recomendarle al autor su propia ruta, en la misma linea que
            -- "el contenido propio no da XP" del modulo de gamificacion.
            AND r.user_id <> $1
            AND mine.completed_at IS NULL
          ORDER BY score DESC, r.created_at DESC, r.id
          LIMIT $2 OFFSET $3`,
        [
            userId,
            take,
            skip,
            weights.preference,
            weights.following,
            weights.affinity,
            weights.quality,
            weights.freshness,
            weights.enrolled,
        ]
    );

    return rows;
}
