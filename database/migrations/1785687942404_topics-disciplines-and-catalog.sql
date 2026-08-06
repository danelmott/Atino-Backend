-- Up Migration

-- TEXT y no un enum a proposito, por lo mismo que activity_events.event_type: ALTER TYPE
-- ... ADD VALUE no se puede *usar* en la misma transaccion que lo crea, y node-pg-migrate
-- envuelve cada migracion en una. Añadir una disciplina nueva es un INSERT, no una migracion.
ALTER TABLE topics ADD COLUMN discipline TEXT;

-- Los 8 topics originales entran en el nuevo agrupamiento antes de poner el NOT NULL.
UPDATE topics SET discipline = 'Tecnologia'         WHERE slug = 'programacion';
UPDATE topics SET discipline = 'Arte y diseno'      WHERE slug IN ('diseno', 'arte', 'musica');
UPDATE topics SET discipline = 'Negocios'           WHERE slug = 'negocios';
UPDATE topics SET discipline = 'Idiomas'            WHERE slug = 'idiomas';
UPDATE topics SET discipline = 'Ciencias'           WHERE slug = 'ciencia';
UPDATE topics SET discipline = 'Salud y bienestar'  WHERE slug = 'salud';

INSERT INTO topics (slug, name, discipline) VALUES
    -- Tecnologia
    ('desarrollo-web',          'Desarrollo web',                'Tecnologia'),
    ('desarrollo-movil',        'Desarrollo movil',              'Tecnologia'),
    ('bases-de-datos',          'Bases de datos',                'Tecnologia'),
    ('ciberseguridad',          'Ciberseguridad',                'Tecnologia'),
    ('inteligencia-artificial', 'Inteligencia artificial',       'Tecnologia'),
    ('ciencia-de-datos',        'Ciencia de datos',              'Tecnologia'),
    ('devops',                  'DevOps e infraestructura',      'Tecnologia'),
    ('redes',                   'Redes y sistemas',              'Tecnologia'),
    ('videojuegos',             'Desarrollo de videojuegos',     'Tecnologia'),
    ('cloud',                   'Computacion en la nube',        'Tecnologia'),
    ('blockchain',              'Blockchain',                    'Tecnologia'),
    ('testing',                 'Testing y calidad de software', 'Tecnologia'),

    -- Ciencias
    ('matematicas',             'Matematicas',                   'Ciencias'),
    ('fisica',                  'Fisica',                        'Ciencias'),
    ('quimica',                 'Quimica',                       'Ciencias'),
    ('biologia',                'Biologia',                      'Ciencias'),
    ('astronomia',              'Astronomia',                    'Ciencias'),
    ('estadistica',             'Estadistica',                   'Ciencias'),
    ('geologia',                'Geologia',                      'Ciencias'),
    ('medio-ambiente',          'Medio ambiente y ecologia',     'Ciencias'),
    ('neurociencia',            'Neurociencia',                  'Ciencias'),
    ('ingenieria',              'Ingenieria',                    'Ciencias'),

    -- Salud y bienestar
    ('nutricion',               'Nutricion',                     'Salud y bienestar'),
    ('entrenamiento',           'Entrenamiento y fitness',       'Salud y bienestar'),
    ('salud-mental',            'Salud mental',                  'Salud y bienestar'),
    ('medicina',                'Medicina',                      'Salud y bienestar'),
    ('enfermeria',              'Enfermeria',                    'Salud y bienestar'),
    ('primeros-auxilios',       'Primeros auxilios',             'Salud y bienestar'),
    ('yoga',                    'Yoga y meditacion',             'Salud y bienestar'),
    ('descanso',                'Descanso y sueno',              'Salud y bienestar'),
    ('fisioterapia',            'Fisioterapia',                  'Salud y bienestar'),

    -- Negocios
    ('emprendimiento',          'Emprendimiento',                'Negocios'),
    ('marketing',               'Marketing',                     'Negocios'),
    ('marketing-digital',       'Marketing digital',             'Negocios'),
    ('finanzas',                'Finanzas personales',           'Negocios'),
    ('contabilidad',            'Contabilidad',                  'Negocios'),
    ('ventas',                  'Ventas',                        'Negocios'),
    ('gestion-proyectos',       'Gestion de proyectos',          'Negocios'),
    ('recursos-humanos',        'Recursos humanos',              'Negocios'),
    ('comercio-electronico',    'Comercio electronico',          'Negocios'),
    ('inversion',               'Inversion y bolsa',             'Negocios'),

    -- Arte y diseno
    ('diseno-grafico',          'Diseno grafico',                'Arte y diseno'),
    ('diseno-ux',               'Diseno UX/UI',                  'Arte y diseno'),
    ('ilustracion',             'Ilustracion',                   'Arte y diseno'),
    ('fotografia',              'Fotografia',                    'Arte y diseno'),
    ('video',                   'Video y edicion',               'Arte y diseno'),
    ('animacion',               'Animacion',                     'Arte y diseno'),
    ('arquitectura',            'Arquitectura',                  'Arte y diseno'),
    ('moda',                    'Moda y textil',                 'Arte y diseno'),
    ('teatro',                  'Teatro y actuacion',            'Arte y diseno'),
    ('danza',                   'Danza',                         'Arte y diseno'),
    ('produccion-musical',      'Produccion musical',            'Arte y diseno'),

    -- Humanidades
    ('historia',                'Historia',                      'Humanidades'),
    ('filosofia',               'Filosofia',                     'Humanidades'),
    ('literatura',              'Literatura',                    'Humanidades'),
    ('escritura',               'Escritura creativa',            'Humanidades'),
    ('psicologia',              'Psicologia',                    'Humanidades'),
    ('sociologia',              'Sociologia',                    'Humanidades'),
    ('derecho',                 'Derecho',                       'Humanidades'),
    ('economia',                'Economia',                      'Humanidades'),
    ('politica',                'Ciencia politica',              'Humanidades'),
    ('antropologia',            'Antropologia',                  'Humanidades'),

    -- Idiomas
    ('ingles',                  'Ingles',                        'Idiomas'),
    ('espanol',                 'Espanol',                       'Idiomas'),
    ('frances',                 'Frances',                       'Idiomas'),
    ('aleman',                  'Aleman',                        'Idiomas'),
    ('italiano',                'Italiano',                      'Idiomas'),
    ('portugues',               'Portugues',                     'Idiomas'),
    ('chino',                   'Chino mandarin',                'Idiomas'),
    ('japones',                 'Japones',                       'Idiomas'),

    -- Oficios y tecnica
    ('carpinteria',             'Carpinteria',                   'Oficios y tecnica'),
    ('electricidad',            'Electricidad',                  'Oficios y tecnica'),
    ('fontaneria',              'Fontaneria',                    'Oficios y tecnica'),
    ('mecanica',                'Mecanica automotriz',           'Oficios y tecnica'),
    ('soldadura',               'Soldadura',                     'Oficios y tecnica'),
    ('jardineria',              'Jardineria',                    'Oficios y tecnica'),
    ('cocina',                  'Cocina',                        'Oficios y tecnica'),
    ('reposteria',              'Reposteria',                    'Oficios y tecnica'),

    -- Desarrollo personal
    ('productividad',           'Productividad',                 'Desarrollo personal'),
    ('oratoria',                'Oratoria y comunicacion',       'Desarrollo personal'),
    ('liderazgo',               'Liderazgo',                     'Desarrollo personal'),
    ('tecnicas-estudio',        'Tecnicas de estudio',           'Desarrollo personal'),
    ('gestion-tiempo',          'Gestion del tiempo',            'Desarrollo personal'),
    ('creatividad',             'Creatividad',                   'Desarrollo personal'),
    ('negociacion',             'Negociacion',                   'Desarrollo personal'),
    ('habitos',                 'Habitos y disciplina',          'Desarrollo personal'),

    -- Comodin. No es decorativo: el backfill de la migracion siguiente lo necesita para las
    -- rutas que hoy no tienen ningun topic, que sin el no podrian cumplir el NOT NULL.
    ('otros',                   'Otros',                         'Otros')
ON CONFLICT (slug) DO NOTHING;

-- Solo ahora, cuando ninguna fila puede quedarse sin disciplina.
ALTER TABLE topics ALTER COLUMN discipline SET NOT NULL;

CREATE INDEX idx_topics_discipline ON topics (discipline);


-- Down Migration

DROP INDEX IF EXISTS idx_topics_discipline;

-- Deja solo los 8 originales. Ojo: si alguien añadio topics a mano despues de esta
-- migracion, este rollback tambien se los lleva.
DELETE FROM topics WHERE slug NOT IN (
    'programacion', 'diseno', 'negocios', 'idiomas', 'ciencia', 'salud', 'arte', 'musica'
);

ALTER TABLE topics DROP COLUMN discipline;
