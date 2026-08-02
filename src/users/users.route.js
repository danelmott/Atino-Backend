import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { updateTimezoneSchema } from './users.schemas.js';
import { me, timezone } from './users.controllers.js';

export const usersRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
usersRouter.use(requireAuth);

usersRouter.get('/me', asyncHandler(me));
usersRouter.patch('/me/timezone', validate(updateTimezoneSchema), asyncHandler(timezone));
