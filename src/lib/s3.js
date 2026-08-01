import { S3Client } from '@aws-sdk/client-s3';
import { requireEnv } from './env.js';

// Son los nombres que el SDK v3 lee solo, pero se pasan explicitos igual: asi el
// server revienta al arrancar si falta una var, en vez de fallar en la primera subida.
export const s3 = new S3Client({
    region: requireEnv('AWS_REGION'),
    // Sin esto el SDK agrega x-amz-checksum-crc32 a las URLs prefirmadas, calculado sobre un
    // cuerpo vacio (AAAAAA==) porque al firmar todavia no hay contenido. S3 despues valida ese
    // checksum contra lo que realmente sube el cliente y rechaza cualquier archivo no vacio.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
        accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
    },
});

export const BUCKET = requireEnv('S3_BUCKET');
