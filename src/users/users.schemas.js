import z from 'zod';
import { SUBJECT_SELECTION } from './users.services.js';
import { subjectSlug } from '../routes/routes.schemas.js';

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
 * Los limites salen de SUBJECT_SELECTION en el service para que la regla viva en un solo
 * sitio. `subjectSlug` se reutiliza del modulo de rutas: es el mismo campo, y dos definiciones
 * del slug de una materia acabarian divergiendo.
 *
 * Son slugs y no uuid: el cliente manda ['matematicas', 'fisica'] tal cual, sin tener que
 * pedir antes el catalogo para traducir.
 */
const subjectsField = z
    .array(subjectSlug)
    .min(SUBJECT_SELECTION.min, "Elige al menos una materia")
    .max(SUBJECT_SELECTION.max, `Como maximo ${SUBJECT_SELECTION.max} materias`);

export const setSubjectsSchema = z.object({ subjects: subjectsField });

/**
 * El modal de onboarding manda las dos cosas juntas, asi que el schema las exige juntas: sin
 * nombre no hay avatar de iniciales en el cliente, y sin intereses el feed arranca a ciegas.
 */
export const completeOnboardingSchema = z.object({
    name: nameField,
    subjects: subjectsField,
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
