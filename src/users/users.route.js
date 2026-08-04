import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { requireRole } from '../lib/middlewares/roles.js';
import {
    updateTimezoneSchema,
    updateProfileSchema,
    setTopicsSchema,
    completeOnboardingSchema,
    setVerifiedSchema,
    userIdParamSchema,
    listQuerySchema,
} from './users.schemas.js';
import {
    me,
    updateMe,
    timezone,
    topics,
    onboarding,
    profile,
    userRoutes,
    verified,
} from './users.controllers.js';

export const usersRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
usersRouter.use(requireAuth);

usersRouter.get('/me', asyncHandler(me));
usersRouter.patch('/me', validate(updateProfileSchema), asyncHandler(updateMe));
usersRouter.patch('/me/timezone', validate(updateTimezoneSchema), asyncHandler(timezone));

// El alta: nombre e intereses juntos, y el unico que marca el onboarding como completado.
usersRouter.put('/me/onboarding', validate(completeOnboardingSchema), asyncHandler(onboarding));

// PUT y no POST: es un reemplazo completo e idempotente. Este es el de editar los intereses
// despues desde ajustes, y a proposito NO marca el onboarding.
usersRouter.put('/me/topics', validate(setTopicsSchema), asyncHandler(topics));

// Debajo de todo lo de /me, igual que routesRouter declara /topics encima de /:id: si fuera
// al reves, /users/me entraria por aqui, fallaria la validacion de uuid y responderia un 400
// en vez del perfil propio.
// Sin validate() a proposito: la forma del id la comprueba getPublicProfile, que responde 404
// y no el 400 de zod, porque es la pantalla que hace notFound() en el cliente. Los sub-recursos
// de abajo si validan: a ellos solo se llega con un id que el perfil ya resolvio.
usersRouter.get('/:userId', asyncHandler(profile));
usersRouter.get(
    '/:userId/routes',
    validate(userIdParamSchema, 'params'),
    validate(listQuerySchema, 'query'),
    asyncHandler(userRoutes)
);

// La insignia de verificado es editorial: solo un ADMIN la pone y la quita. Primer uso real
// de requireRole, que hasta ahora estaba escrito y sin cablear en ningun router.
usersRouter.patch(
    '/:userId/verified',
    requireRole('ADMIN'),
    validate(userIdParamSchema, 'params'),
    validate(setVerifiedSchema),
    asyncHandler(verified)
);
