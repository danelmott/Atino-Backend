import z from 'zod';
import { TOPIC_SELECTION } from './users.services.js';

/**
 * Se valida contra la lista de zonas IANA que conoce el propio Node en vez de con un regex:
 * "America/Bogota" y "America/Bogata" tienen la misma forma y solo una existe.
 * El servicio ademas la sondea contra Postgres antes de guardarla, porque las dos listas no
 * son exactamente la misma.
 */
const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const updateTimezoneSchema = z.object({
    timezone: z.string().refine((value) => TIMEZONES.has(value), "La zona horaria no es valida"),
});

const nameField = z.string().trim().min(2, "El nombre es demasiado corto").max(80, "El nombre es demasiado largo");

export const updateProfileSchema = z.object({ name: nameField });

/**
 * Los limites salen de TOPIC_SELECTION en el service para que la regla viva en un solo
 * sitio. El maximo coincide con el de topicIds que ya tenian las rutas.
 */
const topicIdsField = z
    .array(z.string().uuid("Identificador invalido"))
    .min(TOPIC_SELECTION.min, "Elige al menos una categoria")
    .max(TOPIC_SELECTION.max, `Como maximo ${TOPIC_SELECTION.max} categorias`);

export const setTopicsSchema = z.object({ topicIds: topicIdsField });

/**
 * El modal de onboarding manda las dos cosas juntas, asi que el schema las exige juntas: sin
 * nombre no hay avatar de iniciales en el cliente, y sin intereses el feed arranca a ciegas.
 */
export const completeOnboardingSchema = z.object({
    name: nameField,
    topicIds: topicIdsField,
});

/**
 * Solo uuid, sin el literal 'me' que si acepta gamification: aqui /users/me ya lo captura la
 * ruta declarada encima, y devuelve el perfil completo en vez del publico.
 */
export const userIdParamSchema = z.object({
    userId: z.string().uuid("Identificador invalido"),
});

/**
 * Un booleano explicito y no un POST/DELETE: el mismo endpoint pone y quita la insignia, y
 * asi el panel de admin manda el estado que quiere dejar en vez de tener que saber el actual.
 */
export const setVerifiedSchema = z.object({
    verified: z.boolean({ message: "Indica si el usuario queda verificado o no" }),
});

// Mismos limites que listQuerySchema en routes, para que el front pagine igual en todo.
export const listQuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
