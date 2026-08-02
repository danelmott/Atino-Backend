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
        `SELECT id, email, email_verified, name, image, role, timezone, created_at
           FROM users WHERE id = $1`,
        [userId]
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
