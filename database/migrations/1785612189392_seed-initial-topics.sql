-- Up Migration

-- Categorias iniciales para la pantalla de configuracion de una ruta y para las
-- preferencias del onboarding. Ajusta la lista a tu producto: son solo un punto de partida.
INSERT INTO topics (slug, name) VALUES
    ('programacion', 'Programacion'),
    ('diseno',       'Diseño'),
    ('negocios',     'Negocios'),
    ('idiomas',      'Idiomas'),
    ('ciencia',      'Ciencia'),
    ('salud',        'Salud y bienestar'),
    ('arte',         'Arte'),
    ('musica',       'Musica')
ON CONFLICT (slug) DO NOTHING;

-- Down Migration

DELETE FROM topics WHERE slug IN (
    'programacion', 'diseno', 'negocios', 'idiomas', 'ciencia', 'salud', 'arte', 'musica'
);
