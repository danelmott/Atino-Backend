import passport from 'passport';

export function requireAuth(req, res, next) {
    passport.authenticate('jwt', { session: false }, (err, payload) => {
        if (err) return next(err);
        if (!payload) return next({ code: 'UNAUTHORIZED', message: 'No autorizado' });

        req.user = payload;
        next();
    })(req, res, next);
}

export function requireRefresh(req, res, next) {
    passport.authenticate('jwt-refresh', { session: false }, (err, payload) => {
        if (err) return next(err);
        if (!payload) return next({ code: 'INVALID_REFRESH_TOKEN', message: 'Sesion Invalida o expirada' });

        req.user = payload;
        next();
    })(req, res, next);
}
