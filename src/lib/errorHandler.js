import { ZodError } from 'zod';
import { logger } from './logger.js';

const ERROR_STATUS = {
    USER_ALREADY_EXISTS: 409,
    USER_NOT_FOUND: 404,
    EMAIL_ALREADY_VERIFIED: 409,
    VERIFICATION_CODE_NOT_FOUND: 404,
    VERIFICATION_EXPIRED: 410,
    INVALID_VERIFICATION_CODE: 400,
    INVALID_REFRESH_TOKEN: 401,
    INVALID_CREDENTIALS: 401,
};

/** Código de Postgres para violación de constraint UNIQUE. */
const PG_UNIQUE_VIOLATION = '23505';

export const errorHandler = (err, req, res, next) => {
    if (err instanceof ZodError) {
        return res.status(400).json({
            code: 'VALIDATION_ERROR',
            message: 'Datos invalidos',
            issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        });
    }

    if (err.code === PG_UNIQUE_VIOLATION) {
        return res.status(409).json({ code: 'ALREADY_EXISTS', message: 'El recurso ya existe' });
    }

    // Errores propios, siempre lanzados como `throw {code, message}` -- el mensaje ya está pensado para el cliente.
    if (err.code) {
        const status = ERROR_STATUS[err.code] ?? 500;
        if (status === 500) logger.error({ err }, err.message);
        return res.status(status).json({ code: err.code, message: err.message });
    }

    // Errores de librerías de terceros (p. ej. passport con failWithError) que traen su propio status.
    const libStatus = err.status ?? err.statusCode;
    if (libStatus) {
        return res.status(libStatus).json({ code: 'UNAUTHORIZED', message: err.message ?? 'No autorizado' });
    }

    logger.error({ err }, 'unhandled error');
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Hubo un error inesperado' });
}
