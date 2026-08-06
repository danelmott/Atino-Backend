/**
 * Igual que uploads.queries.js, todas estas funciones reciben el `client` de una
 * transaccion en curso y no el pool: ganar XP tiene que ser atomico con la accion que
 * lo genera, o un fallo a medias deja al usuario con la leccion completada y sin premio.
 */

/**
 * Crea la fila de stats si no existia y en cualquier caso la deja bloqueada hasta el final
 * de la transaccion. Es un ON CONFLICT DO UPDATE y no un DO NOTHING a proposito: el
 * DO NOTHING no devuelve fila ni toma lock cuando choca, y ese lock es justo lo que
 * serializa a un mismo usuario y hace que el deduplicado de XP no tenga carreras.
 *
 * Devuelve las fechas como TEXT porque `pg` convierte DATE en un Date de JS a medianoche
 * local, y al serializarlo a JSON se corre un dia en las zonas con offset negativo.
 */
export const lockUserStats = async (client, userId) => {
    const { rows } = await client.query(
        `WITH locked AS (
             INSERT INTO user_stats (user_id) VALUES ($1)
             ON CONFLICT (user_id) DO UPDATE SET user_id = user_stats.user_id
             RETURNING user_id, xp, current_streak, longest_streak, last_activity_date
         )
         SELECT l.xp,
                l.current_streak,
                l.longest_streak,
                to_char(l.last_activity_date, 'YYYY-MM-DD')       AS last_activity_date,
                to_char(now() AT TIME ZONE u.timezone, 'YYYY-MM-DD') AS today,
                to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')      AS season
           FROM locked l JOIN users u ON u.id = l.user_id`,
        [userId]
    );

    return rows[0] ?? null;
}

/** Solo mira filas con xp > 0: las de 0 XP son las del heatmap y si pueden repetirse. */
export const hasEarnedXpFor = async (client, { userId, eventType, targetId }) => {
    const { rows } = await client.query(
        `SELECT 1 FROM activity_events
          WHERE user_id = $1 AND event_type = $2 AND target_id = $3 AND xp > 0`,
        [userId, eventType, targetId]
    );

    return rows.length > 0;
}

export const insertActivityEvent = async (client, { userId, eventType, targetId, xp, activityDate }) => {
    const { rows } = await client.query(
        `INSERT INTO activity_events (user_id, event_type, target_id, xp, activity_date)
         VALUES ($1, $2, $3, $4, $5::date)
         RETURNING id, xp, to_char(activity_date, 'YYYY-MM-DD') AS activity_date`,
        [userId, eventType, targetId, xp, activityDate]
    );

    return rows[0];
}

/**
 * Suma el XP y recalcula la racha en una sola sentencia. En un UPDATE todas las columnas
 * del lado derecho ven el valor ANTERIOR, asi que next_streak() lee el last_activity_date
 * viejo aunque la misma sentencia lo este pisando.
 * GREATEST en Postgres ignora los NULL, de modo que el primer evento de la vida del
 * usuario no necesita ningun caso especial.
 */
export const applyActivityToStats = async (client, { userId, xp, day }) => {
    const { rows } = await client.query(
        `UPDATE user_stats
            SET xp                 = xp + $2,
                current_streak     = next_streak(last_activity_date, $3::date, current_streak),
                longest_streak     = GREATEST(longest_streak,
                                              next_streak(last_activity_date, $3::date, current_streak)),
                last_activity_date = GREATEST(last_activity_date, $3::date)
          WHERE user_id = $1
          RETURNING xp, current_streak, longest_streak,
                    to_char(last_activity_date, 'YYYY-MM-DD') AS last_activity_date`,
        [userId, xp, day]
    );

    return rows[0];
}


// ============================================================
//  TEMPORADA Y COHORTES
// ============================================================

/** Devuelve null si el usuario todavia no entro a esta temporada. */
export const addSeasonXp = async (client, { season, userId, xp }) => {
    const { rows } = await client.query(
        `UPDATE ranking_members SET xp = xp + $3
          WHERE season = $1 AND user_id = $2
          RETURNING xp, cohort_id`,
        [season, userId, xp]
    );

    return rows[0] ?? null;
}

