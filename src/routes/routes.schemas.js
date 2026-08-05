import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

export const createRouteSchema = z.object({
    title: z.string().min(3, "El titulo es demasiado corto").max(120, "El titulo es demasiado largo"),
    description: z.string().max(2000, "La descripcion es demasiado larga").optional(),
    // Key de S3 devuelta por POST /uploads/sign, no una URL.
    image: z.string().min(1).optional(),
    // Exactamente uno y obligatorio: sin subject la ruta no puede entrar en el feed.
    topicId: uuid,
});

export const updateRouteSchema = z.object({
    title: z.string().min(3).max(120).optional(),
    description: z.string().max(2000).optional(),
    topicId: uuid.optional(),
});

export const updateCoverSchema = z.object({
    image: z.string().min(1).nullable(),
});

export const visibilitySchema = z.object({
    status: z.enum(['PUBLIC', 'PRIVATE']),
});

export const idParamSchema = z.object({ id: uuid });

/**
 * `mine` NO puede ser z.coerce.boolean(): eso es Boolean(string), y toda cadena no vacia es
 * true -- incluida "false". Con el coerce, ?mine=false devolvia las rutas propias y la unica
 * forma de pedir el listado publico era omitir el parametro.
 */
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

export const listQuerySchema = z.object({
    mine: queryBoolean.default('false'),
    // El slug de la materia, no su uuid: el slug es el contrato con el front, que resuelve
    // banner, icono y tinte a partir de el.
    topic: z.string().trim().min(1).max(60).optional(),
    sort: z.enum(['recent', 'rating']).default('recent'),
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
