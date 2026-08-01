import z from 'zod';
import { UPLOAD_SCOPES } from './uploads.services.js';

export const createUploadUrlSchema = z.object({
    // Se deriva de UPLOAD_SCOPES para que el schema y la politica no se desincronicen.
    scope: z.enum(Object.keys(UPLOAD_SCOPES)),
    contentType: z.string().min(1, "El tipo de contenido es obligatorio"),
    size: z.coerce.number().int().positive("El tamaño del archivo debe ser mayor a cero"),
});
