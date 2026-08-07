import { logger } from '../lib/logger.js';
import { drainPendingDeletions } from './uploads.services.js';

const log = logger.child({ module: 'uploads' });

const DEFAULT_INTERVAL = 30 * 60 * 1000;

export function startDeletionWorker({ intervalMs = DEFAULT_INTERVAL } = {}) {
    const timer = setInterval(async () => {
        // Un throw sincrono aqui no tiene frame que lo recoja: seria uncaughtException
        // y tumbaria el proceso, no solo el drain.
        try {
            await drainPendingDeletions();
        } catch (error) {
            log.error({ err: error }, 'deletion.worker_failed');
        }
    }, intervalMs);

    // Sin unref, este intervalo mantendria el proceso vivo para siempre.
    timer.unref();
    
    log.info({ intervalMs }, 'deletion.worker_started');
    
    return () => clearInterval(timer);
}
