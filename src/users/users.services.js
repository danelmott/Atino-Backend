import { withServiceError } from '../lib/withServiceError.js';
import { dbConnection } from '../../database/connection.js';
import { urlOfReading } from '../uploads/uploads.services.js';
import { getUserStats } from '../gamification/gamification.services.js';
import { findUserProfile, probeTimezone, updateUserTimezone } from './users.queries.js';

const formatProfile = async (row) => ({
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    name: row.name,
    image: await urlOfReading(row.image),
    role: row.role,
    timezone: row.timezone,
    createdAt: row.created_at,
});

/**
 * El perfil trae la gamificacion pegada porque es lo que pinta la cabecera de la app: quien
 * eres, en que liga vas y cuantos dias llevas de racha, en una sola llamada.
 */
export const getMyProfile = withServiceError(async (user) => {
    const row = await findUserProfile(dbConnection, user.userId);
    if (!row) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    const [profile, stats] = await Promise.all([formatProfile(row), getUserStats(user.userId)]);

    return {
        ...profile,
        xp: stats.xp,
        league: stats.league,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
    };
}, { code: 'ERROR_GETTING_PROFILE', message: 'Hubo un error al intentar obtener el perfil' });

/**
 * La zona horaria decide donde corta el dia para la racha y para el heatmap, asi que se
 * valida dos veces: en el borde con zod y contra el propio Postgres antes de escribirla.
 * El sondeo va primero y fuera de cualquier escritura: si Postgres la rechaza, todavia no
 * se ha tocado nada.
 */
export const changeTimezone = withServiceError(async (user, timezone) => {
    try {
        await probeTimezone(dbConnection, timezone);
    }
    catch {
        throw { code: 'INVALID_TIMEZONE', message: 'La zona horaria no es valida' };
    }

    const updated = await updateUserTimezone(dbConnection, { userId: user.userId, timezone });
    if (!updated) throw { code: 'USER_NOT_FOUND', message: 'No fue posible encontrar el usuario' };

    return { timezone: updated.timezone };
}, { code: 'ERROR_UPDATING_TIMEZONE', message: 'Hubo un error al intentar cambiar la zona horaria' });
