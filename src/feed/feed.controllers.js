import { getRecommendedRoutes } from './feed.services.js';

export const feed = async (req, res) => {
    return res.status(200).json({ routes: await getRecommendedRoutes(req.user, req.query) });
}
