import { withServiceError } from '../lib/withServiceError.js';
import {
    listFeedbackMessages,
    listAnswersForMessages,
    getAnswersForMessage as queryAnswersForMessage,
    getMessageById,
    getAnswerById,
    findMessageById,
    findAnswerById,
    createFeedbackMessage as insertFeedbackMessage,
    createAnswer as insertAnswer,
    updateFeedbackMessage as updateFeedbackMessageQuery,
    deleteFeedbackMessage as deleteFeedbackMessageQuery,
    updateAnswer as updateAnswerQuery,
    deleteAnswer as deleteAnswerQuery,
    toggleMessageLike as toggleMessageLikeQuery,
    toggleAnswerLike as toggleAnswerLikeQuery,
} from './feedback.queries.js';

const formatMessage = (row) => ({
    id: row.id,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: { id: row.user_id, name: row.user_name, email: row.user_email, image: row.user_image },
    isLiked: row.is_liked,
    likeCount: row.like_count,
    answerCount: row.answer_count,
});

const formatAnswer = (row) => ({
    id: row.id,
    message: row.message,
    answeredMessageId: row.answered_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: { id: row.user_id, name: row.user_name, email: row.user_email, image: row.user_image },
    isLiked: row.is_liked,
    likeCount: row.like_count,
});

const isAdminRole = (role) => role === 'ADMIN';

export const getFeedbackMessages = withServiceError(async (user, { skip, take }) => {
    const messages = await listFeedbackMessages(user.userId, take, skip);
    if (messages.length === 0) return [];

    const messageIds = messages.map((m) => m.id);
    const answers = await listAnswersForMessages(user.userId, messageIds);

    const answersByMessageId = new Map();
    for (const answer of answers) {
        const list = answersByMessageId.get(answer.answered_message_id) ?? [];
        list.push(formatAnswer(answer));
        answersByMessageId.set(answer.answered_message_id, list);
    }

    return messages.map((row) => ({
        ...formatMessage(row),
        answers: answersByMessageId.get(row.id) ?? [],
    }));
}, { code: 'ERROR_GETTING_MESSAGES', message: 'Hubo un error al intentar obtener los mensajes' });

export const getAnswersForMessage = withServiceError(async (user, messageId) => {
    const message = await findMessageById(messageId);
    if (!message) throw { code: 'MESSAGE_NOT_FOUND', message: 'No fue posible encontrar el mensaje' };

    const answers = await queryAnswersForMessage(user.userId, messageId);
    return answers.map(formatAnswer);
}, { code: 'ERROR_GETTING_ANSWERS', message: 'Hubo un error al intentar obtener las respuestas' });

export const createFeedbackMessage = withServiceError(async (user, message) => {
    const created = await insertFeedbackMessage(user.userId, message);
    const row = await getMessageById(user.userId, created.id);
    return { ...formatMessage(row), answers: [] };
}, { code: 'ERROR_CREATING_MESSAGE', message: 'Hubo un error al intentar crear el mensaje de feedback' });

export const updateFeedbackMessage = withServiceError(async (user, messageId, newMessage) => {
    const updated = await updateFeedbackMessageQuery({
        id: messageId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
        message: newMessage,
    });

    if (!updated) throw { code: 'MESSAGE_NOT_FOUND', message: 'No fue posible encontrar el mensaje que intentas editar' };

    const row = await getMessageById(user.userId, messageId);
    return formatMessage(row);
}, { code: 'ERROR_UPDATING_MESSAGE', message: 'Hubo un error al intentar editar el mensaje' });

export const deleteFeedbackMessage = withServiceError(async (user, messageId) => {
    const deleted = await deleteFeedbackMessageQuery({
        id: messageId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
    });

    if (!deleted) throw { code: 'MESSAGE_NOT_FOUND', message: 'No fue posible encontrar el mensaje que intentas eliminar' };
}, { code: 'ERROR_DELETING_MESSAGE', message: 'Hubo un error al intentar eliminar el mensaje' });

export const replyToMessage = withServiceError(async (user, messageId, message) => {
    const parentMessage = await findMessageById(messageId);
    if (!parentMessage) throw { code: 'MESSAGE_NOT_FOUND', message: 'No fue posible encontrar el mensaje que intentas responder' };

    const created = await insertAnswer({ userId: user.userId, messageId, message });
    const row = await getAnswerById(user.userId, created.id);
    return formatAnswer(row);
}, { code: 'ERROR_CREATING_ANSWER', message: 'Hubo un error al intentar responder el mensaje' });

export const updateAnswer = withServiceError(async (user, answerId, newMessage) => {
    const updated = await updateAnswerQuery({
        id: answerId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
        message: newMessage,
    });

    if (!updated) throw { code: 'ANSWER_NOT_FOUND', message: 'No fue posible encontrar la respuesta que intentas editar' };

    const row = await getAnswerById(user.userId, answerId);
    return formatAnswer(row);
}, { code: 'ERROR_UPDATING_ANSWER', message: 'Hubo un error al intentar editar la respuesta' });

export const deleteAnswer = withServiceError(async (user, answerId) => {
    const deleted = await deleteAnswerQuery({
        id: answerId,
        userId: user.userId,
        isAdmin: isAdminRole(user.role),
    });

    if (!deleted) throw { code: 'ANSWER_NOT_FOUND', message: 'No fue posible encontrar la respuesta que intentas eliminar' };
}, { code: 'ERROR_DELETING_ANSWER', message: 'Hubo un error al intentar eliminar la respuesta' });

export const toggleMessageLike = withServiceError(async (user, messageId) => {
    const message = await findMessageById(messageId);
    if (!message) throw { code: 'MESSAGE_NOT_FOUND', message: 'No fue posible encontrar el mensaje' };

    return toggleMessageLikeQuery(user.userId, messageId);
}, { code: 'ERROR_TOGGLING_LIKE', message: 'Hubo un error al intentar procesar el like' });

export const toggleAnswerLike = withServiceError(async (user, answerId) => {
    const answer = await findAnswerById(answerId);
    if (!answer) throw { code: 'ANSWER_NOT_FOUND', message: 'No fue posible encontrar la respuesta' };

    return toggleAnswerLikeQuery(user.userId, answerId);
}, { code: 'ERROR_TOGGLING_LIKE', message: 'Hubo un error al intentar procesar el like' });
