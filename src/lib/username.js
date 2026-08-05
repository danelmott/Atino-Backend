/**
 * Generacion del handle publico (users.username), el que el front usa para enrutar perfiles.
 *
 * No es un campo que el usuario rellene: sale de slugificar su nombre. Ver la migracion
 * 1785875394984 para por que existe una columna aparte en vez de enrutar por `name`.
 */

/** Codigo de Postgres para violacion de constraint UNIQUE. El mismo que mapea errorHandler. */
const PG_UNIQUE_VIOLATION = '23505';

/** Con cinco homonimos ya no vale la pena seguir probando: se pasa al sufijo del uuid. */
const MAX_ATTEMPTS = 5;

/** Para quien no tiene ni nombre ni correo del que tirar. */
const FALLBACK_BASE = 'usuario';

/**
 * "Danel Mantilla Palomino" -> "danel-mantilla-palomino".
 *
 * Mismo criterio que normalize() en el front (new-app/lib/routes.js): NFD y fuera los
 * diacriticos, para que la tilde no acabe en la URL ni convierta a dos personas en homonimas.
 */
export const slugifyName = (text) => String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Escribe el handle del usuario, resolviendo homonimos con sufijo numerico.
 *
 * Se intenta y se reintenta contra la constraint en vez de comprobar antes con un SELECT:
 * entre "comprobar que esta libre" y "escribirlo" cabe otra transaccion haciendo lo mismo, y
 * el indice UNIQUE es el unico que puede arbitrar eso sin carrera.
 *
 * Por eso cada intento va envuelto en un SAVEPOINT, y esto es lo unico no obvio de la funcion:
 * en Postgres un error DENTRO de una transaccion la aborta entera, asi que sin el savepoint el
 * primer choque dejaria la transaccion en 25P02 y todo lo que viniera despues -- el resto del
 * onboarding -- fallaria con "current transaction is aborted". El ROLLBACK TO deshace solo el
 * intento fallido y deja la transaccion viva.
 */
export const ensureUniqueUsername = async (client, { userId, base }) => {
    const root = slugifyName(base) || FALLBACK_BASE;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const candidate = attempt === 1 ? root : `${root}-${attempt}`;

        await client.query('SAVEPOINT username_attempt');

        try {
            const { rows } = await client.query(
                `UPDATE users SET username = $2 WHERE id = $1 RETURNING username`,
                [userId, candidate]
            );

            await client.query('RELEASE SAVEPOINT username_attempt');
            return rows[0]?.username ?? null;
        }
        catch (error) {
            await client.query('ROLLBACK TO SAVEPOINT username_attempt');
            if (error.code !== PG_UNIQUE_VIOLATION) throw error;
        }
    }

    // Los primeros ocho del uuid: unico por construccion, asi que cierra el bucle sin lanzar.
    // Quedarse sin handle por tener cinco homonimos dejaria el perfil inalcanzable por URL.
    const { rows } = await client.query(
        `UPDATE users SET username = $2 WHERE id = $1 RETURNING username`,
        [userId, `${root}-${String(userId).slice(0, 8)}`]
    );

    return rows[0]?.username ?? null;
};
