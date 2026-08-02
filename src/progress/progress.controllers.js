import {
    markLessonComplete,
    unmarkLessonComplete,
    submitQuizAttempt,
    getQuizAttempts,
    getRouteProgressForUser,
} from './progress.services.js';

export const complete = async (req, res) => {
    return res.status(200).json(await markLessonComplete(req.user, req.params.id));
}

export const uncomplete = async (req, res) => {
    return res.status(200).json(await unmarkLessonComplete(req.user, req.params.id));
}

export const submit = async (req, res) => {
    return res.status(201).json(await submitQuizAttempt(req.user, req.params.id, req.body.answers));
}

export const attempts = async (req, res) => {
    return res.status(200).json({ attempts: await getQuizAttempts(req.user, req.params.id) });
}

export const progress = async (req, res) => {
    return res.status(200).json({ progress: await getRouteProgressForUser(req.user, req.params.id) });
}
