import 'dotenv/config';
import passport from "passport";
import { Strategy as jwtStrategy, ExtractJwt } from "passport-jwt";
import { Strategy as localStrategy } from "passport-local";
import { Strategy as googleStrategy } from "passport-google-oauth20";
import bcrypt from 'bcrypt';
import { findUserById, findUserByEmail, updateUserImage } from '../users/users.queries.js';
import { findAccountsByUserId, linkGoogleAccountToUser, createUserWithGoogleAccount } from './auth.queries.js';


/*FUNCTION FOR JWT STRATEGY*/
const jwtStrategyFunction = () => {
    passport.use (
        'jwt',
        new jwtStrategy(
            {
                jwtFromRequest: ExtractJwt.fromExtractors([
                    (req) => req?.cookies?.['access-token'] ?? null,
                ]),
                secretOrKey: process.env.JWT_ACCESS_SIGNATURE
            },
            (payload, done) => done(null, payload)
        )
    )
}


const jwtStrategyRefresh = () => {
    passport.use(
        "jwt-refresh",
        new jwtStrategy(
            {
                jwtFromRequest: ExtractJwt.fromExtractors([
                    (req) => req?.cookies?.['refresh-token'] ?? null
                ]),
                secretOrKey: process.env.JWT_REFRESH_SIGNATURE
            },
            async (payload, done) => {
                try {
                    const user = await findUserById(payload.userId)

                    if(!user) return done(null, false);
                    return done(null, payload);

                }
                catch (error) {
                    return done(error, false)
                }
            }
        )
    )
}

const localStrategyFunction = () => {
    passport.use(
        new localStrategy(
            {
                usernameField: 'email',
                passwordField: 'password'
            },
            async (email, password, done) => {
                try {
                    const user = await findUserByEmail(email)

                    if(!user || !user.password) {
                        return done(null, false, {message: 'credenciales invalidas'})
                    }

                    const valid = await bcrypt.compare(password, user.password);

                    if(!valid) return done(null, false, {message: 'Credenciales invalidas'});

                    // Con `info` propio: sin el, el controlador cae en su `??` y esto sale como
                    // INVALID_CREDENTIALS, indistinguible de una contraseña mala.
                    if (!user.email_verified) {
                        return done(null, false, {
                            code: 'EMAIL_NOT_VERIFIED',
                            message: 'Verifica tu correo para poder entrar',
                        });
                    }

                    return done(null, user);
                }
                catch (error) {
                    return done(error);
                }
            }
        )
    )
}


const googleStrategyFunction = () => {
    passport.use(
        new googleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: process.env.GOOGLE_CALLBACK_URL,
            },
            async (accessToken, refreshToken, profile, done) => {
                try {
                    const email = profile.emails?.[0]?.value;
                    const googleImage = profile.photos?.[0]?.value ?? null;

                    // Caso 1: ¿Existe un usuario con ese email?
                    const existingUser = await findUserByEmail(email)

                    if (existingUser) {
                        existingUser.accounts = await findAccountsByUserId(existingUser.id)

                        const alreadyLinked = existingUser.accounts.some(
                            (a) => a.provider === 'GOOGLE'
                        );

                        if (alreadyLinked) {
                            if (googleImage && existingUser.image !== googleImage) {
                                const updatedUser = await updateUserImage(existingUser.id, googleImage)
                                return done(null, updatedUser);
                            }
                            return done(null, existingUser);
                        }

                        const user = await linkGoogleAccountToUser({
                            userId: existingUser.id,
                            image: googleImage,
                        })
                        return done(null, user);
                    }

                    // Caso 2: Usuario nuevo → crear usuario + cuenta Google juntos
                    const user = await createUserWithGoogleAccount({
                        email,
                        name: profile.displayName,
                        image: googleImage,
                    })
                    return done(null, user);
                }
                catch (error) {
                    return done(error, false);
                }
            }
        )
    )
}

export const passportInit = () => {
    googleStrategyFunction();
    jwtStrategyFunction();
    jwtStrategyRefresh();
    localStrategyFunction();
}
