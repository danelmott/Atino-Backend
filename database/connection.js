import 'dotenv/config';
import { Pool } from "pg";

export const dbConnection = new Pool({connectionString: process.env.CONNECTION_STRING});
