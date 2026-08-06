┌─────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────┐
│ Qué quieres hacer                       │ Comando                                                                            │
├─────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
│ Aplicar todo lo pendiente               │ npm run migrate up                                                                 │
├─────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
│ Deshacer la última migración            │ npm run migrate down                                                               │
├─────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
│ Deshacer las últimas 3                  │ npm run migrate -- down 3                                                          │
├─────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
│ Ver el SQL sin ejecutarlo (para revisar │ npm run migrate -- up --dry-run                                                    │
│  antes de tocar Supabase)               │                                                                                    │
├─────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
│ Ver qué ya corrió                       │ SELECT * FROM pgmigrations; contra la DB, o mirar qué archivos en                  │
│                                         │ database/migrations/ tienen timestamp menor al último que corriste                 │
└─────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────┘

node-pg-migrate create nombre_de_la_migracion \
--migrations-dir database/migrations \
--migration-file-language sql

para crear una migracion
