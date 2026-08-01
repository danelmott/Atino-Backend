import { createQuiz, getQuiz, updateQuiz, deleteQuiz } from './quizzes.services.js';

export const create = async (req, res) => {
    const quiz = await createQuiz(req.user, req.params.routeId, req.body);
    return res.status(201).json({ quiz });
}

export const detail = async (req, res) => {
    const quiz = await getQuiz(req.user, req.params.id);
    return res.status(200).json({ quiz });
}

export const update = async (req, res) => {
    const quiz = await updateQuiz(req.user, req.params.id, req.body);
    return res.status(200).json({ quiz });
}

export const remove = async (req, res) => {
    await deleteQuiz(req.user, req.params.id);
    return res.status(204).send();
}
