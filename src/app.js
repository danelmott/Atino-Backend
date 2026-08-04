import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { passportInit } from './auth/auth.strategys.js'
import { authRouter } from './auth/auth.route.js'
import { feedbackRouter } from './feedback/feedback.route.js'
import { uploadsRouter } from './uploads/uploads.route.js'
import { routesRouter } from './routes/routes.route.js'
import { feedRouter } from './feed/feed.route.js'
import { usersRouter } from './users/users.route.js'
import { lessonsRouter } from './lessons/lessons.route.js'
import { quizzesRouter } from './quizzes/quizzes.route.js'
import { progressRouter } from './progress/progress.route.js'
import { reviewsRouter } from './reviews/reviews.route.js'
import { gamificationRouter } from './gamification/gamification.route.js'
import { followsRouter } from './follows/follows.route.js'
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

// ANTES de routesRouter, al reves que el resto de routers montados en la raiz: feedRouter
// declara /routes/feed, y montado despues lo capturaria routesRouter.get('/:id'), que exige
// un uuid y responderia 400 "Identificador invalido" en lugar del feed.
app.use(feedRouter);

app.use('/routes', routesRouter);
app.use('/users', usersRouter);

// lessons y quizzes declaran rutas completas (/routes/:routeId/... y /lessons/:id),
// asi que van montados en la raiz y despues de routesRouter.
app.use(lessonsRouter);
app.use(quizzesRouter);

// Misma razon: progress cuelga de /lessons, /quizzes y /routes a la vez, y gamification
// declara /users/:userId/stats y /ranking, que no comparten prefijo.
app.use(progressRouter);
app.use(reviewsRouter);
app.use(gamificationRouter);

// follows declara /users/:userId/follow(ers|ing). Va despues de usersRouter, que solo tiene
// el literal /me y /me/*, y no pisa a gamification porque el ultimo segmento es distinto.
app.use(followsRouter);

app.use(errorHandler);