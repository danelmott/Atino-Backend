-- Up Migration

-- El catalogo pasa a ser exactamente las catorce materias que /explore sabe pintar. Alli cada
-- una tiene banner, icono y tinte, y las tres se resuelven por slug: una ruta de un topic que
-- el front no conoce sale sin ninguna de las tres y sin que falle nada.
--
-- Se lleva por delante el comodin 'otros'. Ya no hace falta -- topicId es obligatorio al crear
-- una ruta -- y ademas tampoco tiene tile, asi que una ruta suya seria de las que no se ven.
-- La migracion 11 lo sigue necesitando para su backfill, pero corre antes que esta.
DELETE FROM topics WHERE slug NOT IN (
    'matematicas', 'biologia',          'quimica',           'fisica',
    'historia',    'ciencias-sociales', 'lengua-literatura', 'idiomas',
    'filosofia',   'arte',              'musica',            'programacion',
    'ingenieria',  'economia'
);

-- Las catorce son materias distintas y ninguna es submateria de otra, asi que el nivel de
-- agrupacion sobra. Con el se va el termino `discipline` del scoring del feed.
DROP INDEX IF EXISTS idx_topics_discipline;
ALTER TABLE topics DROP COLUMN discipline;

-- Las dos que faltaban. Sustituyen a 'sociologia' y 'literatura', que acaban de irse.
INSERT INTO topics (slug, name) VALUES
    ('ciencias-sociales', 'Ciencias sociales'),
    ('lengua-literatura', 'Lengua y literatura')
ON CONFLICT (slug) DO NOTHING;

-- Con tilde, para que el cliente pinte `name` tal cual en vez de mantener su propia tabla de
-- etiquetas. El slug no las lleva y no cambia: es la clave con la que resuelve icono y tinte.
UPDATE topics t SET name = v.name
  FROM (VALUES
    ('matematicas',  'Matemáticas'),
    ('biologia',     'Biología'),
    ('quimica',      'Química'),
    ('fisica',       'Física'),
    ('historia',     'Historia'),
    ('idiomas',      'Idiomas'),
    ('filosofia',    'Filosofía'),
    ('arte',         'Arte'),
    ('musica',       'Música'),
    ('programacion', 'Programación'),
    ('ingenieria',   'Ingeniería'),
    ('economia',     'Economía')
  ) AS v (slug, name)
 WHERE t.slug = v.slug;


-- Down Migration

ALTER TABLE topics ADD COLUMN discipline TEXT;

-- Repone el catalogo de la migracion 10. ON CONFLICT DO NOTHING deja intactas las catorce que
-- sobrevivieron, que por eso reciben su disciplina en el UPDATE de mas abajo.
INSERT INTO topics (slug, name, discipline) VALUES
    ('programacion',            'Programacion',                  'Tecnologia'),
    ('diseno',                  'Diseño',                        'Arte y diseno'),
    ('negocios',                'Negocios',                      'Negocios'),
    ('idiomas',                 'Idiomas',                       'Idiomas'),
    ('ciencia',                 'Ciencia',                       'Ciencias'),
    ('salud',                   'Salud y bienestar',             'Salud y bienestar'),
    ('arte',                    'Arte',                          'Arte y diseno'),
    ('musica',                  'Musica',                        'Arte y diseno'),

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

    ('nutricion',               'Nutricion',                     'Salud y bienestar'),
    ('entrenamiento',           'Entrenamiento y fitness',       'Salud y bienestar'),
    ('salud-mental',            'Salud mental',                  'Salud y bienestar'),
    ('medicina',                'Medicina',                      'Salud y bienestar'),
    ('enfermeria',              'Enfermeria',                    'Salud y bienestar'),
    ('primeros-auxilios',       'Primeros auxilios',             'Salud y bienestar'),
    ('yoga',                    'Yoga y meditacion',             'Salud y bienestar'),
    ('descanso',                'Descanso y sueno',              'Salud y bienestar'),
    ('fisioterapia',            'Fisioterapia',                  'Salud y bienestar'),

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

    ('ingles',                  'Ingles',                        'Idiomas'),
    ('espanol',                 'Espanol',                       'Idiomas'),
    ('frances',                 'Frances',                       'Idiomas'),
    ('aleman',                  'Aleman',                        'Idiomas'),
    ('italiano',                'Italiano',                      'Idiomas'),
    ('portugues',               'Portugues',                     'Idiomas'),
    ('chino',                   'Chino mandarin',                'Idiomas'),
    ('japones',                 'Japones',                       'Idiomas'),

    ('carpinteria',             'Carpinteria',                   'Oficios y tecnica'),
    ('electricidad',            'Electricidad',                  'Oficios y tecnica'),
    ('fontaneria',              'Fontaneria',                    'Oficios y tecnica'),
    ('mecanica',                'Mecanica automotriz',           'Oficios y tecnica'),
    ('soldadura',               'Soldadura',                     'Oficios y tecnica'),
    ('jardineria',              'Jardineria',                    'Oficios y tecnica'),
    ('cocina',                  'Cocina',                        'Oficios y tecnica'),
    ('reposteria',              'Reposteria',                    'Oficios y tecnica'),

    ('productividad',           'Productividad',                 'Desarrollo personal'),
    ('oratoria',                'Oratoria y comunicacion',       'Desarrollo personal'),
    ('liderazgo',               'Liderazgo',                     'Desarrollo personal'),
    ('tecnicas-estudio',        'Tecnicas de estudio',           'Desarrollo personal'),
    ('gestion-tiempo',          'Gestion del tiempo',            'Desarrollo personal'),
    ('creatividad',             'Creatividad',                   'Desarrollo personal'),
    ('negociacion',             'Negociacion',                   'Desarrollo personal'),
    ('habitos',                 'Habitos y disciplina',          'Desarrollo personal'),

    ('otros',                   'Otros',                         'Otros')
ON CONFLICT (slug) DO NOTHING;

-- Las catorce supervivientes: disciplina de vuelta y nombres sin tilde. Las dos nuevas se
-- quedan como filas de mas del catalogo restaurado en lugar de borrarse -- si para entonces
-- alguna ruta las usa, el ON DELETE RESTRICT de routes.topic_id abortaria el rollback entero.
UPDATE topics t SET name = v.name, discipline = v.discipline
  FROM (VALUES
    ('matematicas',       'Matematicas',         'Ciencias'),
    ('biologia',          'Biologia',            'Ciencias'),
    ('quimica',           'Quimica',             'Ciencias'),
    ('fisica',            'Fisica',              'Ciencias'),
    ('ingenieria',        'Ingenieria',          'Ciencias'),
    ('historia',          'Historia',            'Humanidades'),
    ('filosofia',         'Filosofia',           'Humanidades'),
    ('economia',          'Economia',            'Humanidades'),
    ('ciencias-sociales', 'Ciencias sociales',   'Humanidades'),
    ('lengua-literatura', 'Lengua y literatura', 'Humanidades'),
    ('idiomas',           'Idiomas',             'Idiomas'),
    ('arte',              'Arte',                'Arte y diseno'),
    ('musica',            'Musica',              'Arte y diseno'),
    ('programacion',      'Programacion',        'Tecnologia')
  ) AS v (slug, name, discipline)
 WHERE t.slug = v.slug;

ALTER TABLE topics ALTER COLUMN discipline SET NOT NULL;

CREATE INDEX idx_topics_discipline ON topics (discipline);
