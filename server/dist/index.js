import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';
import { prisma } from './lib/prisma.js';
import { sessionMiddleware } from './lib/session.js';
const app = express();
const PORT = Number(process.env.PORT ?? 3000);
app.use(express.json());
app.use(sessionMiddleware);
function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
const pool = new Pool({
    host: requiredEnv('PGHOST'),
    port: Number(process.env.PGPORT ?? 5432),
    database: requiredEnv('PGDATABASE'),
    user: requiredEnv('PGUSER'),
    password: requiredEnv('PGPASSWORD'),
});
// Basic API health check
app.get('/api/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        message: 'FormPilot API is running',
    });
});
// PostgreSQL connection health check
app.get('/api/health/db', async (_req, res) => {
    try {
        const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS user
    `);
        res.status(200).json({
            status: 'ok',
            message: 'Database connection successful',
            database: result.rows[0].database,
            user: result.rows[0].user,
        });
    }
    catch (error) {
        console.error('Database health check failed:', error);
        res.status(503).json({
            status: 'error',
            message: 'Database unavailable',
        });
    }
});
app.get('/api/health/db-query', async (_req, res) => {
    try {
        const [userCount, formCount] = await Promise.all([
            prisma.user.count(),
            prisma.form.count(),
        ]);
        res.status(200).json({
            status: 'ok',
            message: 'Prisma database queries successful',
            tables: {
                users: userCount,
                forms: formCount,
            },
        });
    }
    catch (error) {
        console.error('Prisma query failed:', error);
        res.status(503).json({
            status: 'error',
            message: 'Database query failed',
        });
    }
});
app.get('/api/health/session', (req, res) => {
    req.session.sessionCheck = true;
    res.status(200).json({
        status: 'ok',
        message: 'Session middleware is working',
        sessionActive: req.session.sessionCheck,
    });
});
app.listen(PORT, () => {
    console.log(`FormPilot API running at http://localhost:${PORT}`);
});
