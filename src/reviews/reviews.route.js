import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { rateRouteSchema, routeIdParamSchema } from './reviews.schemas.js';
import { rate, remove, detail } from './reviews.controllers.js';

// Se monta en la raiz con la ruta completa, como lessons y quizzes: cuelga de /routes pero
// vive fuera de routesRouter, que solo implementa la autoria.
export const reviewsRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
reviewsRouter.use(requireAuth);

reviewsRouter.get('/routes/:routeId/rating', validate(routeIdParamSchema, 'params'), asyncHandler(detail));
reviewsRouter.put('/routes/:routeId/rating', validate(routeIdParamSchema, 'params'), validate(rateRouteSchema), asyncHandler(rate));
reviewsRouter.delete('/routes/:routeId/rating', validate(routeIdParamSchema, 'params'), asyncHandler(remove));
