import { getMyProfile, changeTimezone } from './users.services.js';

export const me = async (req, res) => {
    return res.status(200).json({ user: await getMyProfile(req.user) });
}

export const timezone = async (req, res) => {
    return res.status(200).json(await changeTimezone(req.user, req.body.timezone));
}
