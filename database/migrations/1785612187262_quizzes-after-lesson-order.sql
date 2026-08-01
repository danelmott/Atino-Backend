-- Up Migration

-- Antes, lessons.position y quizzes.position eran dos secuencias independientes por ruta,
-- asi que no habia forma de decir "leccion 1, leccion 2, quiz 1, leccion 3". Ahora el quiz
-- cuelga de una leccion y aparece justo despues de ella.
ALTER TABLE quizzes DROP CONSTRAINT uq_quizzes_route_position;

-- NULL significa "al final de la ruta" (examen final), no "sin colocar".
ALTER TABLE quizzes ADD COLUMN after_lesson_id UUID;

-- SET NULL y no CASCADE: borrar una leccion no debe destruir el quiz, solo soltarlo al
-- final de la ruta. El contenido de un quiz es demasiado caro para perderlo en silencio.
ALTER TABLE quizzes
    ADD CONSTRAINT fk_quizzes_after_lesson
    FOREIGN KEY (after_lesson_id)
    REFERENCES lessons (id)
    ON DELETE SET NULL;

-- Uniqueness normal (NULLS DISTINCT, el defecto de Postgres) a proposito. Con
-- NULLS NOT DISTINCT el ON DELETE SET NULL de arriba puede chocar: al borrar una leccion,
-- su quiz cae a (ruta, NULL, posicion) y colisiona con un quiz final que ya este ahi,
-- haciendo fallar el DELETE de la leccion. Se prefiere que borrar nunca falle; el orden
-- entre varios quizzes finales lo desempata created_at en la consulta del indice.
-- DEFERRABLE para poder reordenar en un UPDATE masivo dentro de una transaccion.
ALTER TABLE quizzes
    ADD CONSTRAINT uq_quizzes_slot
    UNIQUE (route_id, after_lesson_id, position)
    DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX idx_quizzes_after_lesson ON quizzes (after_lesson_id);

-- Down Migration

DROP INDEX IF EXISTS idx_quizzes_after_lesson;

ALTER TABLE quizzes DROP CONSTRAINT IF EXISTS uq_quizzes_slot;
ALTER TABLE quizzes DROP CONSTRAINT IF EXISTS fk_quizzes_after_lesson;
ALTER TABLE quizzes DROP COLUMN IF EXISTS after_lesson_id;

ALTER TABLE quizzes
    ADD CONSTRAINT uq_quizzes_route_position
    UNIQUE (route_id, position) DEFERRABLE INITIALLY IMMEDIATE;
