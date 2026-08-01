import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

/**
 * Union discriminada por blockType: replica en el borde el CHECK ck_lesson_blocks_payload
 * de la base, para devolver un 400 legible en vez de un 23514 de Postgres.
 */
const blockSchema = z.discriminatedUnion('blockType', [
    z.object({
        blockType: z.literal('TEXT'),
        text: z.string().min(1, "El bloque de texto no puede estar vacio"),
    }),
    z.object({
        blockType: z.literal('IMAGE'),
        // Key de S3 devuelta por POST /uploads/sign.
        key: z.string().min(1, "La imagen es obligatoria"),
        text: z.string().max(300).optional(),
    }),
    z.object({
        blockType: z.literal('VIDEO'),
        key: z.string().min(1, "El video es obligatorio"),
        text: z.string().max(300).optional(),
    }),
]);

const lessonBody = z.object({
    title: z.string().min(3, "El titulo es demasiado corto").max(150, "El titulo es demasiado largo"),
    contentType: z.enum(['PARAGRAPH', 'SLIDES']),
    content: z.string().max(20000).optional(),
    blocks: z.array(blockSchema).max(50, "Como maximo 50 bloques").optional(),
}).superRefine((data, ctx) => {
    if (data.contentType === 'PARAGRAPH' && !data.content?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['content'], message: 'Una leccion de parrafo necesita texto' });
    }

    if (data.contentType === 'SLIDES' && (data.blocks?.length ?? 0) === 0) {
        ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'Una leccion de slides necesita al menos un bloque' });
    }
});

export const createLessonSchema = lessonBody;
export const updateLessonSchema = lessonBody;

export const reorderSchema = z.object({
    order: z.array(uuid).min(1, "La lista no puede estar vacia"),
});

export const idParamSchema = z.object({ id: uuid });
export const routeIdParamSchema = z.object({ routeId: uuid });
