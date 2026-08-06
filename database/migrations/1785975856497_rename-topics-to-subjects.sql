-- Up Migration

-- `topics` pasa a `subjects` y el SLUG pasa a ser la clave primaria.
--
-- Son catorce filas fijas que nadie crea ni renombra, y `slug` ya era NOT NULL UNIQUE: el uuid
-- solo obligaba al cliente a pedir el catalogo entero para traducir 'matematicas' antes de
-- poder mandar nada. Las FK llevan ON UPDATE CASCADE porque una clave natural si se renombra.

CREATE TABLE subjects (
    slug       TEXT        PRIMARY KEY,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sin updated_at, igual que `topics`: el bloque DO que engancha set_updated_at() recorre las
-- tablas que tengan esa columna, y un catalogo fijo no se auto-toca.

INSERT INTO subjects (slug, name, created_at)
SELECT slug, name, created_at FROM topics;


-- ============================================================
--  RUTAS
-- ============================================================

ALTER TABLE routes ADD COLUMN subject_slug TEXT;

UPDATE routes r SET subject_slug = t.slug FROM topics t WHERE t.id = r.topic_id;

-- Solo cuando ninguna fila puede quedarse sin materia, igual que hizo la migracion 11.
ALTER TABLE routes ALTER COLUMN subject_slug SET NOT NULL;

-- RESTRICT y no CASCADE ni SET NULL, igual que la FK que sustituye: borrar una materia del
-- catalogo no puede llevarse por delante las rutas que la usan ni dejarlas sin materia. Que
-- falle el DELETE es justo el comportamiento que se quiere.
ALTER TABLE routes
    ADD CONSTRAINT fk_routes_subject
    FOREIGN KEY (subject_slug)
    REFERENCES subjects (slug)
    ON UPDATE CASCADE
    ON DELETE RESTRICT;

CREATE INDEX idx_routes_subject_slug ON routes (subject_slug);

DROP INDEX IF EXISTS idx_routes_topic_id;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS fk_routes_topic;
ALTER TABLE routes DROP COLUMN topic_id;


-- ============================================================
--  PREFERENCIAS DEL USUARIO (ONBOARDING)
-- ============================================================

-- Se va `weight SMALLINT NOT NULL DEFAULT 1`: no lo escribia ni lo leia nadie. El termino
-- `preference` del feed es un 0/1 plano (CASE WHEN p.subject_slug IS NOT NULL), asi que la
-- columna era peso muerto que aparentaba una funcionalidad que no existe.
CREATE TABLE user_subject_preferences (
    user_id      UUID        NOT NULL,
    subject_slug TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, subject_slug),

    CONSTRAINT fk_user_subject_preferences_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_user_subject_preferences_subject
        FOREIGN KEY (subject_slug)
        REFERENCES subjects (slug)
        ON UPDATE CASCADE
        ON DELETE CASCADE
);

CREATE INDEX idx_user_subject_preferences_subject_slug
    ON user_subject_preferences (subject_slug);

INSERT INTO user_subject_preferences (user_id, subject_slug, created_at)
SELECT utp.user_id, t.slug, utp.created_at
  FROM user_topic_preferences utp
  JOIN topics t ON t.id = utp.topic_id;

DROP TABLE user_topic_preferences;
DROP TABLE topics;


-- ============================================================
--  DESAMBIGUACION EN GAMIFICACION
-- ============================================================

-- `subject_id` nunca fue una materia: es el id de la ruta, leccion o quiz del evento. Con
-- `subjects` ocupando la palabra, quedaria enfrentado a `subject_slug` para siempre.
--
-- uq_activity_events_xp_once no hay que recrearlo: Postgres guarda las columnas del indice por
-- numero de atributo, asi que el RENAME lo sigue solo.
ALTER TABLE activity_events RENAME COLUMN subject_id TO target_id;


-- Down Migration

ALTER TABLE activity_events RENAME COLUMN target_id TO subject_id;

CREATE TABLE topics (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       TEXT        NOT NULL UNIQUE,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los uuid son nuevos: los originales se perdieron al pasar al slug. Nada externo los
-- referenciaba, asi que la unica consecuencia es que un cliente que hubiera cacheado el
-- catalogo antiguo veria ids distintos.
INSERT INTO topics (slug, name, created_at)
SELECT slug, name, created_at FROM subjects;

ALTER TABLE routes ADD COLUMN topic_id UUID;

UPDATE routes r SET topic_id = t.id FROM topics t WHERE t.slug = r.subject_slug;

ALTER TABLE routes ALTER COLUMN topic_id SET NOT NULL;

ALTER TABLE routes
    ADD CONSTRAINT fk_routes_topic
    FOREIGN KEY (topic_id)
    REFERENCES topics (id)
    ON DELETE RESTRICT;

CREATE INDEX idx_routes_topic_id ON routes (topic_id);

DROP INDEX IF EXISTS idx_routes_subject_slug;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS fk_routes_subject;
ALTER TABLE routes DROP COLUMN subject_slug;

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

-- `weight` se queda en su default: el Up no lo conservo porque nadie lo escribia.
INSERT INTO user_topic_preferences (user_id, topic_id, created_at)
SELECT usp.user_id, t.id, usp.created_at
  FROM user_subject_preferences usp
  JOIN topics t ON t.slug = usp.subject_slug;

DROP TABLE user_subject_preferences;
DROP TABLE subjects;
