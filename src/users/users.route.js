import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { requireRole } from '../lib/middlewares/roles.js';
import {
    updateTimezoneSchema,
    updateProfileSchema,
    setSubjectsSchema,
    completeOnboardingSchema,
    setVerifiedSchema,
    userIdParamSchema,
    listQuerySchema,
} from './users.schemas.js';
import {
    me,
    updateMe,
    timezone,
    subjects,
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

usersRouter.put('/me/onboarding', validate(completeOnboardingSchema), asyncHandler(onboarding));


usersRouter.put('/me/subjects', validate(setSubjectsSchema), asyncHandler(subjects));
usersRouter.get('/:userId', asyncHandler(profile));
usersRouter.get(
    '/:userId/routes',
    validate(userIdParamSchema, 'params'),
    validate(listQuerySchema, 'query'),
    asyncHandler(userRoutes)
);


usersRouter.patch(
    '/:userId/verified',
    requireRole('ADMIN'),
    validate(userIdParamSchema, 'params'),
    validate(setVerifiedSchema),
    asyncHandler(verified)
);
