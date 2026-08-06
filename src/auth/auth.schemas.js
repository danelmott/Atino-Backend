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


/**
 * El login NO reutiliza authSchema.
 *
 * Validar aqui el formato de la contraseña tiene dos efectos malos: endurecer la politica deja
 * fuera a los que ya existen -- con un 400 sobre caracteres especiales en vez de un fallo de
 * autenticacion --, y le cuenta la politica a cualquiera que sondee el endpoint. Lo unico que
 * importa al entrar es que venga algo; si es la correcta lo dice bcrypt.
 */
export const loginSchema = z.object({
    email: emailField,
    password: z.string().min(1, "La contraseña es obligatoria"),
});

export const validationAccountSchema = z.object({
    email: emailField,
    code: z.string().length(6, "El código debe tener exactamente 6 caracteres")
});

export const resendSchema = z.object({
    email: emailField
});