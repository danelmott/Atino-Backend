-- Up Migration

-- La insignia de verificado, al estilo de Instagram: destaca a un usuario, y nada mas.
--
-- NO tiene relacion con users.email_verified, que es otra cosa por completo: aquella dice
-- que el correo se confirmo y es la que bloquea el login en auth.strategys.js. Esta es
-- editorial, la concede un ADMIN y no condiciona ningun permiso.
--
-- Booleano y no un timestamp como onboarding_completed_at: aqui solo interesa el estado
-- actual, y la insignia se puede quitar igual que se pone.
ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE;


-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS is_verified;
