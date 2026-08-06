import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { searchQuerySchema } from './search.schemas.js';
import { search } from './search.controllers.js';

export const searchRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
searchRouter.use(requireAuth);

// Sin trampa de orden: /search no solapa con ningun literal de otro router, a diferencia de
// /routes/feed, que obliga a montar feedRouter antes que routesRouter.
searchRouter.get('/', validate(searchQuerySchema, 'query'), asyncHandler(search));
