import { logger } from './logger.js';

export const withServiceError = (fn, fallback) => async (...args) => {
    try {
        return await fn(...args);
    } 
    catch (error) {
        logger.error({ err: error }, fallback.message);
        if (error.code) throw error;
        throw fallback;
    }
};
