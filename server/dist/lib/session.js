import 'dotenv/config';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import { Pool } from 'pg';
function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
const sessionPool = new Pool({
    host: requiredEnv('PGHOST'),
    port: Number(process.env.PGPORT ?? 5432),
    database: requiredEnv('PGDATABASE'),
    user: requiredEnv('PGUSER'),
    password: requiredEnv('PGPASSWORD'),
});
const PostgreSqlStore = pgSession(session);
export const sessionMiddleware = session({
    store: new PostgreSqlStore({
        pool: sessionPool,
        tableName: 'user_sessions',
        createTableIfMissing: true,
    }),
    name: 'formpilot.sid',
    secret: requiredEnv('SESSION_SECRET'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7,
    },
});
