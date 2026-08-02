import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

/**
 * Solo se manda lo contestado: una pregunta ausente cuenta como saltada, no como error de
 * validacion. Lo que si se rechaza es mandar dos veces la misma pregunta, porque entonces
 * no hay una respuesta unica que calificar.
 */
export const submitAttemptSchema = z.object({
    answers: z.array(z.object({
        questionId: uuid,
        optionId: uuid,
    })).max(50, "Demasiadas respuestas"),
}).superRefine((data, ctx) => {
    const ids = data.answers.map((answer) => answer.questionId);
    if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: 'custom', path: ['answers'], message: 'Hay dos respuestas para la misma pregunta' });
    }
});

export const idParamSchema = z.object({ id: uuid });
