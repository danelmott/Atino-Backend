import z from 'zod';
import { SUBJECT_SELECTION } from './users.services.js';
import { subjectSlug } from '../routes/routes.schemas.js';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const updateTimezoneSchema = z.object({
    timezone: z.string().refine((value) => TIMEZONES.has(value), "La zona horaria no es valida"),
});

const nameField = z.string().trim().min(2, "El nombre es demasiado corto").max(80, "El nombre es demasiado largo");

export const updateProfileSchema = z.object({ name: nameField });

const subjectsField = z
    .array(subjectSlug)
    .min(SUBJECT_SELECTION.min, "Elige al menos una materia")
    .max(SUBJECT_SELECTION.max, `Como maximo ${SUBJECT_SELECTION.max} materias`);

export const setSubjectsSchema = z.object({ subjects: subjectsField });

export const completeOnboardingSchema = z.object({
    name: nameField,
    subjects: subjectsField,
});

export const userIdParamSchema = z.object({
    userId: z.string().uuid("Identificador invalido"),
});


export const setVerifiedSchema = z.object({
    verified: z.boolean({ message: "Indica si el usuario queda verificado o no" }),
});

export const listQuerySchema = z.object({
    skip: z.coerce.number().int().min(0).default(0),
    take: z.coerce.number().int().min(1).max(50).default(20),
});
