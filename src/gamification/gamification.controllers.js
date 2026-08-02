import {
    getUserStats,
    getUserActivity,
    getSeasonRanking,
    getMyStanding,
    getGlobalRanking,
    currentSeason,
} from './gamification.services.js';

/** 'me' es el usuario del token; cualquier otro valor ya vino validado como uuid. */
export const resolveUserId = (req) =>
    req.params.userId === 'me' ? req.user.userId : req.params.userId;

export const stats = async (req, res) => {
    return res.status(200).json({ stats: await getUserStats(resolveUserId(req)) });
}

export const activity = async (req, res) => {
    return res.status(200).json({ activity: await getUserActivity(resolveUserId(req), req.query) });
}

export const ranking = async (req, res) => {
    const season = req.query.season ?? currentSeason();
    return res.status(200).json({ ranking: await getSeasonRanking(req.user.userId, season) });
}

export const standing = async (req, res) => {
    const season = req.query.season ?? currentSeason();
    return res.status(200).json({ standing: await getMyStanding(req.user.userId, season) });
}

export const globalRanking = async (req, res) => {
    return res.status(200).json({ ranking: await getGlobalRanking(req.query) });
}
