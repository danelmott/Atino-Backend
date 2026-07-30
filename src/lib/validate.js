export const validate = (schema, source = 'body') => (req, res, next) => {
    try {
        req[source] = schema.parse(req[source]);
        next();
    } catch (error) {
        next(error);
    }
};
