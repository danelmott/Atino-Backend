import { withServiceError } from '../lib/withServiceError.js';
import { dbConnection } from '../../database/connection.js';
import { urlOfReading } from '../uploads/uploads.services.js';
import { recommendRoutes } from './feed.queries.js';

/**
 * Tabla de politica del feed, en el mismo espiritu que XP_RULES en gamification y
 * UPLOAD_SCOPES en uploads: el balance se ajusta aqui y en ningun otro sitio. Se pasan a la
 * query como parametros, asi que cambiar un numero no obliga a tocar SQL ni a migrar nada.
 *
 * El orden de magnitud importa mas que el valor exacto: preferencia declarada pesa mas que
 * afinidad deducida, que es la senal mas debil de las tres personales.
 *
 * `following` va por debajo de `preference` -- el catalogo entero se organiza por materia --
 * pero por encima de `affinity`, porque seguir a alguien es una senal declarada y no deducida.
 */
export const FEED_WEIGHTS = {
    preference: 5.0,   // la materia de la ruta esta entre las que eligio en el onboarding
    following:  4.0,   // sigue al autor
    affinity:   3.0,   // ya ha consumido rutas de esa materia
    quality:    1.5,   // valoracion media, amortiguada por el numero de votos
    freshness:  1.0,   // decaimiento exponencial, vida media ~30 dias
    enrolled:  -2.0,   // ya empezada: baja en el feed, pero no desaparece
};

const formatFeedItem = async (row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    image: await urlOfReading(row.image),
    subject: {
        slug: row.subject_slug,
        name: row.subject_name,
    },
    ratingAvg: Number(row.rating_avg ?? 0),
    ratingCount: row.rating_count,
    enrollmentCount: row.enrollment_count,
    completionCount: row.completion_count,
    // Para que el front pueda pintar "continuar" en vez de "empezar".
    started: row.started,
    createdAt: row.created_at,
    // El id ademas del nombre: sin el, el front no puede enlazar al perfil del autor ni
    // pintarle un boton de seguir en la propia tarjeta.
    author: {
        id: row.author_id,
        name: row.author_name,
        username: row.author_username,
        verified: row.author_verified,
        isFollowing: row.author_followed,
    },
});

/**
 * El arranque en frio no necesita ninguna rama especial: un usuario sin preferencias, sin
 * historial y sin seguidos deja los tres primeros terminos del score en cero, y lo que queda
 * es calidad mas frescura, que es exactamente lo que habria que ensenarle a alguien de quien
 * no se sabe nada todavia.
 */
export const getRecommendedRoutes = withServiceError(async (user, { take, skip }) => {
    const rows = await recommendRoutes(dbConnection, {
        userId: user.userId,
        take,
        skip,
        weights: FEED_WEIGHTS,
    });

    return Promise.all(rows.map(formatFeedItem));
}, { code: 'ERROR_GETTING_FEED', message: 'Hubo un error al intentar obtener las recomendaciones' });
