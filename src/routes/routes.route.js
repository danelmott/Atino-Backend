import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import {
    createRouteSchema,
    updateRouteSchema,
    updateCoverSchema,
    visibilitySchema,
    idParamSchema,
    listQuerySchema,
} from './routes.schemas.js';
import {
    create,
    detail,
    list,
    update,
    changeCover,
    changeVisibility,
    remove,
    topics,
} from './routes.controllers.js';

export const routesRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
routesRouter.use(requireAuth);

routesRouter.get('/topics', asyncHandler(topics));

routesRouter.post('/', validate(createRouteSchema), asyncHandler(create));
routesRouter.get('/', validate(listQuerySchema, 'query'), asyncHandler(list));

routesRouter.get('/:id', validate(idParamSchema, 'params'), asyncHandler(detail));
routesRouter.patch('/:id', validate(idParamSchema, 'params'), validate(updateRouteSchema), asyncHandler(update));
routesRouter.put('/:id/cover', validate(idParamSchema, 'params'), validate(updateCoverSchema), asyncHandler(changeCover));
routesRouter.post('/:id/visibility', validate(idParamSchema, 'params'), validate(visibilitySchema), asyncHandler(changeVisibility));
routesRouter.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(remove));
