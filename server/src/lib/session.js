"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionMiddleware = void 0;
require("dotenv/config");
var express_session_1 = require("express-session");
var connect_pg_simple_1 = require("connect-pg-simple");
var pg_1 = require("pg");
function requiredEnv(name) {
    var value = process.env[name];
    if (!value) {
        throw new Error("Missing required environment variable: ".concat(name));
    }
    return value;
}
var sessionPool = new pg_1.Pool({
    host: requiredEnv('PGHOST'),
    port: Number((_a = process.env.PGPORT) !== null && _a !== void 0 ? _a : 5432),
    database: requiredEnv('PGDATABASE'),
    user: requiredEnv('PGUSER'),
    password: requiredEnv('PGPASSWORD'),
});
var PostgreSqlStore = (0, connect_pg_simple_1.default)(express_session_1.default);
exports.sessionMiddleware = (0, express_session_1.default)({
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
