import { logger } from '../lib/logger.js';
import { drainPendingDeletions } from './uploads.services.js';

const log = logger.child({ module: 'uploads' });

/*
30 minutes in miliseconds
5 reintents 
*/
const DEFAULT_INTERVAL = 30 * 60 * 1000;


//function 
export function startDeletionWorker({ intervalMs = DEFAULT_INTERVAL } = {}) {
    const timer = setInterval(() => {
        ahh ().catch((error) => log.error({ err: error }, 'deletion.worker_failed'));
    }, intervalMs);
    
    // Sin unref, este intervalo mantendria el proceso vivo para siempre.
    timer.unref();
    
    log.info({ intervalMs }, 'deletion.worker_started');
    
    return () => clearInterval(timer);
}
