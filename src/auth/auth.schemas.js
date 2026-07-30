import z from 'zod';

const emailField = z.string().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Debe ser un correo electrónico válido")

export const authSchema = z.object({
    email: emailField,
    password: z.string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
        .regex(/[a-zA-Z]/, "La contraseña debe contener al menos una letra")
        .regex(/[0-9]/, "La contraseña debe contener al menos un número")
        .regex(/[^a-zA-Z0-9]/, "La contraseña debe contener al menos un carácter especial")
});


export const loginSchema = authSchema;

export const validationAccountSchema = z.object({
    email: emailField,
    code: z.string().length(6, "El código debe tener exactamente 6 caracteres")
});

export const resendSchema = z.object({
    email: emailField
});