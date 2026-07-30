import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { withTransaction } from '../../database/connection.js';
import { requireEnv } from '../lib/env.js';
import { withServiceError } from '../lib/withServiceError.js';
import { sendVerificationCodeEmail } from '../lib/mailer.js';
import { findUserById, findUserByEmail } from '../users/users.queries.js';
import {
    findAccountsByUserId,
    createLocalUser,
    attachLocalCredentialsToUser,
    markUserEmailVerified,
    createRefreshToken,
    findRefreshTokenByToken,
    findLatestRefreshTokenByUserId,
    deleteRefreshTokenForUser,
    deleteAllRefreshTokensForUser,
    createVerificationCode,
    findLatestUnusedVerificationCode,
    invalidateUnusedVerificationCodes,
} from './auth.queries.js';

/** Ventana tras rotación en la que un refresh concurrente (p. ej. otra pestaña) no invalida la sesión. */
const REFRESH_ROTATION_GRACE_MS = 60_000;

export const buildPayload = (user) => ({
    userId: user.id,
    email: user.email,
    role: user.role ?? 'USER',
})

const durationToMs = (value) => {
    const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)([smhd])$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

    return amount * multipliers[unit];
}

const getAccessTokenMaxAgeMs = () => durationToMs(process.env.JWT_ACCESS_EXPIRES) ?? 15 * 60 * 1000;

const getRefreshTokenMaxAgeMs = () => durationToMs(process.env.JWT_REFRESH_EXPIRES) ?? 7 * 24 * 60 * 60 * 1000;

const buildAuthCookieOptions = (maxAge) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
})

const buildAuthCookieClearOptions = () => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
})

export const generateAccessToken = (user) =>
    jwt.sign(buildPayload(user), requireEnv('JWT_ACCESS_SIGNATURE'), {
        expiresIn: process.env.JWT_ACCESS_EXPIRES ?? '15m',
    })

export const generateRefreshToken = (user) =>
    jwt.sign({ ...buildPayload(user), jti: randomUUID() }, requireEnv('JWT_REFRESH_SIGNATURE'), {
        expiresIn: process.env.JWT_REFRESH_EXPIRES ?? '7d',
    })

export const setTokenCookies = (res, accessToken, refreshToken) => {
    res.cookie('access-token', accessToken, buildAuthCookieOptions(getAccessTokenMaxAgeMs()));
    res.cookie('refresh-token', refreshToken, buildAuthCookieOptions(getRefreshTokenMaxAgeMs()));
}

export const clearTokenCookies = (res) => {
    res.clearCookie('access-token', buildAuthCookieClearOptions());
    res.clearCookie('refresh-token', buildAuthCookieClearOptions());
}

const generateCode = async () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = await bcrypt.hash(code, 12);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    return { code, hashedCode, expiresAt };
}

export const saveRefreshToken = withServiceError(async (userId, token) => {
    const expiresAt = new Date(Date.now() + getRefreshTokenMaxAgeMs());
    await createRefreshToken({ userId, token, expiresAt });
}, { code: 'ERROR_SAVING_REFRESH_TOKEN', message: 'Hubo un error al intentar guardar la sesion' });

export const rotateRefreshToken = withServiceError(async (userId, oldToken) => {
    if (!oldToken) {
        throw { code: 'INVALID_REFRESH_TOKEN', message: 'Sesion Invalida o expirada' };
    }

    const stored = await findRefreshTokenByToken(oldToken);

    if (!stored) {
        const recentToken = await findLatestRefreshTokenByUserId(userId);

        if (
            recentToken &&
            new Date(recentToken.created_at).getTime() >= Date.now() - REFRESH_ROTATION_GRACE_MS &&
            new Date(recentToken.expires_at) >= new Date()
        ) {
            const user = await findUserById(userId);
            return {
                accessToken: generateAccessToken(user),
                refreshToken: recentToken.token,
            };
        }

        throw { code: 'INVALID_REFRESH_TOKEN', message: 'Sesion Invalida o expirada' };
    }

    if (stored.user_id !== userId) {
        await deleteAllRefreshTokensForUser(userId);
        throw { code: 'INVALID_REFRESH_TOKEN', message: 'Sesion Invalida o expirada' };
    }

    if (new Date(stored.expires_at) < new Date()) {
        await deleteRefreshTokenForUser(userId, oldToken);
        throw { code: 'INVALID_REFRESH_TOKEN', message: 'Sesion Invalida o expirada' };
    }

    await deleteRefreshTokenForUser(userId, oldToken);

    const user = await findUserById(userId);
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await saveRefreshToken(userId, refreshToken);

    return { accessToken, refreshToken };
}, { code: 'ERROR_ROTATING_REFRESH_TOKEN', message: 'Hubo un error al intentar renovar la sesion' });

