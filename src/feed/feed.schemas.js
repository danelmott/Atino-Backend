import z from 'zod';

// Mismos limites que listQuerySchema en routes, para que el front pagine igual en los dos.
export const feedQuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
