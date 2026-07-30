import 'dotenv/config';
import { app } from "./app.js";
import { logger } from "./lib/logger.js";

app.listen(process.env.PORT, () => {
    logger.info(`server run on port ${process.env.PORT}`);
});