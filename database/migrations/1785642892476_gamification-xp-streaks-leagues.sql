-- Up Migration

-- Zona horaria del usuario. Es lo que decide donde corta el dia para la racha y para el
-- cuadrito del heatmap: sin esto, un usuario en America perderia la racha a las 7pm.
-- El valor se valida en la capa de aplicacion contra Intl.supportedValuesOf('timeZone')
-- y ademas se sondea con "SELECT now() AT TIME ZONE $1" antes de guardarlo, porque el
-- set de nombres de ICU y el de pg_timezone_names no son identicos y AT TIME ZONE lanza
-- con un nombre desconocido: una sola fila mala romperia recordActivity para siempre.
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';


-- ============================================================
--  LEDGER DE ACTIVIDAD
-- ============================================================

-- Append-only. Es la unica fuente de la que salen el heatmap, el XP y el ranking, para
-- que no puedan contradecirse entre si.
CREATE TABLE activity_events (
    id            BIGSERIAL   PRIMARY KEY,
    user_id       UUID        NOT NULL,

    -- TEXT y no un enum a proposito: ALTER TYPE ... ADD VALUE no permite *usar* el valor
    -- nuevo en la misma transaccion, y node-pg-migrate envuelve cada migracion en una, asi
    -- que cada evento nuevo costaria una migracion partida en dos. La lista de eventos
    -- validos es XP_RULES, en src/gamification/gamification.services.js.
    event_type    TEXT        NOT NULL,

    -- La leccion, quiz o ruta a la que se refiere el evento. Sin FK a proposito: borrar una
    -- ruta no debe reescribir la historia de quien la hizo ni devolverle el XP ganado.
    -- NOT NULL tambien a proposito: si fuera nullable, el predicado de deduplicado
    -- "subject_id = $3" seria NULL = NULL, o sea nunca cierto, o sea XP infinito.
    subject_id    UUID        NOT NULL,

    -- Ya multiplicado por la liga que tenia el usuario al ganarlo. El XP historico es por
    -- tanto dependiente del camino, y es intencional: quien llego a 10.000 lo hizo pagando
    -- las tarifas de las ligas que fue atravesando.
    -- 0 significa "cuenta para el heatmap y la racha, pero no para el ranking": eventos de
    -- creacion, repeticiones ya premiadas, y contenido propio.
    xp            INTEGER     NOT NULL,

    -- Precalculado en la zona del usuario al insertar. Queda congelado con la zona vigente
    -- cuando ocurrio el evento: cambiar de zona no reescribe el historial.
    activity_date DATE        NOT NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_activity_events_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

-- Sin updated_at a proposito: el bloque DO del final le engancharia un trigger de
-- auto-touch a un ledger append-only, que es una contradiccion.

CREATE INDEX idx_activity_events_user_day ON activity_events (user_id, activity_date);

-- Doble funcion: es la query que responde "¿ya cobro por esto?" y a la vez la garantia
-- estructural de que no pueda cobrar dos veces. Parcial sobre xp > 0 porque las filas de
-- 0 XP (heatmap) si pueden repetirse: rehacer una leccion pinta cuadrito otra vez.
CREATE UNIQUE INDEX uq_activity_events_xp_once
    ON activity_events (user_id, event_type, subject_id) WHERE xp > 0;


-- ============================================================
--  ESTADISTICAS Y RACHA
-- ============================================================

CREATE TABLE user_stats (
    user_id            UUID        PRIMARY KEY,
    xp                 INTEGER     NOT NULL DEFAULT 0,
    current_streak     INTEGER     NOT NULL DEFAULT 0,
    longest_streak     INTEGER     NOT NULL DEFAULT 0,

    -- En la zona del usuario, igual que activity_events.activity_date.
    last_activity_date DATE,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_user_stats_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

-- La liga NO se guarda: se deriva de xp en el servicio, para que reequilibrar los umbrales
-- sea cambiar una constante y no migrar todas las filas.
CREATE INDEX idx_user_stats_xp ON user_stats (xp DESC);


-- Aisla la aritmetica de la racha para poder probarla con un SELECT en vez de esperar dias,
-- y para que la actualizacion de user_stats quepa en un solo upsert atomico.
-- El caso "last_day > today" cubre al usuario que mueve su zona horaria hacia el oeste:
-- su "hoy" retrocede y la racha no debe romperse por eso.
CREATE OR REPLACE FUNCTION next_streak(last_day DATE, today DATE, streak INTEGER)
RETURNS INTEGER AS $$
    SELECT CASE
        WHEN last_day IS NULL     THEN 1
        WHEN last_day = today     THEN streak
        WHEN last_day = today - 1 THEN streak + 1
        WHEN last_day > today     THEN streak
        ELSE 1
    END;
$$ LANGUAGE sql IMMUTABLE;


-- ============================================================
--  LIGAS: COHORTES MENSUALES
-- ============================================================

-- Cada mes ("temporada", 'YYYY-MM' en UTC) el usuario compite contra ~30 personas de su
-- misma liga. El tamaño es adaptativo por construccion: una cohorte se llena hasta 30 y
-- solo entonces se abre otra, asi que con 12 usuarios en Bronce hay una sola cohorte de 12
-- (que es exactamente "todos los de tu liga") y con 400 hay 14 cohortes. El sistema degrada
-- solo a tabla por liga cuando hay poca gente, sin cambiar codigo.
CREATE TABLE ranking_cohorts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    season       TEXT        NOT NULL,
    league       SMALLINT    NOT NULL,
    member_count INTEGER     NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El literal 30 tambien vive en COHORT_SIZE del servicio; cambiarlo pide migracion, que es
-- lo correcto: reducirlo sin reindexar dejaria cohortes por encima del tope.
CREATE INDEX idx_ranking_cohorts_open
    ON ranking_cohorts (season, league, created_at)
    WHERE member_count < 30;


CREATE TABLE ranking_members (
    season    TEXT        NOT NULL,
    user_id   UUID        NOT NULL,
    cohort_id UUID        NOT NULL,

    -- Congelada al entrar a la temporada. Si el usuario sube de liga a mitad de mes no se
    -- le mueve de cohorte: no se cambia a nadie de competicion empezada. La liga nueva
    -- aplica a la temporada siguiente (el multiplicador de XP, ese si, aplica al instante).
    league    SMALLINT    NOT NULL,

    xp        INTEGER     NOT NULL DEFAULT 0,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (season, user_id),

    CONSTRAINT fk_ranking_members_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_ranking_members_cohort
        FOREIGN KEY (cohort_id)
        REFERENCES ranking_cohorts (id)
        ON DELETE CASCADE
);

-- La query del leaderboard: los miembros de una cohorte ordenados por XP.
CREATE INDEX idx_ranking_members_cohort_xp ON ranking_members (cohort_id, xp DESC);


-- ============================================================
--  TRIGGERS updated_at
-- ============================================================
-- Engancha set_updated_at() a toda tabla de public que tenga la columna
-- updated_at y aun no tenga el trigger. Idempotente: seguro de re-ejecutar.
-- Pegar este bloque en futuras migraciones que creen tablas con updated_at.
DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = 'public'
           AND c.relkind  = 'r'
           AND a.attname  = 'updated_at'
           AND NOT a.attisdropped
           AND NOT EXISTS (
               SELECT 1 FROM pg_trigger tg
                WHERE tg.tgrelid = c.oid
                  AND tg.tgname  = 'trg_' || c.relname || '_updated_at'
                  AND NOT tg.tgisinternal)
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    END LOOP;
END $$;


-- Down Migration

DROP FUNCTION IF EXISTS next_streak(DATE, DATE, INTEGER) CASCADE;

DROP TABLE IF EXISTS ranking_members;
DROP TABLE IF EXISTS ranking_cohorts;
DROP TABLE IF EXISTS user_stats;
DROP TABLE IF EXISTS activity_events;

ALTER TABLE users DROP COLUMN IF EXISTS timezone;
