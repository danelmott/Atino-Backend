import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { submitAttemptSchema, idParamSchema, listQuerySchema } from './progress.schemas.js';
import { complete, uncomplete, submit, attempts, progress, myProgress } from './progress.controllers.js';

// Igual que lessons y quizzes: se monta en la raiz porque cuelga de tres recursos distintos
// (/lessons, /quizzes y /routes) en vez de tener un prefijo propio.
export const progressRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
progressRouter.use(requireAuth);

progressRouter.post('/lessons/:id/complete', validate(idParamSchema, 'params'), asyncHandler(complete));
progressRouter.delete('/lessons/:id/complete', validate(idParamSchema, 'params'), asyncHandler(uncomplete));

progressRouter.post('/quizzes/:id/attempts', validate(idParamSchema, 'params'), validate(submitAttemptSchema), asyncHandler(submit));
progressRouter.get('/quizzes/:id/attempts', validate(idParamSchema, 'params'), asyncHandler(attempts));

progressRouter.get('/routes/:id/progress', validate(idParamSchema, 'params'), asyncHandler(progress));

// El progreso de todas mis rutas de una vez. Cuelga de /users pero vive aqui, no en
// usersRouter, porque el dato y el SQL son de este modulo. No choca con usersRouter, que solo
// declara /me, /me/* y /:userId: ninguno casa con /me/progress.
progressRouter.get('/users/me/progress', validate(listQuerySchema, 'query'), asyncHandler(myProgress));
