"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
require("dotenv/config");
var pg_1 = require("pg");
var adapter_pg_1 = require("@prisma/adapter-pg");
var client_1 = require("../generated/prisma/client");
function requiredEnv(name) {
    var value = process.env[name];
    if (!value) {
        throw new Error("Missing required environment variable: ".concat(name));
    }
    return value;
}
var pool = new pg_1.Pool({
    host: requiredEnv('PGHOST'),
    port: Number((_a = process.env.PGPORT) !== null && _a !== void 0 ? _a : 5432),
    database: requiredEnv('PGDATABASE'),
    user: requiredEnv('PGUSER'),
    password: requiredEnv('PGPASSWORD'),
});
var adapter = new adapter_pg_1.PrismaPg(pool);
exports.prisma = new client_1.PrismaClient({ adapter: adapter });
