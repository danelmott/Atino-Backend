import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { passportInit } from './auth/auth.strategys.js'
import { authRouter } from './auth/auth.route.js'
import { feedbackRouter } from './feedback/feedback.route.js'
import { uploadsRouter } from './uploads/uploads.route.js'
import { routesRouter } from './routes/routes.route.js'
import { lessonsRouter } from './lessons/lessons.route.js'
import { quizzesRouter } from './quizzes/quizzes.route.js'
import { errorHandler } from './lib/errorHandler.js'
import { logger } from './lib/logger.js'


export const app = express();

app.use(pinoHttp({ logger }));

// credentials: true es obligatorio para que el navegador mande las cookies de sesion a
// otro origen. Con eso el origen tiene que ser explicito: el comodin '*' deja de valer.
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));

// Detras del reverse proxy, para que req.ip sea la del cliente y no la del proxy.
app.set('trust proxy', 1);

app.use(cookieParser());
app.use(express.json({limit: '1mb'}))
passportInit();

app.use('/auth', authRouter);
app.use('/feedback', feedbackRouter);
app.use('/uploads', uploadsRouter);
app.use('/routes', routesRouter);

// lessons y quizzes declaran rutas completas (/routes/:routeId/... y /lessons/:id),
// asi que van montados en la raiz y despues de routesRouter.
app.use(lessonsRouter);
app.use(quizzesRouter);

app.use(errorHandler);