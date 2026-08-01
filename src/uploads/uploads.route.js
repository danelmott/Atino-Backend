import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import { createUploadUrlSchema } from './uploads.schemas.js';
import { signUpload } from './uploads.controllers.js';

export const uploadsRouter = Router();

//RUTAS PROTEGIDAS POR LA AUTENTICACION
uploadsRouter.use(requireAuth);

uploadsRouter.post('/sign', validate(createUploadUrlSchema), asyncHandler(signUpload));