export const registerUser = withServiceError(async (email, password) => {
    const existing = await findUserByEmail(email);

    if (existing) {
        const accounts = await findAccountsByUserId(existing.id);
        const hasLocal = accounts.some((a) => a.provider === 'LOCAL');
        if (hasLocal) throw { code: 'USER_ALREADY_EXISTS', message: 'El usuario ya esta registrado' };

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await attachLocalCredentialsToUser({ userId: existing.id, hashedPassword });

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);
        await saveRefreshToken(user.id, refreshToken);

        return { user: buildPayload(user), accessToken, refreshToken };
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await createLocalUser({ email, hashedPassword });

    const verificationCode = await generateCode();
    await createVerificationCode({
        userId: user.id,
        hashedCode: verificationCode.hashedCode,
        expiresAt: verificationCode.expiresAt,
    });

    await sendVerificationCodeEmail(user.email, verificationCode.code);

    return { requiresVerification: true };
}, { code: 'ERROR_REGISTERING_USER', message: 'Hubo un error al intentar registrar el usuario' });

export const verifyRegisterCode = withServiceError(async (email, code) => {
    const user = await findUserByEmail(email);

    if (!user) throw { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' };

    if (user.email_verified) throw { code: 'EMAIL_ALREADY_VERIFIED', message: 'El correo ya fue verificado' };

    const verificationCode = await findLatestUnusedVerificationCode(user.id);

    if (!verificationCode) {
        throw { code: 'VERIFICATION_CODE_NOT_FOUND', message: 'No hay código de verifición pendiente' };
    }

    if (new Date() > new Date(verificationCode.expires_at)) {
        throw { code: 'VERIFICATION_EXPIRED', message: 'El codigo de verficacion expiro, porfavor reenvie otro' };
    }

    const isMatch = await bcrypt.compare(code, verificationCode.code);

    if (!isMatch) throw { code: 'INVALID_VERIFICATION_CODE', message: 'Codigo de verificacion incorrecto' };

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    const expiresAt = new Date(Date.now() + getRefreshTokenMaxAgeMs());

    await withTransaction(async (client) => {
        await markUserEmailVerified(user.id, client);
        await invalidateUnusedVerificationCodes(user.id, client);
        await createRefreshToken({ userId: user.id, token: refreshToken, expiresAt }, client);
    });

    return { accessToken, refreshToken };
}, { code: 'ERROR_VERIFICATING_EMAIL', message: 'Hubo un error al intentar verificar el email' });

export const resendVerifyCode = withServiceError(async (email) => {
    const user = await findUserByEmail(email);

    if (!user) throw { code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' };

    if (user.email_verified) throw { code: 'EMAIL_ALREADY_VERIFIED', message: 'El correo ya fue verificado' };

    await invalidateUnusedVerificationCodes(user.id);

    const code = await generateCode();
    await createVerificationCode({ userId: user.id, hashedCode: code.hashedCode, expiresAt: code.expiresAt });

    await sendVerificationCodeEmail(user.email, code.code);
}, { code: 'ERROR_RESENDING_VERIFICATION_CODE', message: 'Hubo un error al intentar reenviar el codigo de verificacion' });

export const logout = withServiceError(async (userId, refreshToken) => {
    await deleteRefreshTokenForUser(userId, refreshToken);
}, { code: 'ERROR_DELETING_REFRESH_TOKEN', message: 'Hubo un error al intentar cerrar la sesion' });
