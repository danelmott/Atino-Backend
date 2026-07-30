import {
    getFeedbackMessages,
    getAnswersForMessage,
    createFeedbackMessage,
    updateFeedbackMessage,
    deleteFeedbackMessage,
    replyToMessage,
    updateAnswer,
    deleteAnswer,
    toggleMessageLike,
    toggleAnswerLike,
} from './feedback.services.js';

export const listMessages = async (req, res) => {
    const { skip, take } = req.query;
    const messages = await getFeedbackMessages(req.user, { skip, take });
    return res.status(200).json({ messages });
}

export const listAnswers = async (req, res) => {
    const answers = await getAnswersForMessage(req.user, req.params.id);
    return res.status(200).json({ answers });
}

export const createMessage = async (req, res) => {
    const message = await createFeedbackMessage(req.user, req.body.message);
    return res.status(201).json({ message });
}

export const updateMessage = async (req, res) => {
    const message = await updateFeedbackMessage(req.user, req.params.id, req.body.message);
    return res.status(200).json({ message });
}

export const deleteMessage = async (req, res) => {
    await deleteFeedbackMessage(req.user, req.params.id);
    return res.status(204).send();
}

export const likeMessage = async (req, res) => {
    const result = await toggleMessageLike(req.user, req.params.id);
    return res.status(200).json(result);
}

export const createAnswer = async (req, res) => {
    const answer = await replyToMessage(req.user, req.params.id, req.body.message);
    return res.status(201).json({ answer });
}

export const editAnswer = async (req, res) => {
    const answer = await updateAnswer(req.user, req.params.id, req.body.message);
    return res.status(200).json({ answer });
}

export const removeAnswer = async (req, res) => {
    await deleteAnswer(req.user, req.params.id);
    return res.status(204).send();
}

export const likeAnswer = async (req, res) => {
    const result = await toggleAnswerLike(req.user, req.params.id);
    return res.status(200).json(result);
}
