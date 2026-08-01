import z from 'zod';

const uuid = z.string().uuid("Identificador invalido");

const optionSchema = z.object({
    text: z.string().min(1, "La opcion no puede estar vacia").max(500),
    isCorrect: z.boolean().default(false),
});

const questionSchema = z.object({
    question: z.string().min(1, "La pregunta no puede estar vacia").max(1000),
    // Key de S3 devuelta por POST /uploads/sign; la imagen es opcional.
    image: z.string().min(1).optional(),
    options: z.array(optionSchema)
        .min(2, "Una pregunta necesita al menos dos opciones")
        .max(6, "Como maximo 6 opciones"),
}).superRefine((data, ctx) => {
    // Replica el indice parcial uq_quiz_options_one_correct de la base.
    const correct = data.options.filter((option) => option.isCorrect).length;

    if (correct !== 1) {
        ctx.addIssue({
            code: 'custom',
            path: ['options'],
            message: 'Debe haber exactamente una opcion correcta',
        });
    }
});

const quizBody = z.object({
    title: z.string().min(3, "El titulo es demasiado corto").max(150, "El titulo es demasiado largo"),
    // null o ausente = el quiz va al final de la ruta.
    afterLessonId: uuid.nullable().optional(),
    questions: z.array(questionSchema)
        .min(1, "El quiz necesita al menos una pregunta")
        .max(50, "Como maximo 50 preguntas"),
});

export const createQuizSchema = quizBody;
export const updateQuizSchema = quizBody;

export const idParamSchema = z.object({ id: uuid });
export const routeIdParamSchema = z.object({ routeId: uuid });
