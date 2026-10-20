"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
var config_1 = require("prisma/config");
function requiredEnv(name) {
    var value = process.env[name];
    if (!value) {
        throw new Error("Missing required environment variable: ".concat(name));
    }
    return value;
}
var databaseUrl = new URL('postgresql://localhost:5432/formpilot');
databaseUrl.hostname = requiredEnv('PGHOST');
databaseUrl.port = (_a = process.env.PGPORT) !== null && _a !== void 0 ? _a : '5432';
databaseUrl.username = requiredEnv('PGUSER');
databaseUrl.password = requiredEnv('PGPASSWORD');
databaseUrl.pathname = "/".concat(requiredEnv('PGDATABASE'));
exports.default = (0, config_1.defineConfig)({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: databaseUrl.toString(),
    },
});
