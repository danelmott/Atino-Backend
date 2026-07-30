import passport from 'passport';
import {
    registerUser,
    verifyRegisterCode,
    resendVerifyCode,
    rotateRefreshToken,
    logout as logoutUser,
    generateAccessToken,
    generateRefreshToken,
    saveRefreshToken,
    setTokenCookies,
    clearTokenCookies,
    buildPayload,
} from './auth.services.js';

export const register = async (req, res) => {
    const { email, password } = req.body;
    const result = await registerUser(email, password);

    if (result.requiresVerification) {
        return res.status(201).json({ requiresVerification: true });
    }

    setTokenCookies(res, result.accessToken, result.refreshToken);
    return res.status(200).json({ user: result.user });
}

const authenticateLocal = (req, res) => new Promise((resolve, reject) => {
    passport.authenticate('local', { session: false }, (error, user, info) => {
        if (error) return reject(error);
        resolve({ user, info });
    })(req, res, reject);
});

export const login = async (req, res) => {
    const { user, info } = await authenticateLocal(req, res);

    if (!user) throw { code: 'INVALID_CREDENTIALS', message: info?.message ?? 'Credenciales invalidas' };

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    await saveRefreshToken(user.id, refreshToken);

    setTokenCookies(res, accessToken, refreshToken);
    return res.status(200).json({ user: buildPayload(user) });
}

export const verify = async (req, res) => {
    const { email, code } = req.body;
    const { accessToken, refreshToken } = await verifyRegisterCode(email, code);

    setTokenCookies(res, accessToken, refreshToken);
    return res.status(200).json({ success: true });
}

export const resend = async (req, res) => {
    const { email } = req.body;
    await resendVerifyCode(email);
    return res.status(200).json({ success: true });
}

export const refresh = async (req, res) => {
    const oldToken = req.cookies['refresh-token'];
    const { accessToken, refreshToken } = await rotateRefreshToken(req.user.userId, oldToken);

    setTokenCookies(res, accessToken, refreshToken);
    return res.status(200).json({ success: true });
}

export const logout = async (req, res) => {
    const token = req.cookies['refresh-token'];
    await logoutUser(req.user.userId, token);

    clearTokenCookies(res);
    return res.status(204).send();
}

export const googleCallback = async (req, res) => {
    const user = req.user;

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    await saveRefreshToken(user.id, refreshToken);

    setTokenCookies(res, accessToken, refreshToken);
    return res.redirect(process.env.CLIENT_URL);
}
