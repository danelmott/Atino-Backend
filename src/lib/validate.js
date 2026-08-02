/**
 * En Express 5 `req.query` es un getter sin setter en el prototipo, asi que el
 * `req.query = ...` de toda la vida lanza "Cannot set property query of #<Object> which has
 * only a getter" -- y como los modulos ES corren en modo estricto, no falla en silencio:
 * revienta la peticion entera con un 500.
 *
 * defineProperty crea una propiedad propia que tapa la del prototipo, que es lo que el
 * codigo espera: el controlador lee siempre el valor ya parseado, con los .default() y los
 * .coerce() de zod aplicados. Sirve igual para body y params, que si son escribibles.
 */
const assign = (req, source, value) => {
    Object.defineProperty(req, source, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
};

export const validate = (schema, source = 'body') => (req, res, next) => {
    try {
        assign(req, source, schema.parse(req[source]));
        next();
    } catch (error) {
        next(error);
    }
};
