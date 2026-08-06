import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { feedQuerySchema } from './feed.schemas.js';
import { feed } from './feed.controllers.js';

/**
 * Declara la ruta completa /routes/feed y se monta en la raiz, como lessons o progress,
 * porque routesRouter es solo autoria y esto es consumo.
 *
 * OJO: este router va montado ANTES que routesRouter en app.js, al reves que lessons y
 * quizzes. Si va despues, /routes/feed entra por routesRouter.get('/:id'), y como
 * idParamSchema exige un uuid la respuesta es un 400 "Identificador invalido" en vez de la
 * lista. Es el mismo motivo por el que /routes/subjects esta declarado encima de /:id.
 */
export const feedRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
feedRouter.use(requireAuth);

feedRouter.get('/routes/feed', validate(feedQuerySchema, 'query'), asyncHandler(feed));
