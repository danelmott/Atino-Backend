import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

/** Replica el CHECK (rating BETWEEN 1 AND 5) de la base para dar un 400 legible. */
export const rateRouteSchema = z.object({
    rating: z.coerce.number().int().min(1, "La puntuacion minima es 1").max(5, "La puntuacion maxima es 5"),
});

export const routeIdParamSchema = z.object({ routeId: uuid });
