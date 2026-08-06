import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

/**
 * Se admite el literal 'me' ademas del uuid, igual que en gamification: los tokens viven en
 * cookies httpOnly, asi que el cliente no puede leer su propio id. Aqui hace falta de verdad
 * para /users/me/followers y /users/me/following.
 */
export const userIdParamSchema = z.object({
    userId: z.union([uuid, z.literal('me')]),
});

// Mismos limites que listQuerySchema en routes, para que el front pagine igual en todo.
export const listQuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
