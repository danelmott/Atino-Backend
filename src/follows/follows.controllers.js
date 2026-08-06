import {
    followUser,
    unfollowUser,
    getFollowState,
    getFollowers,
    getFollowing,
} from './follows.services.js';

/** 'me' es el usuario del token; cualquier otro valor ya vino validado como uuid. */
const resolveUserId = (req) =>
    req.params.userId === 'me' ? req.user.userId : req.params.userId;

export const follow = async (req, res) => {
    return res.status(200).json({ follow: await followUser(req.user, resolveUserId(req)) });
}

export const unfollow = async (req, res) => {
    return res.status(200).json({ follow: await unfollowUser(req.user, resolveUserId(req)) });
}

export const state = async (req, res) => {
    return res.status(200).json({ follow: await getFollowState(req.user, resolveUserId(req)) });
}

export const followers = async (req, res) => {
    const users = await getFollowers(req.user, resolveUserId(req), req.query);
    return res.status(200).json({ users });
}

export const following = async (req, res) => {
    const users = await getFollowing(req.user, resolveUserId(req), req.query);
    return res.status(200).json({ users });
}
