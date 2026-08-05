/**
 * Prepara lo que el usuario ha escrito para que pueda entrar en una consulta LIKE.
 *
 * Es la contraparte en Node del plegado que atino_unaccent() hace en SQL: los dos lados de la
 * comparacion tienen que estar normalizados igual o "Matematicas" no encuentra "Matemáticas".
 */

/**
 * `%` y `_` son comodines de LIKE, y `\` es el escape por defecto en Postgres.
 *
 * Sin esto la busqueda tiene un agujero silencioso: escribir "100%" casaria con TODAS las filas
 * (el % se lee como "cualquier cosa"), y "a_b" con cualquier cadena que tenga una letra en
 * medio. No es un problema de inyeccion -- el texto viaja como bind param -- sino de que el
 * resultado no es el que el usuario ha pedido.
 */
const escapeLike = (text) => text.replace(/[\\%_]/g, (character) => `\\${character}`);

const normalize = (text) => String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Devuelve las tres formas que necesitan las consultas de /search:
 *
 * - `words`    los patrones `%palabra%`, uno por palabra, para el LIKE ALL. Se exigen TODAS,
 *              que es lo que hace que "calculo luci" encuentre la ruta por titulo y por autora
 *              a la vez -- misma semantica que matchesQuery en el front.
 * - `term`     el termino entero sin escapar, para la comparacion de igualdad del ranking. Va
 *              en crudo a proposito: contra `=` un `\%` escapado no casaria con un "%" literal.
 * - `termLike` el termino entero escapado, para los LIKE de prefijo del ranking.
 */
export const buildSearchTerms = (query) => {
    const term = normalize(query);
    const words = term.split(/\s+/).filter(Boolean).map((word) => `%${escapeLike(word)}%`);

    return { words, term, termLike: escapeLike(term) };
};
