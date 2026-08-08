import { createLessons, getLesson, updateLesson, deleteLesson, reorderLessons } from './lessons.services.js';

export const create = async (req, res) => {
    const lessons = await createLessons(req.user, req.params.routeId, req.body.lessons);
    return res.status(201).json({ lessons });
}

export const detail = async (req, res) => {
    const lesson = await getLesson(req.user, req.params.id);
    return res.status(200).json({ lesson });
}

export const update = async (req, res) => {
    const lesson = await updateLesson(req.user, req.params.id, req.body);
    return res.status(200).json({ lesson });
}

export const remove = async (req, res) => {
    await deleteLesson(req.user, req.params.id);
    return res.status(204).send();
}

export const reorder = async (req, res) => {
    const result = await reorderLessons(req.user, req.params.routeId, req.body.order);
    return res.status(200).json(result);
}
