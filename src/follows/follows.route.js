import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { userIdParamSchema, listQuerySchema } from './follows.schemas.js';
import { follow, unfollow, state, followers, following } from './follows.controllers.js';

/**
 * Declara rutas completas y se monta en la raiz, como gamification: cuelga de /users pero no
 * pertenece a usersRouter, que va del perfil propio.
 *
 * No choca con usersRouter, que solo declara el literal /me y /me/*, ni con gamification
 * (/users/:userId/stats y /activity), porque el ultimo segmento es distinto.
 */
export const followsRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
followsRouter.use(requireAuth);

followsRouter.post('/users/:userId/follow', validate(userIdParamSchema, 'params'), asyncHandler(follow));
followsRouter.delete('/users/:userId/follow', validate(userIdParamSchema, 'params'), asyncHandler(unfollow));
followsRouter.get('/users/:userId/follow', validate(userIdParamSchema, 'params'), asyncHandler(state));

followsRouter.get(
    '/users/:userId/followers',
    validate(userIdParamSchema, 'params'),
    validate(listQuerySchema, 'query'),
    asyncHandler(followers)
);

followsRouter.get(
    '/users/:userId/following',
    validate(userIdParamSchema, 'params'),
    validate(listQuerySchema, 'query'),
    asyncHandler(following)
);
