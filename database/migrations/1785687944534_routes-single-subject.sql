-- Up Migration

-- Una ruta pasa a tener exactamente un subject. El orden de los pasos importa: poner el
-- NOT NULL antes de los dos backfills falla, y borrar route_topics antes de leerlo deja
-- todas las rutas apuntando al comodin.

ALTER TABLE routes ADD COLUMN topic_id UUID;

-- De las rutas con varios topics se conserva uno solo. DISTINCT ON ordenado por nombre y
-- no por el orden fisico de la tabla para que el resultado sea reproducible: si hay que
-- repetir la migracion sobre otra copia de la base, elige el mismo.
UPDATE routes r
   SET topic_id = pick.topic_id
  FROM (
    SELECT DISTINCT ON (rt.route_id) rt.route_id, rt.topic_id
      FROM route_topics rt
      JOIN topics t ON t.id = rt.topic_id
     ORDER BY rt.route_id, t.name
  ) pick
 WHERE r.id = pick.route_id;

-- Las rutas que nunca tuvieron topic. Sin esto el SET NOT NULL de abajo aborta.
UPDATE routes
   SET topic_id = (SELECT id FROM topics WHERE slug = 'otros')
 WHERE topic_id IS NULL;

ALTER TABLE routes ALTER COLUMN topic_id SET NOT NULL;

-- RESTRICT y no CASCADE ni SET NULL: borrar un subject del catalogo no puede llevarse por
-- delante las rutas que lo usan ni dejarlas sin subject. Que falle el DELETE del topic es
-- justo el comportamiento que se quiere.
ALTER TABLE routes
    ADD CONSTRAINT fk_routes_topic
    FOREIGN KEY (topic_id)
    REFERENCES topics (id)
    ON DELETE RESTRICT;

CREATE INDEX idx_routes_topic_id ON routes (topic_id);

DROP TABLE route_topics;


-- Down Migration

CREATE TABLE route_topics (
    route_id UUID NOT NULL,
    topic_id UUID NOT NULL,

    PRIMARY KEY (route_id, topic_id),

    CONSTRAINT fk_route_topics_route
        FOREIGN KEY (route_id)
        REFERENCES routes (id)
        ON DELETE CASCADE,

    CONSTRAINT fk_route_topics_topic
        FOREIGN KEY (topic_id)
        REFERENCES topics (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_route_topics_topic_id ON route_topics (topic_id);

-- Se repuebla con el unico subject que sobrevivio. El rollback NO recupera los topics
-- adicionales que tuviera una ruta antes del Up: esa informacion se perdio al migrar.
INSERT INTO route_topics (route_id, topic_id)
    SELECT id, topic_id FROM routes;

DROP INDEX IF EXISTS idx_routes_topic_id;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS fk_routes_topic;
ALTER TABLE routes DROP COLUMN topic_id;
