import { createQuizzes, getQuiz, updateQuiz, deleteQuiz } from './quizzes.services.js';

export const create = async (req, res) => {
    const quizzes = await createQuizzes(req.user, req.params.routeId, req.body.quizzes);
    return res.status(201).json({ quizzes });
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
