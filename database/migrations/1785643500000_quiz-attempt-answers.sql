-- Up Migration

-- El detalle de un intento: que contesto el usuario en cada pregunta. quiz_attempts solo
-- guarda el agregado (score, aciertos, total), asi que sin esto no hay pantalla de repaso.
--
-- Sin FK a quiz_questions ni a quiz_options, y con el texto copiado dentro: updateQuiz
-- borra y reinserta el arbol de preguntas entero en cada PUT, y eso cascadea a
-- quiz_options. Con FK, el primer autor que corrigiera una errata borraria las respuestas
-- de todos los intentos pasados, dejando los quiz_attempts vivos y vacios y sin ningun
-- error visible. El texto congelado ademas hace que el repaso muestre el quiz tal y como
-- estaba cuando se respondio, no como quedo despues.
CREATE TABLE quiz_attempt_answers (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id    UUID        NOT NULL,
    question_id   UUID        NOT NULL,

    -- NULL = pregunta saltada. Se guarda igual para que el repaso distinga "la deje en
    -- blanco" de "la falle", que no son el mismo error.
    option_id     UUID,

    is_correct    BOOLEAN     NOT NULL,
    question_text TEXT        NOT NULL,
    option_text   TEXT,
    position      INTEGER     NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_quiz_attempt_answers_attempt
        FOREIGN KEY (attempt_id)
        REFERENCES quiz_attempts (id)
        ON DELETE CASCADE,

    CONSTRAINT uq_quiz_attempt_answers_question
        UNIQUE (attempt_id, question_id)
);

CREATE INDEX idx_quiz_attempt_answers_attempt ON quiz_attempt_answers (attempt_id);

-- Sin updated_at a proposito: la respuesta de un intento es un hecho historico, no se edita.

-- El historial de intentos de un usuario en un quiz, que es como se consulta siempre.
CREATE INDEX idx_quiz_attempts_quiz_user ON quiz_attempts (quiz_id, user_id, completed_at DESC);


-- Down Migration

DROP INDEX IF EXISTS idx_quiz_attempts_quiz_user;
DROP TABLE IF EXISTS quiz_attempt_answers;
