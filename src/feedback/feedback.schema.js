import z from 'zod';

const messageField = z.string().min(1, "El mensaje no puede estar vacio").max(2000, "El mensaje es demasiado largo");

export const createMessageSchema = z.object({
    message: messageField,
});

export const updateMessageSchema = z.object({
    message: messageField,
});

export const createAnswerSchema = z.object({
    message: messageField,
});

export const updateAnswerSchema = z.object({
    message: messageField,
});

export const idParamSchema = z.object({
    id: z.string().uuid("Identificador invalido"),
});

export const paginationQuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(10),
});
