import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import {
    createLessonsSchema,
    updateLessonSchema,
    reorderSchema,
    idParamSchema,
    routeIdParamSchema,
} from './lessons.schemas.js';
import { create, detail, update, remove, reorder } from './lessons.controllers.js';

// Se monta en la raiz y declara las rutas completas: las de creacion cuelgan de una ruta
// concreta y las de edicion van por id de leccion.
export const lessonsRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
lessonsRouter.use(requireAuth);

lessonsRouter.post('/routes/:routeId/lessons', validate(routeIdParamSchema, 'params'), validate(createLessonsSchema), asyncHandler(create));
lessonsRouter.put('/routes/:routeId/lessons/order', validate(routeIdParamSchema, 'params'), validate(reorderSchema), asyncHandler(reorder));

lessonsRouter.get('/lessons/:id', validate(idParamSchema, 'params'), asyncHandler(detail));
lessonsRouter.put('/lessons/:id', validate(idParamSchema, 'params'), validate(updateLessonSchema), asyncHandler(update));
lessonsRouter.delete('/lessons/:id', validate(idParamSchema, 'params'), asyncHandler(remove));
