import { dbConnection, withTransaction } from '../../database/connection.js';

const messageSelect = `
    m.id,
    m.message,
    m.created_at,
    m.updated_at,
    u.id AS user_id,
    u.name AS user_name,
    u.email AS user_email,
    u.image AS user_image,
    COUNT(DISTINCT l.user_id)::int AS like_count,
    COUNT(DISTINCT a.id)::int AS answer_count,
    EXISTS (
        SELECT 1 FROM feedback_message_likes ml
        WHERE ml.message_id = m.id AND ml.user_id = $1
    ) AS is_liked
`;

const answerSelect = `
    a.id,
    a.message,
    a.answered_message_id,
    a.created_at,
    a.updated_at,
    u.id AS user_id,
    u.name AS user_name,
    u.email AS user_email,
    u.image AS user_image,
    COUNT(DISTINCT al.user_id)::int AS like_count,
    EXISTS (
        SELECT 1 FROM feedback_answer_likes x
        WHERE x.answer_id = a.id AND x.user_id = $1
    ) AS is_liked
`;

export const listFeedbackMessages = async (userId, limit, offset) => {
    const { rows } = await dbConnection.query(
        `SELECT ${messageSelect}
         FROM feedback_messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN feedback_message_likes l ON l.message_id = m.id
         LEFT JOIN feedback_answers a ON a.answered_message_id = m.id
         GROUP BY m.id, u.id
         ORDER BY (COUNT(DISTINCT l.user_id) + COUNT(DISTINCT a.id)) DESC, m.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
    );
    return rows;
}

export const listAnswersForMessages = async (userId, messageIds) => {
    if (messageIds.length === 0) return [];

    const { rows } = await dbConnection.query(
        `SELECT ${answerSelect}
         FROM feedback_answers a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN feedback_answer_likes al ON al.answer_id = a.id
         WHERE a.answered_message_id = ANY($2::uuid[])
         GROUP BY a.id, u.id
         ORDER BY a.created_at ASC`,
        [userId, messageIds]
    );
    return rows;
}

export const getAnswersForMessage = async (userId, messageId) => {
    const { rows } = await dbConnection.query(
        `SELECT ${answerSelect}
         FROM feedback_answers a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN feedback_answer_likes al ON al.answer_id = a.id
         WHERE a.answered_message_id = $2
         GROUP BY a.id, u.id
         ORDER BY a.created_at ASC`,
        [userId, messageId]
    );
    return rows;
}

export const getMessageById = async (userId, id) => {
    const { rows } = await dbConnection.query(
        `SELECT ${messageSelect}
         FROM feedback_messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN feedback_message_likes l ON l.message_id = m.id
         LEFT JOIN feedback_answers a ON a.answered_message_id = m.id
         WHERE m.id = $2
         GROUP BY m.id, u.id`,
        [userId, id]
    );
    return rows[0] ?? null;
}

export const getAnswerById = async (userId, id) => {
    const { rows } = await dbConnection.query(
        `SELECT ${answerSelect}
         FROM feedback_answers a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN feedback_answer_likes al ON al.answer_id = a.id
         WHERE a.id = $2
         GROUP BY a.id, u.id`,
        [userId, id]
    );
    return rows[0] ?? null;
}

export const findMessageById = async (id) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM feedback_messages WHERE id = $1`,
        [id]
    );
    return rows[0] ?? null;
}

export const findAnswerById = async (id) => {
    const { rows } = await dbConnection.query(
        `SELECT * FROM feedback_answers WHERE id = $1`,
        [id]
    );
    return rows[0] ?? null;
}

export const createFeedbackMessage = async (userId, message) => {
    const { rows } = await dbConnection.query(
        `INSERT INTO feedback_messages (user_id, message) VALUES ($1, $2) RETURNING *`,
        [userId, message]
    );
    return rows[0];
}

export const createAnswer = async ({ userId, messageId, message }) => {
    const { rows } = await dbConnection.query(
        `INSERT INTO feedback_answers (user_id, answered_message_id, message) VALUES ($1, $2, $3) RETURNING *`,
        [userId, messageId, message]
    );
    return rows[0];
}

export const updateFeedbackMessage = async ({ id, userId, isAdmin, message }) => {
    const { rows } = await dbConnection.query(
        `UPDATE feedback_messages
         SET message = $1
         WHERE id = $2 AND (user_id = $3 OR $4 = true)
         RETURNING *`,
        [message, id, userId, isAdmin]
    );
    return rows[0] ?? null;
}

export const deleteFeedbackMessage = async ({ id, userId, isAdmin }) => {
    const { rows } = await dbConnection.query(
        `DELETE FROM feedback_messages
         WHERE id = $1 AND (user_id = $2 OR $3 = true)
         RETURNING id`,
        [id, userId, isAdmin]
    );
    return rows[0] ?? null;
}

export const updateAnswer = async ({ id, userId, isAdmin, message }) => {
    const { rows } = await dbConnection.query(
        `UPDATE feedback_answers
         SET message = $1
         WHERE id = $2 AND (user_id = $3 OR $4 = true)
         RETURNING *`,
        [message, id, userId, isAdmin]
    );
    return rows[0] ?? null;
}

export const deleteAnswer = async ({ id, userId, isAdmin }) => {
    const { rows } = await dbConnection.query(
        `DELETE FROM feedback_answers
         WHERE id = $1 AND (user_id = $2 OR $3 = true)
         RETURNING id`,
        [id, userId, isAdmin]
    );
    return rows[0] ?? null;
}

export const toggleMessageLike = async (userId, messageId) => withTransaction(async (client) => {
    const { rows: existingRows } = await client.query(
        `SELECT 1 FROM feedback_message_likes WHERE message_id = $1 AND user_id = $2`,
        [messageId, userId]
    );
    const alreadyLiked = existingRows.length > 0;

    if (alreadyLiked) {
        await client.query(
            `DELETE FROM feedback_message_likes WHERE message_id = $1 AND user_id = $2`,
            [messageId, userId]
        );
    } else {
        await client.query(
            `INSERT INTO feedback_message_likes (message_id, user_id) VALUES ($1, $2)`,
            [messageId, userId]
        );
    }

    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM feedback_message_likes WHERE message_id = $1`,
        [messageId]
    );

    return { liked: !alreadyLiked, likeCount: rows[0].count };
});

export const toggleAnswerLike = async (userId, answerId) => withTransaction(async (client) => {
    const { rows: existingRows } = await client.query(
        `SELECT 1 FROM feedback_answer_likes WHERE answer_id = $1 AND user_id = $2`,
        [answerId, userId]
    );
    const alreadyLiked = existingRows.length > 0;

    if (alreadyLiked) {
        await client.query(
            `DELETE FROM feedback_answer_likes WHERE answer_id = $1 AND user_id = $2`,
            [answerId, userId]
        );
    } else {
        await client.query(
            `INSERT INTO feedback_answer_likes (answer_id, user_id) VALUES ($1, $2)`,
            [answerId, userId]
        );
    }

    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count FROM feedback_answer_likes WHERE answer_id = $1`,
        [answerId]
    );

    return { liked: !alreadyLiked, likeCount: rows[0].count };
});
