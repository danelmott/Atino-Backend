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

export const updateUserImage = async (userId, image) => {
    const { rows } = await dbConnection.query(
        `UPDATE users SET image = $2 WHERE id = $1 RETURNING *`,
        [userId, image]
    );
    return rows[0] ?? null;
}