/**
 * SKIP LOCKED en vez de esperar: si dos usuarios entran a la vez y la ultima cohorte esta
 * casi llena, el segundo abre una nueva en lugar de bloquearse. Puede quedar una cohorte
 * con hueco, que es infinitamente mejor que una por encima del tope o dos altas serializadas.
 */
export const claimOpenCohort = async (client, { season, league, size }) => {
    const { rows } = await client.query(
        `SELECT id FROM ranking_cohorts
          WHERE season = $1 AND league = $2 AND member_count < $3
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [season, league, size]
    );

    return rows[0] ?? null;
}

export const insertCohort = async (client, { season, league }) => {
    const { rows } = await client.query(
        `INSERT INTO ranking_cohorts (season, league) VALUES ($1, $2) RETURNING id`,
        [season, league]
    );

    return rows[0];
}

export const insertSeasonMember = async (client, { season, userId, cohortId, league, xp }) => {
    const { rows } = await client.query(
        `INSERT INTO ranking_members (season, user_id, cohort_id, league, xp)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (season, user_id) DO UPDATE SET xp = ranking_members.xp + EXCLUDED.xp
         RETURNING (xmax = 0) AS inserted, cohort_id`,
        [season, userId, cohortId, league, xp]
    );

    return rows[0];
}

export const incrementCohortCount = async (client, cohortId) => {
    await client.query(
        `UPDATE ranking_cohorts SET member_count = member_count + 1 WHERE id = $1`,
        [cohortId]
    );
}


// ============================================================
//  LECTURAS
// ============================================================

/**
 * LEFT JOIN y no INNER: un usuario recien registrado no tiene fila en user_stats y su
 * perfil tiene que responder ceros, no un 404.
 */
export const findUserStats = async (client, userId) => {
    const { rows } = await client.query(
        `SELECT u.id, u.name, u.username, u.image, u.is_verified,
                COALESCE(s.xp, 0)             AS xp,
                COALESCE(s.current_streak, 0) AS current_streak,
                COALESCE(s.longest_streak, 0) AS longest_streak,
                to_char(s.last_activity_date, 'YYYY-MM-DD') AS last_activity_date
           FROM users u LEFT JOIN user_stats s ON s.user_id = u.id
          WHERE u.id = $1`,
        [userId]
    );

    return rows[0] ?? null;
}

/**
 * Un renglon por dia CON actividad; los huecos los rellena el servicio. Los limites por
 * defecto se resuelven aqui contra la zona del usuario, para que "hoy" sea el mismo hoy que
 * usa la racha y el ultimo cuadrito no aparezca ya en el futuro.
 * La fecha sale como TEXT: un DATE llega a JS como Date a medianoche local y al serializarlo
 * se corre un dia en las zonas con offset negativo, que es justo el bug de "el heatmap va
 * corrido un dia".
 */
export const getActivityDays = async (client, { userId, from, to }) => {
    const { rows } = await client.query(
        `WITH bounds AS (
             SELECT COALESCE($2::date, (now() AT TIME ZONE u.timezone)::date - 370) AS from_day,
                    COALESCE($3::date, (now() AT TIME ZONE u.timezone)::date)       AS to_day
               FROM users u WHERE u.id = $1
         )
         SELECT to_char(e.activity_date, 'YYYY-MM-DD') AS date,
                COUNT(*)::int                          AS count,
                SUM(e.xp)::int                         AS xp,
                (SELECT to_char(from_day, 'YYYY-MM-DD') FROM bounds) AS from_day,
                (SELECT to_char(to_day,   'YYYY-MM-DD') FROM bounds) AS to_day
           FROM activity_events e, bounds b
          WHERE e.user_id = $1
            AND e.activity_date BETWEEN b.from_day AND b.to_day
          GROUP BY e.activity_date
          ORDER BY e.activity_date`,
        [userId, from ?? null, to ?? null]
    );

    return rows;
}

/** Los limites cuando no hubo ni un solo evento y la consulta de arriba vuelve vacia. */
export const getActivityBounds = async (client, { userId, from, to }) => {
    const { rows } = await client.query(
        `SELECT to_char(COALESCE($2::date, (now() AT TIME ZONE u.timezone)::date - 370), 'YYYY-MM-DD') AS from_day,
                to_char(COALESCE($3::date, (now() AT TIME ZONE u.timezone)::date), 'YYYY-MM-DD')       AS to_day
           FROM users u WHERE u.id = $1`,
        [userId, from ?? null, to ?? null]
    );

    return rows[0] ?? null;
}


// ============================================================
//  RANKING
// ============================================================

export const findSeasonMembership = async (client, { season, userId }) => {
    const { rows } = await client.query(
        `SELECT cohort_id, league, xp FROM ranking_members
          WHERE season = $1 AND user_id = $2`,
        [season, userId]
    );

    return rows[0] ?? null;
}

/** RANK() y no ROW_NUMBER(): dos usuarios con el mismo XP comparten posicion. */
export const listCohort = async (client, cohortId) => {
    const { rows } = await client.query(
        `SELECT m.user_id, u.name, u.username, u.image, u.is_verified, m.xp, m.league,
                RANK() OVER (ORDER BY m.xp DESC)::int AS position
           FROM ranking_members m JOIN users u ON u.id = m.user_id
          WHERE m.cohort_id = $1
          ORDER BY m.xp DESC, u.name`,
        [cohortId]
    );

    return rows;
}

/**
 * Posicion, superados y total en UNA sola consulta a proposito: en dos viajes distintos los
 * numeros pueden venir de estados diferentes y dar un porcentaje por encima de 100.
 */
export const getCohortStanding = async (client, { cohortId, xp }) => {
    const { rows } = await client.query(
        `SELECT COUNT(*) FILTER (WHERE xp > $2)::int + 1 AS position,
                COUNT(*) FILTER (WHERE xp < $2)::int     AS beaten,
                COUNT(*)::int                            AS total
           FROM ranking_members WHERE cohort_id = $1`,
        [cohortId, xp]
    );

    return rows[0];
}

/** total cuenta filas de user_stats, o sea gente que alguna vez hizo algo. */
export const getGlobalStanding = async (client, xp) => {
    const { rows } = await client.query(
        `SELECT COUNT(*) FILTER (WHERE xp > $1)::int + 1 AS position,
                COUNT(*) FILTER (WHERE xp < $1)::int     AS beaten,
                COUNT(*)::int                            AS total
           FROM user_stats`,
        [xp]
    );

    return rows[0];
}

/** La ventana de RANK() se calcula antes del LIMIT, asi que las posiciones son absolutas. */
export const listGlobalRanking = async (client, { take, skip }) => {
    const { rows } = await client.query(
        `SELECT s.user_id, u.name, u.username, u.image, u.is_verified, s.xp, s.current_streak,
                RANK() OVER (ORDER BY s.xp DESC)::int AS position
           FROM user_stats s JOIN users u ON u.id = s.user_id
          ORDER BY s.xp DESC, u.name
          LIMIT $1 OFFSET $2`,
        [take, skip]
    );

    return rows;
}

export const findUserCounters = async (client, userId) => {
    const { rows } = await client.query(
        `SELECT (SELECT COUNT(*)::int FROM lesson_completions WHERE user_id = $1)
                    AS lessons_completed,
                (SELECT COUNT(DISTINCT quiz_id)::int FROM quiz_attempts
                  WHERE user_id = $1 AND completed_at IS NOT NULL)
                    AS quizzes_completed,
                (SELECT COUNT(*)::int FROM routes WHERE user_id = $1)
                    AS routes_created,
                (SELECT COUNT(*)::int FROM route_enrollments WHERE user_id = $1)
                    AS routes_enrolled,
                (SELECT COUNT(*)::int FROM route_enrollments
                  WHERE user_id = $1 AND completed_at IS NOT NULL)
                    AS routes_completed`,
        [userId]
    );

    return rows[0];
}
