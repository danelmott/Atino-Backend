import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe ser YYYY-MM-DD");

/** Un año de cuadritos mas las semanas sueltas de los extremos, como la rejilla de GitHub. */
const MAX_RANGE_DAYS = 371;

/**
 * Se admite el literal 'me' ademas del uuid: los tokens viven en cookies httpOnly, asi que
 * el cliente no puede leer su propio id, y el controlador lo resuelve contra el del token.
 */
export const userIdParamSchema = z.object({
    userId: z.union([uuid, z.literal('me')]),
});

/**
 * El rango se capa en el borde: sin tope, un cliente pide desde 1900 y se le devuelven
 * 45.000 objetos vacios que ademas hay que rellenar uno a uno en memoria.
 */
export const activityQuerySchema = z.object({
    from: day.optional(),
    to: day.optional(),
}).superRefine((data, ctx) => {
    if (!data.from || !data.to) return;

    if (data.from > data.to) {
        ctx.addIssue({ code: 'custom', path: ['from'], message: 'La fecha inicial es posterior a la final' });
        return;
    }

    const days = (Date.parse(`${data.to}T00:00:00Z`) - Date.parse(`${data.from}T00:00:00Z`)) / 86400000;
    if (days > MAX_RANGE_DAYS) {
        ctx.addIssue({ code: 'custom', path: ['to'], message: `El rango no puede superar ${MAX_RANGE_DAYS} dias` });
    }
});

export const seasonQuerySchema = z.object({
    season: z.string().regex(/^\d{4}-\d{2}$/, "La temporada debe ser YYYY-MM").optional(),
});

export const rankingQuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
