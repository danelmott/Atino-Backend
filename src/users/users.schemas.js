import z from 'zod';

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
