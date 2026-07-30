import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { validate } from '../lib/validate.js';
import { requireAuth } from '../lib/middlewares/auth.js';
import {
    createMessageSchema,
    updateMessageSchema,
    createAnswerSchema,
    updateAnswerSchema,
    idParamSchema,
    paginationQuerySchema,
} from './feedback.schema.js';
import {
    listMessages,
    listAnswers,
    createMessage,
    updateMessage,
    deleteMessage,
    likeMessage,
    createAnswer,
    editAnswer,
    removeAnswer,
    likeAnswer,
} from './feedback.controllers.js';

export const feedbackRouter = Router();

feedbackRouter.use(requireAuth);

feedbackRouter.get('/messages', validate(paginationQuerySchema, 'query'), asyncHandler(listMessages));
feedbackRouter.post('/messages', validate(createMessageSchema), asyncHandler(createMessage));
feedbackRouter.patch('/messages/:id', validate(idParamSchema, 'params'), validate(updateMessageSchema), asyncHandler(updateMessage));
feedbackRouter.delete('/messages/:id', validate(idParamSchema, 'params'), asyncHandler(deleteMessage));
feedbackRouter.post('/messages/:id/like', validate(idParamSchema, 'params'), asyncHandler(likeMessage));

feedbackRouter.get('/messages/:id/answers', validate(idParamSchema, 'params'), asyncHandler(listAnswers));
feedbackRouter.post('/messages/:id/answers', validate(idParamSchema, 'params'), validate(createAnswerSchema), asyncHandler(createAnswer));

feedbackRouter.patch('/answers/:id', validate(idParamSchema, 'params'), validate(updateAnswerSchema), asyncHandler(editAnswer));
feedbackRouter.delete('/answers/:id', validate(idParamSchema, 'params'), asyncHandler(removeAnswer));
feedbackRouter.post('/answers/:id/like', validate(idParamSchema, 'params'), asyncHandler(likeAnswer));
