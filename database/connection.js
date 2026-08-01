import 'dotenv/config';
import { Pool } from "pg";

export const dbConnection = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});


//CONNECT A DATABASE FOR TRANSACTION
export async function withTransaction(fn) {
    const client = await dbConnection.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } 
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } 
    finally {
        client.release();
    }
}
