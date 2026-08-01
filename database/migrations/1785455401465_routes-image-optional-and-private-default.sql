-- Up Migration

-- Las rutas nacen privadas: el autor las publica explicitamente cuando estan listas.
ALTER TABLE routes ALTER COLUMN is_published SET DEFAULT 'PRIVATE';

-- La imagen deja de ser obligatoria y pierde el placeholder;
-- una ruta sin imagen guarda NULL y el front decide que mostrar.
ALTER TABLE routes ALTER COLUMN image DROP DEFAULT;
ALTER TABLE routes ALTER COLUMN image DROP NOT NULL;


-- Down Migration

ALTER TABLE routes ALTER COLUMN is_published DROP DEFAULT;

-- Rellena las filas sin imagen antes de reponer el NOT NULL, para que
-- el rollback funcione aunque ya existan rutas sin imagen.
UPDATE routes SET image = 'https://placehold.co/600x400?text=Ruta' WHERE image IS NULL;
ALTER TABLE routes ALTER COLUMN image SET DEFAULT 'https://placehold.co/600x400?text=Ruta';
ALTER TABLE routes ALTER COLUMN image SET NOT NULL;
