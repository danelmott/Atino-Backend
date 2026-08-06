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
    UNAUTHORIZED: 401,
    ACCESS_DENIED: 403,
    MESSAGE_NOT_FOUND: 404,
    ANSWER_NOT_FOUND: 404,
    UPLOAD_SCOPE_INVALID: 400,
    UPLOAD_TYPE_NOT_ALLOWED: 415,
    UPLOAD_TOO_LARGE: 413,
    UPLOAD_NOT_FOUND: 404,
    ROUTE_NOT_FOUND: 404,
    ROUTE_EMPTY: 409,
    LESSON_NOT_FOUND: 404,
    QUIZ_NOT_FOUND: 404,
    INVALID_LESSON_REFERENCE: 400,
    INVALID_ORDER: 400,
    QUIZ_EMPTY: 409,
    INVALID_ANSWERS: 400,
    ATTEMPT_NOT_FOUND: 404,
    ROUTE_NOT_COMPLETED: 403,
    CANNOT_RATE_OWN_ROUTE: 403,
    RATING_NOT_FOUND: 404,
    INVALID_TIMEZONE: 400,
    SUBJECT_NOT_FOUND: 404,
    CANNOT_FOLLOW_SELF: 403,
};

/** Código de Postgres para violación de constraint UNIQUE. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Errores de librerías que traen status pero no `code` propio -- el 413 de express.json es el
 * habitual. Sin este mapa todos salían como UNAUTHORIZED y el cliente los leía como sesión caída.
 */
const LIB_STATUS_CODES = {
    401: 'UNAUTHORIZED',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
};

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

    const libStatus = err.status ?? err.statusCode;
    if (libStatus) {
        return res.status(libStatus).json({
            code: LIB_STATUS_CODES[libStatus] ?? 'REQUEST_FAILED',
            message: err.message ?? 'No se pudo completar la peticion',
        });
    }

    logger.error({ err }, 'unhandled error');
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Hubo un error inesperado' });
}
