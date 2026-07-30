export function requireRole(...roles) {
    return (req, res, next) => {
        const rawRoles = req.user?.roles ?? req.user?.role ?? [];
        const userRoles = Array.isArray(rawRoles) ? rawRoles : [rawRoles];
        const hasRole = roles.some((role) => userRoles.includes(role));

        if (!hasRole) {
            return next({ code: 'ACCESS_DENIED', message: 'Acceso denegado' });
        }
        next();
    };
}
