-- Up Migration

-- Nullable a proposito: NULL significa "todavia no lo ha hecho" y es lo que el front mira
-- para decidir si enseña la pantalla de onboarding. Un booleano diria lo mismo pero no
-- CUANDO, que es justo lo que hace falta para medir cuanta gente lo completa.
ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;


-- Down Migration

ALTER TABLE users DROP COLUMN onboarding_completed_at;
