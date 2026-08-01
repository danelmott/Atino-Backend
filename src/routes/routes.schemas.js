import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

export const createRouteSchema = z.object({
    title: z.string().min(3, "El titulo es demasiado corto").max(120, "El titulo es demasiado largo"),
    description: z.string().max(2000, "La descripcion es demasiado larga").optional(),
    // Key de S3 devuelta por POST /uploads/sign, no una URL.
    image: z.string().min(1).optional(),
    topicIds: z.array(uuid).max(5, "Como maximo 5 categorias").optional(),
});

export const updateRouteSchema = z.object({
    title: z.string().min(3).max(120).optional(),
    description: z.string().max(2000).optional(),
    topicIds: z.array(uuid).max(5, "Como maximo 5 categorias").optional(),
});

export const updateCoverSchema = z.object({
    image: z.string().min(1).nullable(),
});

export const visibilitySchema = z.object({
    status: z.enum(['PUBLIC', 'PRIVATE']),
});

export const idParamSchema = z.object({ id: uuid });

export const listQuerySchema = z.object({
    mine: z.coerce.boolean().default(false),
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
