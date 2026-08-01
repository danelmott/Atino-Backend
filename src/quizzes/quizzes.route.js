import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import {
    createQuizSchema,
    updateQuizSchema,
    idParamSchema,
    routeIdParamSchema,
} from './quizzes.schema.js';
import { create, detail, update, remove } from './quizzes.controllers.js';

// Igual que lessons: se monta en la raiz con las rutas completas.
export const quizzesRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
quizzesRouter.use(requireAuth);

quizzesRouter.post('/routes/:routeId/quizzes', validate(routeIdParamSchema, 'params'), validate(createQuizSchema), asyncHandler(create));

quizzesRouter.get('/quizzes/:id', validate(idParamSchema, 'params'), asyncHandler(detail));
quizzesRouter.put('/quizzes/:id', validate(idParamSchema, 'params'), validate(updateQuizSchema), asyncHandler(update));
quizzesRouter.delete('/quizzes/:id', validate(idParamSchema, 'params'), asyncHandler(remove));
