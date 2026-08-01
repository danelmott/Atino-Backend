-- Up Migration

-- Cola de objetos de S3 pendientes de borrar. Se llena dentro de la misma transaccion
-- que borra las filas de la base, para que una caida del proceso no pueda perder una key
-- y dejar el objeto huerfano en el bucket para siempre.
CREATE TABLE pending_deletions (
    id         BIGSERIAL   PRIMARY KEY,
    key        TEXT        NOT NULL UNIQUE,
    attempts   SMALLINT    NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El worker solo mira las que todavia tienen reintentos disponibles.
CREATE INDEX idx_pending_deletions_claimable
    ON pending_deletions (created_at)
    WHERE attempts < 5;

-- Down Migration

DROP TABLE IF EXISTS pending_deletions;
