import { rateRoute, removeRouteRating, getRouteRating } from './reviews.services.js';

export const rate = async (req, res) => {
    return res.status(200).json({ rating: await rateRoute(req.user, req.params.routeId, req.body.rating) });
}

export const remove = async (req, res) => {
    return res.status(200).json({ rating: await removeRouteRating(req.user, req.params.routeId) });
}

export const detail = async (req, res) => {
    return res.status(200).json({ rating: await getRouteRating(req.user, req.params.routeId) });
}
