import z from 'zod';

export const searchQuerySchema = z.object({
    q: z.string().trim().min(1, "Escribe algo para buscar").max(80, "La busqueda es demasiado larga"),
    // Mismos limites que listQuerySchema en routes, para que el front pagine igual en todo.
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
