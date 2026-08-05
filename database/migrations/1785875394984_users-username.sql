-- Up Migration

-- Plegado de acentos, para que "Matematicas" encuentre "Matemáticas" y la tilde no convierta a
-- dos personas en homonimas. Lo usan el backfill de aqui abajo y la busqueda de /search.
--
-- Es una funcion propia y no la extension `unaccent` por un detalle de Supabase: alli las
-- extensiones se instalan en el esquema `extensions`, no en `public`, asi que un
-- "CREATE EXTENSION IF NOT EXISTS unaccent" seria un no-op silencioso -- ya esta creada, en
-- otro esquema -- y las consultas fallarian con "function unaccent(text) does not exist".
--
-- Ademas unaccent() NO es IMMUTABLE (depende de un diccionario que puede cambiar), asi que no
-- puede sostener un indice. Esta si lo es, que es lo que deja abierta la via del indice
-- funcional + pg_trgm el dia que el catalogo crezca. El juego de caracteres cubre castellano,
-- catalan, gallego y portugues, que es lo que el producto necesita.
CREATE OR REPLACE FUNCTION atino_unaccent(text) RETURNS text AS $$
    SELECT translate($1,
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')
$$ LANGUAGE sql IMMUTABLE STRICT;

-- El handle publico con el que el front enruta los perfiles: /profile/danel-mantilla.
--
-- No lo elige el usuario ni aparece como campo en ningun formulario -- se genera slugificando
-- su nombre. Existe solo porque una URL necesita una clave unica y siempre presente, y `name`
-- no es ninguna de las dos cosas: es nullable y no tiene UNIQUE, asi que dos personas pueden
-- llamarse igual y un usuario local nace sin nombre (createLocalUser solo inserta email y
-- password). La busqueda de personas sigue yendo contra `name`, no contra esta columna.

-- Queda NULLABLE a proposito: entre POST /auth/register y PUT /users/me/onboarding no hay
-- nombre del que derivarla. En Postgres los NULL son distintos entre si, asi que el indice
-- UNIQUE de mas abajo los admite todos sin colisionar. Un usuario en ese hueco no tiene
-- tampoco nombre ni avatar que pintar, asi que no poder alcanzarlo por URL no pierde nada.
ALTER TABLE users ADD COLUMN username TEXT;

-- Backfill. El slug sale del nombre, y de la parte local del correo cuando no hay nombre.
--
-- El desempate va con row_number() ordenando por id, y no por el orden fisico de las filas,
-- por el mismo motivo que el DISTINCT ON de la migracion 11 ordena por nombre: re-ejecutar
-- esto sobre otra copia de la base tiene que elegir lo mismo. Sin el ORDER BY, quien se queda
-- el slug limpio y quien se lleva el sufijo dependeria de como devuelva las filas el planner.
WITH slugged AS (
    SELECT id,
           trim(both '-' from regexp_replace(
               lower(atino_unaccent(coalesce(nullif(trim(name), ''), split_part(email, '@', 1)))),
               '[^a-z0-9]+', '-', 'g')) AS base
      FROM users
), numbered AS (
    SELECT id,
           base,
           row_number() OVER (PARTITION BY base ORDER BY id) AS n
      FROM slugged
     WHERE base <> ''
)
UPDATE users u
   SET username = CASE WHEN nu.n = 1 THEN nu.base ELSE nu.base || '-' || nu.n END
  FROM numbered nu
 WHERE nu.id = u.id;

-- Es lo que hace segura la generacion en caliente: ensureUniqueUsername no comprueba y luego
-- inserta -- entre las dos sentencias cabe otra transaccion -- sino que intenta y reintenta
-- con sufijo cuando esta constraint le devuelve un 23505.
CREATE UNIQUE INDEX uq_users_username ON users (username);


-- Down Migration

DROP INDEX IF EXISTS uq_users_username;
ALTER TABLE users DROP COLUMN IF EXISTS username;
DROP FUNCTION IF EXISTS atino_unaccent(text);
