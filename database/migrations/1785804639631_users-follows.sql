-- Up Migration

-- ============================================================
--  GRAFO DE SEGUIDORES
-- ============================================================

-- Quien sigue a quien. Relacion dirigida: que A siga a B no implica lo contrario, asi que
-- no hay constraint que empareje las dos filas -- son independientes.
--
-- Sin updated_at a proposito: la fila se crea y se borra, nunca se edita, asi que el bloque
-- DO $$ de auto-touch que llevan otras migraciones no le engancha trigger (ni debe).
CREATE TABLE user_follows (
    follower_id  UUID        NOT NULL,
    following_id UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (follower_id, following_id),

    -- Seguirse a uno mismo no significa nada y ademas descuadraria los contadores. El
    -- servicio lo corta antes con un mensaje legible; esto es la red de seguridad.
    CONSTRAINT chk_user_follows_not_self CHECK (follower_id <> following_id),

    CONSTRAINT fk_user_follows_follower
        FOREIGN KEY (follower_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_follows_following
        FOREIGN KEY (following_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

-- Los dos listados van ordenados por fecha, y la PK (follower_id, following_id) no sirve
-- para eso: hace falta el created_at dentro del propio indice.
--   "quien sigue a X"  -> GET /users/X/followers
CREATE INDEX idx_user_follows_followers ON user_follows (following_id, created_at DESC);
--   "a quien sigue X"  -> GET /users/X/following
CREATE INDEX idx_user_follows_following ON user_follows (follower_id, created_at DESC);


-- ============================================================
--  CONTADORES DENORMALIZADOS
-- ============================================================

ALTER TABLE users ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;

-- Mismo patron que refresh_route_rating(): AFTER de las tres operaciones, FOR EACH ROW, sin
-- ramificar por TG_OP (COALESCE(NEW, OLD) resuelve insert/update/delete) y recalculando el
-- total con COUNT(*) en vez de sumar deltas, que es lo que lo hace idempotente y capaz de
-- repararse solo si algun contador se desvia.
--
-- La diferencia con los triggers que ya existen: una fila de user_follows toca DOS usuarios,
-- no uno. Eso abre la puerta a un deadlock -- si A sigue a B mientras B sigue a A, cada
-- transaccion cogeria los dos locks en orden contrario. Por eso los UPDATE van ordenados por
-- uuid (menor primero) y no en el orden natural seguidor->seguido: asi las dos transacciones
-- piden los locks en la misma secuencia y una espera en vez de morir. Es el mismo motivo por
-- el que recordActivity tiene que ser la ultima sentencia de su transaccion.
CREATE OR REPLACE FUNCTION refresh_user_follow_counts()
RETURNS TRIGGER AS $$
DECLARE
    follower  UUID;
    followed  UUID;
    first_id  UUID;
    second_id UUID;
BEGIN
    follower := COALESCE(NEW.follower_id, OLD.follower_id);
    followed := COALESCE(NEW.following_id, OLD.following_id);

    first_id  := LEAST(follower, followed);
    second_id := GREATEST(follower, followed);

    -- Se recalculan los dos contadores de cada usuario aunque solo uno haya podido cambiar:
    -- son dos COUNT sobre indice y sale mas barato que razonar sobre cual toca.
    UPDATE users u
       SET followers_count = (SELECT COUNT(*)::int FROM user_follows WHERE following_id = first_id),
           following_count = (SELECT COUNT(*)::int FROM user_follows WHERE follower_id  = first_id)
     WHERE u.id = first_id;

    UPDATE users u
       SET followers_count = (SELECT COUNT(*)::int FROM user_follows WHERE following_id = second_id),
           following_count = (SELECT COUNT(*)::int FROM user_follows WHERE follower_id  = second_id)
     WHERE u.id = second_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_follows_refresh
    AFTER INSERT OR UPDATE OR DELETE ON user_follows
    FOR EACH ROW EXECUTE FUNCTION refresh_user_follow_counts();


-- Down Migration

DROP FUNCTION IF EXISTS refresh_user_follow_counts() CASCADE;

DROP TABLE IF EXISTS user_follows;

ALTER TABLE users DROP COLUMN IF EXISTS followers_count;
ALTER TABLE users DROP COLUMN IF EXISTS following_count;
