-- Up Migration

CREATE TYPE lesson_content_type AS ENUM ('PARAGRAPH', 'SLIDES');
CREATE TYPE lesson_block_type   AS ENUM ('TEXT', 'IMAGE', 'VIDEO');
CREATE TYPE routes_published_status AS ENUM('PUBLIC', 'PRIVATE');


-- Las tablas del schema inicial eran stubs vacios (sin FKs ni contenido);
-- se reconstruyen desde cero en vez de parchearlas con ALTER TABLE.
DROP TABLE IF EXISTS quizess;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS routes;

CREATE TABLE routes (
    id               UUID                         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID                         NOT NULL,
    title            TEXT                         NOT NULL,
    description      TEXT,
    image            TEXT                         NOT NULL DEFAULT 'https://placehold.co/600x400?text=Ruta',
    is_published     routes_published_status      NOT NULL ,
    
    -- Contadores denormalizados, mantenidos por los triggers del final del archivo.
    rating_avg       NUMERIC(3,2)                 NOT NULL DEFAULT 0,
    rating_count     INTEGER                      NOT NULL DEFAULT 0,
    enrollment_count INTEGER                      NOT NULL DEFAULT 0,
    completion_count INTEGER                      NOT NULL DEFAULT 0,
    
    created_at       TIMESTAMPTZ                  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ                  NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_routes_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_routes_user_id    ON routes (user_id);
CREATE INDEX idx_routes_created_at ON routes (created_at DESC);
CREATE INDEX idx_routes_rating_avg ON routes (rating_avg DESC);
CREATE INDEX idx_routes_published  ON routes (created_at DESC) WHERE is_published = 'PUBLIC';



CREATE TABLE lessons (
    id           UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id     UUID                NOT NULL,
    title        TEXT                NOT NULL,
    content_type lesson_content_type NOT NULL DEFAULT 'PARAGRAPH',
    content      TEXT,
    position     INTEGER             NOT NULL,
    created_at   TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ         NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_lessons_route
        FOREIGN KEY (route_id)
        REFERENCES routes (id)
        ON DELETE CASCADE,
    
    -- DEFERRABLE para poder reordenar lecciones en un UPDATE masivo dentro de una transaccion.
    CONSTRAINT uq_lessons_route_position
        UNIQUE (route_id, position) DEFERRABLE INITIALLY IMMEDIATE,
    
    -- Una leccion de tipo parrafo obliga a tener texto; una de slides lo deja en NULL.
    CONSTRAINT ck_lessons_paragraph_content
        CHECK (content_type <> 'PARAGRAPH' OR content IS NOT NULL)
);

CREATE INDEX idx_lessons_route_id ON lessons (route_id);



-- Bloques de contenido de una leccion tipo SLIDES: texto, imagen o video.
CREATE TABLE lesson_blocks (
    id         UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id  UUID              NOT NULL,
    block_type lesson_block_type NOT NULL,
    text       TEXT,
    url        TEXT,
    position   INTEGER           NOT NULL,
    created_at TIMESTAMPTZ       NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ       NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_lesson_blocks_lesson
        FOREIGN KEY (lesson_id)
        REFERENCES lessons (id)
        ON DELETE CASCADE,
    
    CONSTRAINT uq_lesson_blocks_position
        UNIQUE (lesson_id, position) DEFERRABLE INITIALLY IMMEDIATE,
    
    -- TEXT necesita texto; IMAGE/VIDEO necesitan url (el texto queda como caption opcional).
    CONSTRAINT ck_lesson_blocks_payload
        CHECK (
            (block_type = 'TEXT' AND text IS NOT NULL) OR
            (block_type IN ('IMAGE', 'VIDEO') AND url IS NOT NULL)
        )
);

CREATE INDEX idx_lesson_blocks_lesson_id ON lesson_blocks (lesson_id);



-- ============================================================
--  QUIZZES
-- ============================================================

CREATE TABLE quizzes (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id   UUID        NOT NULL,
    title      TEXT        NOT NULL,
    position   INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_quizzes_route
        FOREIGN KEY (route_id)
        REFERENCES routes (id)
        ON DELETE CASCADE,

    CONSTRAINT uq_quizzes_route_position
        UNIQUE (route_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX idx_quizzes_route_id ON quizzes (route_id);



CREATE TABLE quiz_questions (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id    UUID        NOT NULL,
    question   TEXT        NOT NULL,
    image      TEXT,
    position   INTEGER     NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_quiz_questions_quiz
        FOREIGN KEY (quiz_id)
        REFERENCES quizzes (id)
        ON DELETE CASCADE,
    
    CONSTRAINT uq_quiz_questions_position
        UNIQUE (quiz_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX idx_quiz_questions_quiz_id ON quiz_questions (quiz_id);



CREATE TABLE quiz_options (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID        NOT NULL,
    text        TEXT        NOT NULL,
    is_correct  BOOLEAN     NOT NULL DEFAULT FALSE,
    position    INTEGER     NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_quiz_options_question
        FOREIGN KEY (question_id)
        REFERENCES quiz_questions (id)
        ON DELETE CASCADE,
    
    CONSTRAINT uq_quiz_options_position
        UNIQUE (question_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX idx_quiz_options_question_id ON quiz_options (question_id);

-- La DB garantiza que no haya dos respuestas correctas en la misma pregunta.
CREATE UNIQUE INDEX uq_quiz_options_one_correct
    ON quiz_options (question_id) WHERE is_correct;



-- ============================================================
--  RATING Y COMENTARIOS DE LA RUTA
-- ============================================================

CREATE TABLE route_ratings (
    route_id   UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    rating     SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Un rating por usuario por ruta (editable).
    PRIMARY KEY (route_id, user_id),

    CONSTRAINT fk_route_ratings_route
        FOREIGN KEY (route_id)
        REFERENCES routes (id)
        ON DELETE CASCADE,
    
    CONSTRAINT fk_route_ratings_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_route_ratings_user_id ON route_ratings (user_id);



CREATE TABLE route_comments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id   UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    comment    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_route_comments_route
        FOREIGN KEY (route_id)
        REFERENCES routes (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_route_comments_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_route_comments_route_id   ON route_comments (route_id);
CREATE INDEX idx_route_comments_user_id    ON route_comments (user_id);
CREATE INDEX idx_route_comments_created_at ON route_comments (created_at DESC);



-- ============================================================
--  PROGRESO Y ESTADISTICAS
-- ============================================================

CREATE TABLE route_enrollments (
    route_id         UUID        NOT NULL,
    user_id          UUID        NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (route_id, user_id),

    CONSTRAINT fk_route_enrollments_route
        FOREIGN KEY (route_id)
        REFERENCES routes (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_route_enrollments_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_route_enrollments_user_id      ON route_enrollments (user_id);
CREATE INDEX idx_route_enrollments_completed_at ON route_enrollments (completed_at);


CREATE TABLE lesson_completions (
    lesson_id    UUID        NOT NULL,
    user_id      UUID        NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (lesson_id, user_id),

    CONSTRAINT fk_lesson_completions_lesson
        FOREIGN KEY (lesson_id)
        REFERENCES lessons (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_lesson_completions_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_lesson_completions_user_id ON lesson_completions (user_id);


CREATE TABLE quiz_attempts (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id         UUID         NOT NULL,
    user_id         UUID         NOT NULL,
    score           NUMERIC(5,2) NOT NULL,
    correct_count   INTEGER      NOT NULL,
    total_questions INTEGER      NOT NULL,
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,

    CONSTRAINT fk_quiz_attempts_quiz
        FOREIGN KEY (quiz_id)
        REFERENCES quizzes (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_quiz_attempts_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_quiz_attempts_quiz_id ON quiz_attempts (quiz_id);
CREATE INDEX idx_quiz_attempts_user_id ON quiz_attempts (user_id);


-- ============================================================
--  TEMAS (onboarding + recomendacion)
-- ============================================================

CREATE TABLE topics (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       TEXT        NOT NULL UNIQUE,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE route_topics (
    route_id UUID NOT NULL,
    topic_id UUID NOT NULL,

    PRIMARY KEY (route_id, topic_id),

    CONSTRAINT fk_route_topics_route
        FOREIGN KEY (route_id)
        REFERENCES routes (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_route_topics_topic
        FOREIGN KEY (topic_id)
        REFERENCES topics (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_route_topics_topic_id ON route_topics (topic_id);


-- Intereses elegidos por el usuario en el onboarding.
CREATE TABLE user_topic_preferences (
    user_id    UUID        NOT NULL,
    topic_id   UUID        NOT NULL,
    weight     SMALLINT    NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, topic_id),

    CONSTRAINT fk_user_topic_preferences_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_topic_preferences_topic
        FOREIGN KEY (topic_id)
        REFERENCES topics (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_user_topic_preferences_topic_id ON user_topic_preferences (topic_id);


-- ============================================================
--  TRIGGERS DE CONTADORES DENORMALIZADOS
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_route_rating()
RETURNS TRIGGER AS $$
DECLARE
    target UUID;
BEGIN
    target := COALESCE(NEW.route_id, OLD.route_id);

    UPDATE routes r
        SET rating_avg   = COALESCE(agg.avg_rating, 0),
            rating_count = COALESCE(agg.n, 0)
        FROM (
            SELECT AVG(rating)::numeric(3,2) AS avg_rating,
                    COUNT(*)::int             AS n
                FROM route_ratings
            WHERE route_id = target
        ) agg
        WHERE r.id = target;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_route_ratings_refresh
    AFTER INSERT OR UPDATE OR DELETE ON route_ratings
    FOR EACH ROW EXECUTE FUNCTION refresh_route_rating();


CREATE OR REPLACE FUNCTION refresh_route_enrollment_stats()
RETURNS TRIGGER AS $$
DECLARE
    target UUID;
BEGIN
    target := COALESCE(NEW.route_id, OLD.route_id);
    
    UPDATE routes r
        SET enrollment_count = COALESCE(agg.total, 0),
            completion_count = COALESCE(agg.completed, 0)
        FROM (
            SELECT COUNT(*)::int            AS total,
                    COUNT(completed_at)::int AS completed
                FROM route_enrollments
            WHERE route_id = target
        ) agg
    WHERE r.id = target;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_route_enrollments_refresh
    AFTER INSERT OR UPDATE OR DELETE ON route_enrollments
    FOR EACH ROW EXECUTE FUNCTION refresh_route_enrollment_stats();




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

DROP FUNCTION IF EXISTS refresh_route_enrollment_stats() CASCADE;
DROP FUNCTION IF EXISTS refresh_route_rating() CASCADE;

DROP TABLE IF EXISTS user_topic_preferences;
DROP TABLE IF EXISTS route_topics;
DROP TABLE IF EXISTS topics;

DROP TABLE IF EXISTS quiz_attempts;
DROP TABLE IF EXISTS lesson_completions;
DROP TABLE IF EXISTS route_enrollments;

DROP TABLE IF EXISTS route_comments;
DROP TABLE IF EXISTS route_ratings;

DROP TABLE IF EXISTS quiz_options;
DROP TABLE IF EXISTS quiz_questions;
DROP TABLE IF EXISTS quizzes;

DROP TABLE IF EXISTS lesson_blocks;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS routes;

DROP TYPE IF EXISTS routes_published_status;
DROP TYPE IF EXISTS lesson_block_type;
DROP TYPE IF EXISTS lesson_content_type;

-- Se restauran los stubs originales del schema inicial, tal cual estaban.
CREATE TABLE routes (
    id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMP DEFAULT now(),
    rankend     FLOAT     DEFAULT (0.0)
);

CREATE TABLE lessons (
    id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE quizess (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
);
