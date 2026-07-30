import express from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { passportInit } from './auth/auth.strategys.js'
import { authRouter } from './auth/auth.route.js'
import { errorHandler } from './lib/errorHandler.js'
import { logger } from './lib/logger.js'


export const app = express();

app.use(pinoHttp({ logger }));
app.use(cookieParser());
app.use(express.json({limit: '1mb'}))
passportInit();

app.use('/auth', authRouter);

app.use(errorHandler);