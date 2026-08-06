import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import {
    userIdParamSchema,
    activityQuerySchema,
    seasonQuerySchema,
    rankingQuerySchema,
} from './gamification.schemas.js';
import { stats, activity, ranking, standing, globalRanking } from './gamification.controllers.js';

// Igual que lessons y quizzes: se monta en la raiz con las rutas completas, porque el
// perfil de un usuario y la tabla de ranking no cuelgan del mismo prefijo.
export const gamificationRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
gamificationRouter.use(requireAuth);

gamificationRouter.get('/users/:userId/stats', validate(userIdParamSchema, 'params'), asyncHandler(stats));
gamificationRouter.get('/users/:userId/activity', validate(userIdParamSchema, 'params'), validate(activityQuerySchema, 'query'), asyncHandler(activity));

// Los segmentos literales van antes que nada que pueda solaparse, misma razon que el
// /subjects de routesRouter.
gamificationRouter.get('/ranking/me', validate(seasonQuerySchema, 'query'), asyncHandler(standing));
gamificationRouter.get('/ranking/global', validate(rankingQuerySchema, 'query'), asyncHandler(globalRanking));
gamificationRouter.get('/ranking', validate(seasonQuerySchema, 'query'), asyncHandler(ranking));
