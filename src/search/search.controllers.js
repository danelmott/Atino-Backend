import { searchAll } from './search.services.js';

export const search = async (req, res) => {
    return res.status(200).json(await searchAll(req.user, req.query));
}
