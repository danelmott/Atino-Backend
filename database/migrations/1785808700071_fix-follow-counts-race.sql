-- Up Migration

-- Arregla una condicion de carrera en refresh_user_follow_counts que dejaba contadores por
-- debajo del valor real cuando dos follows que tocan al mismo usuario entraban a la vez: con
-- A siguiendo a B mientras B seguia a A, uno de los cuatro contadores se quedaba en 0.
--
-- La causa no era el deadlock -- ese ya lo evitaba el orden por uuid -- sino un lost update.
-- El trigger recontaba con COUNT(*), y esa subconsulta se evalua con el snapshot del INSERT
-- que disparo el trigger, no con uno nuevo: la transaccion que llegaba segunda contaba SIN la
-- fila que la primera acababa de confirmar y pisaba el valor bueno.
--
-- Tomar los locks antes de contar no arregla nada, porque el problema es el snapshot y no el
-- orden de bloqueo. La solucion es no recontar: sumar y restar de uno en uno. Un
-- `followers_count + 1` no lee el conteo de ninguna tabla, lee la propia fila ya bloqueada, y
-- Postgres garantiza que ahi se usa la version mas reciente de esa fila. Es exacto porque el
-- trigger es FOR EACH ROW y salta en las tres operaciones: ninguna alta o baja se le escapa.
--
-- Se pierde a cambio la propiedad de repararse solo que tenia el recuento total, y por eso el
-- UPDATE de saneamiento del final: deja los contadores cuadrados antes de empezar a delegar
-- en los deltas.
--
-- Aqui SI hace falta TG_OP, al reves que en refresh_route_rating(): aquel recuenta y le da
-- igual la operacion, este necesita saber si suma o resta.
--
-- Nota: refresh_route_rating() y refresh_route_enrollment_stats() comparten el patron del
-- recuento y por tanto el mismo fallo teorico. No se tocan aqui porque hacen falta dos votos
-- simultaneos sobre la misma ruta para que se manifieste, pero conviene tenerlo anotado.
CREATE OR REPLACE FUNCTION refresh_user_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- En orden de uuid, para que dos follows cruzados simultaneos no se bloqueen entre si.
        IF NEW.follower_id < NEW.following_id THEN
            UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
            UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
        ELSE
            UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
            UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        IF OLD.follower_id < OLD.following_id THEN
            UPDATE users SET following_count = following_count - 1 WHERE id = OLD.follower_id;
            UPDATE users SET followers_count = followers_count - 1 WHERE id = OLD.following_id;
        ELSE
            UPDATE users SET followers_count = followers_count - 1 WHERE id = OLD.following_id;
            UPDATE users SET following_count = following_count - 1 WHERE id = OLD.follower_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Cuadra lo que la carrera hubiese dejado torcido hasta ahora.
UPDATE users u
   SET followers_count = (SELECT COUNT(*)::int FROM user_follows WHERE following_id = u.id),
       following_count = (SELECT COUNT(*)::int FROM user_follows WHERE follower_id  = u.id);


-- Down Migration

-- Vuelve al recuento total de 1785804639631_users-follows.sql, con su carrera incluida.
CREATE OR REPLACE FUNCTION refresh_user_follow_counts()
RETURNS TRIGGER AS $$
DECLARE
    follower  UUID;
    followed  UUID;
    first_id  UUID;
    second_id UUID;
BEGIN
    follower := COALESCE(NEW.follower_id, OLD.follower_id);
    followed := COALESCE(NEW.following_id, OLD.following_id);

    first_id  := LEAST(follower, followed);
    second_id := GREATEST(follower, followed);

    UPDATE users u
       SET followers_count = (SELECT COUNT(*)::int FROM user_follows WHERE following_id = first_id),
           following_count = (SELECT COUNT(*)::int FROM user_follows WHERE follower_id  = first_id)
     WHERE u.id = first_id;

    UPDATE users u
       SET followers_count = (SELECT COUNT(*)::int FROM user_follows WHERE following_id = second_id),
           following_count = (SELECT COUNT(*)::int FROM user_follows WHERE follower_id  = second_id)
     WHERE u.id = second_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
