import {
    getMyProfile,
    getPublicProfile,
    updateMyProfile,
    changeTimezone,
    setMyTopics,
    completeOnboarding,
    setUserVerified,
} from './users.services.js';
import { listPublicRoutesOfUser } from '../routes/routes.services.js';

export const me = async (req, res) => {
    return res.status(200).json({ user: await getMyProfile(req.user) });
}

export const updateMe = async (req, res) => {
    return res.status(200).json(await updateMyProfile(req.user, req.body));
}

export const timezone = async (req, res) => {
    return res.status(200).json(await changeTimezone(req.user, req.body.timezone));
}

export const topics = async (req, res) => {
    return res.status(200).json(await setMyTopics(req.user, req.body.topicIds));
}

export const onboarding = async (req, res) => {
    return res.status(200).json(await completeOnboarding(req.user, req.body));
}

export const profile = async (req, res) => {
    return res.status(200).json({ user: await getPublicProfile(req.user, req.params.userId) });
}

export const verified = async (req, res) => {
    const user = await setUserVerified(req.params.userId, req.body.verified);
    return res.status(200).json({ user });
}

export const userRoutes = async (req, res) => {
    const routes = await listPublicRoutesOfUser(req.params.userId, req.query);
    return res.status(200).json({ routes });
}
