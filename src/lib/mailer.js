import nodemailer from 'nodemailer';
import { requireEnv } from './env.js';

let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;

    const port = Number(requireEnv('SMTP_PORT'));
    transporter = nodemailer.createTransport({
        host: requireEnv('SMTP_HOST'),
        port,
        secure: port === 465,
        auth: {
            user: requireEnv('SMTP_USER'),
            pass: requireEnv('SMTP_PASS'),
        },
    });
    return transporter;
}

export const sendVerificationCodeEmail = async (to, code) => {
    await getTransporter().sendMail({
        from: requireEnv('SMTP_FROM'),
        to,
        subject: 'Tu código de verificación',
        text: `Tu código de verificación es: ${code}. Vence en 15 minutos.`,
    });
}
