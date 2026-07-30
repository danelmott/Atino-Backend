import { dbConnection, withTransaction } from '../../database/connection.js';

export const findAccountsByUserId = async (userId) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM accounts WHERE user_id = $1`,
        [userId]
    );
    return rows;
}

export const linkGoogleAccountToUser = async ({ userId, image }) => {
    return withTransaction(async (client) => {
        const { rows } = await client.query(
            `UPDATE users
                SET email_verified = TRUE, image = COALESCE(image, $2)
                WHERE id = $1
             RETURNING *`,
            [userId, image]
        );
        const user = rows[0] ?? null;

        await client.query(
            `INSERT INTO accounts (user_id, provider) VALUES ($1, 'GOOGLE')`,
            [userId]
        );

        return user;
    });
}

export const createUserWithGoogleAccount = async ({ email, name, image }) => {
    return withTransaction(async (client) => {
        const { rows } = await client.query(
            `INSERT INTO users (email, name, image, email_verified)
                VALUES ($1, $2, $3, TRUE)
             RETURNING *`,
            [email, name, image]
        );
        const user = rows[0];

        await client.query(
            `INSERT INTO accounts (user_id, provider) VALUES ($1, 'GOOGLE')`,
            [user.id]
        );

        return user;
    });
}

export const createLocalUser = async ({ email, hashedPassword }) => {
    return withTransaction(async (client) => {
        const { rows } = await client.query(
            `INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *`,
            [email, hashedPassword]
        );
        const user = rows[0];

        await client.query(
            `INSERT INTO accounts (user_id, provider) VALUES ($1, 'LOCAL')`,
            [user.id]
        );

        return user;
    });
}

export const attachLocalCredentialsToUser = async ({ userId, hashedPassword }) => {
    return withTransaction(async (client) => {
        const { rows } = await client.query(
            `UPDATE users SET password = $2 WHERE id = $1 RETURNING *`,
            [userId, hashedPassword]
        );
        const user = rows[0] ?? null;

        await client.query(
            `INSERT INTO accounts (user_id, provider) VALUES ($1, 'LOCAL')`,
            [userId]
        );

        return user;
    });
}

export const markUserEmailVerified = async (userId, client = dbConnection) => {
    const { rows } = await client.query(
        `UPDATE users SET email_verified = TRUE WHERE id = $1 RETURNING *`,
        [userId]
    );
    return rows[0] ?? null;
}

export const createRefreshToken = async ({ userId, token, expiresAt }, client = dbConnection) => {
    const { rows } = await client.query(
        `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING *`,
        [userId, token, expiresAt]
    );
    return rows[0];
}

export const findRefreshTokenByToken = async (token) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM refresh_tokens WHERE token = $1`,
        [token]
    );
    return rows[0] ?? null;
}

export const findLatestRefreshTokenByUserId = async (userId) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    return rows[0] ?? null;
}

export const deleteRefreshTokenForUser = async (userId, token) => {
    await dbConnection.query(
        `DELETE FROM refresh_tokens WHERE user_id = $1 AND token = $2`,
        [userId, token]
    );
}

export const deleteAllRefreshTokensForUser = async (userId) => {
    await dbConnection.query(
        `DELETE FROM refresh_tokens WHERE user_id = $1`,
        [userId]
    );
}

export const createVerificationCode = async ({ userId, hashedCode, expiresAt }) => {
    const { rows } = await dbConnection.query(
        `INSERT INTO verification_codes (user_id, code, expires_at) VALUES ($1, $2, $3) RETURNING *`,
        [userId, hashedCode, expiresAt]
    );
    return rows[0];
}

export const findLatestUnusedVerificationCode = async (userId) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM verification_codes
         WHERE user_id = $1 AND used_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    return rows[0] ?? null;
}

export const invalidateUnusedVerificationCodes = async (userId, client = dbConnection) => {
    await client.query(
        `UPDATE verification_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
        [userId]
    );
}
