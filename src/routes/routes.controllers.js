import {
    createRoute,
    getRoute,
    listRoutes,
    updateRoute,
    updateRouteCover,
    setRouteVisibility,
    deleteRoute,
    getTopics,
} from './routes.services.js';

export const create = async (req, res) => {
    const route = await createRoute(req.user, req.body);
    return res.status(201).json({ route });
}

export const detail = async (req, res) => {
    const route = await getRoute(req.user, req.params.id);
    return res.status(200).json({ route });
}

export const list = async (req, res) => {
    const routes = await listRoutes(req.user, req.query);
    return res.status(200).json({ routes });
}

export const update = async (req, res) => {
    const route = await updateRoute(req.user, req.params.id, req.body);
    return res.status(200).json({ route });
}

export const changeCover = async (req, res) => {
    const result = await updateRouteCover(req.user, req.params.id, req.body.image);
    return res.status(200).json(result);
}

export const changeVisibility = async (req, res) => {
    const result = await setRouteVisibility(req.user, req.params.id, req.body.status);
    return res.status(200).json(result);
}

export const remove = async (req, res) => {
    await deleteRoute(req.user, req.params.id);
    return res.status(204).send();
}

export const topics = async (req, res) => {
    return res.status(200).json({ topics: await getTopics() });
}
