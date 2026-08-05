import { withServiceError } from '../lib/withServiceError.js';
import { buildSearchTerms } from '../lib/searchTerms.js';
import { searchRoutes } from '../routes/routes.services.js';
import { searchPeople } from '../users/users.services.js';

/**
 * La busqueda de /explore: rutas y personas en una sola respuesta.
 *
 * Este modulo NO tiene queries propias, y es deliberado. El SQL de rutas vive en `routes` junto
 * a formatRouteCard, y el de personas en `users` junto a su formatter, por el mismo motivo por
 * el que listPublicRoutesOfUser esta en routes y no en users: la consulta y el formateador de
 * una entidad son de su modulo. Aqui solo se componen.
 *
 * Van en un unico endpoint y no en dos porque la pantalla necesita las dos mitades a la vez y
 * en cada pulsacion: dos peticiones paralelas duplicarian los viajes y obligarian al cliente a
 * arbitrar dos carreras en vez de una.
 *
 * Los terminos se preparan UNA vez y se pasan a las dos mitades, para que no puedan normalizar
 * distinto y devolver resultados incoherentes entre si.
 */
export const searchAll = withServiceError(async (user, { q, take, skip }) => {
    const terms = buildSearchTerms(q);

    // Una consulta vacia no llega aqui -- el schema exige min(1) -- pero un texto de solo
    // simbolos si, y sin palabras el LIKE ALL de un array vacio da TRUE para todas las filas:
    // el buscador devolveria el catalogo entero.
    if (terms.words.length === 0) return { routes: [], users: [] };

    const [routes, users] = await Promise.all([
        searchRoutes({ ...terms, take, skip }),
        searchPeople(user.userId, { ...terms, take, skip }),
    ]);

    return { routes, users };
}, { code: 'ERROR_SEARCHING', message: 'Hubo un error al intentar buscar' });
