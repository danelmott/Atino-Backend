import { Router } from 'express';
import passport from 'passport';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { authSchema, loginSchema, validationAccountSchema, resendSchema } from './auth.schemas.js';
import { register, login, verify, resend, refresh, logout, googleCallback } from './auth.controllers.js';

export const authRouter = Router();

authRouter.post('/register', validate(authSchema), asyncHandler(register));
authRouter.post('/login', validate(loginSchema), asyncHandler(login));
authRouter.post('/verify', validate(validationAccountSchema), asyncHandler(verify));
authRouter.post('/resend', validate(resendSchema), asyncHandler(resend));

authRouter.post('/refresh', passport.authenticate('jwt-refresh', { session: false, failWithError: true }), asyncHandler(refresh));
authRouter.post('/logout', passport.authenticate('jwt-refresh', { session: false, failWithError: true }), asyncHandler(logout));

authRouter.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
authRouter.get(
    '/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: `${process.env.CLIENT_URL}/login?error=google` }),
    asyncHandler(googleCallback)
);
