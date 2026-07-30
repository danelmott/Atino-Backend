CREATE TYPE roles AS ENUM ('USER', 'ADMIN');
CREATE TYPE auth_provider AS ENUM ('LOCAL', 'GOOGLE');


CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;



CREATE TABLE users (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT        NOT NULL UNIQUE,
    email_verified BOOLEAN     NOT NULL DEFAULT FALSE,
    name           TEXT,
    password       TEXT,
    image          TEXT,
    role           roles       NOT NULL DEFAULT 'USER',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE accounts (
    id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID          NOT NULL,
    provider            auth_provider NOT NULL,
    provider_account_id TEXT          NOT NULL,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_accounts_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    
    -- La identidad externa (ese Google id) es única en todo el sistema.
    CONSTRAINT uq_accounts_provider_account
        UNIQUE (provider, provider_account_id),
    
    -- Un usuario no puede tener dos cuentas del mismo proveedor.
    CONSTRAINT uq_accounts_user_provider
        UNIQUE (user_id, provider)
);

CREATE INDEX idx_accounts_user_id ON accounts (user_id);


CREATE TABLE refresh_tokens (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    token      TEXT        NOT NULL UNIQUE,
    user_id    UUID        NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_refresh_tokens_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);


CREATE TABLE verification_codes (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code       TEXT        NOT NULL,
    user_id    UUID        NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_verification_codes_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_verification_codes_user_id ON verification_codes (user_id);
CREATE INDEX idx_verification_codes_code    ON verification_codes (code);


-- ============================================================
--  FEEDBACK
-- ============================================================

CREATE TABLE feedback_messages (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL,
    message    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_feedback_messages_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_feedback_messages_user_id    ON feedback_messages (user_id);
CREATE INDEX idx_feedback_messages_created_at ON feedback_messages (created_at DESC);

CREATE TRIGGER trg_feedback_messages_updated_at
    BEFORE UPDATE ON feedback_messages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE feedback_answers (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL,
    answered_message_id UUID        NOT NULL,
    message             TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT fk_feedback_answers_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    
    CONSTRAINT fk_feedback_answers_message
        FOREIGN KEY (answered_message_id)
        REFERENCES feedback_messages (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_feedback_answers_user_id    ON feedback_answers (user_id);
CREATE INDEX idx_feedback_answers_message_id ON feedback_answers (answered_message_id);

CREATE TRIGGER trg_feedback_answers_updated_at
    BEFORE UPDATE ON feedback_answers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE feedback_message_likes (
    message_id UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    PRIMARY KEY (message_id, user_id),
    
    CONSTRAINT fk_feedback_message_likes_message
        FOREIGN KEY (message_id)
        REFERENCES feedback_messages (id)
        ON DELETE CASCADE,
    
    CONSTRAINT fk_feedback_message_likes_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_feedback_message_likes_user_id ON feedback_message_likes (user_id);


CREATE TABLE feedback_answer_likes (
    answer_id  UUID        NOT NULL,
    user_id    UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    PRIMARY KEY (answer_id, user_id),
    
    CONSTRAINT fk_feedback_answer_likes_answer
        FOREIGN KEY (answer_id)
        REFERENCES feedback_answers (id)
        ON DELETE CASCADE,
    
    CONSTRAINT fk_feedback_answer_likes_user
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_feedback_answer_likes_user_id ON feedback_answer_likes (user_id);



/*ROUTES TABLES*/
CREATE TABLE routes (
    id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMP DEFAULT now(),
    rankend     FLOAT     DEFAULT(0.0),
);

CREATE TABLE lessons (
    id         UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP DEFAULT now(),
);

CREATE TABLE quizess (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
);
