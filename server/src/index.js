"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
var express_1 = require("express");
var pg_1 = require("pg");
var prisma_js_1 = require("./lib/prisma.js");
var session_js_1 = require("./lib/session.js");
var app = (0, express_1.default)();
var PORT = Number((_a = process.env.PORT) !== null && _a !== void 0 ? _a : 3000);
app.use(express_1.default.json());
app.use(session_js_1.sessionMiddleware);
function requiredEnv(name) {
    var value = process.env[name];
    if (!value) {
        throw new Error("Missing required environment variable: ".concat(name));
    }
    return value;
}
var pool = new pg_1.Pool({
    host: requiredEnv('PGHOST'),
    port: Number((_b = process.env.PGPORT) !== null && _b !== void 0 ? _b : 5432),
    database: requiredEnv('PGDATABASE'),
    user: requiredEnv('PGUSER'),
    password: requiredEnv('PGPASSWORD'),
});
// Basic API health check
app.get('/api/health', function (_req, res) {
    res.status(200).json({
        status: 'ok',
        message: 'FormPilot API is running',
    });
});
// PostgreSQL connection health check
app.get('/api/health/db', function (_req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var result, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                return [4 /*yield*/, pool.query("\n      SELECT\n        current_database() AS database,\n        current_user AS user\n    ")];
            case 1:
                result = _a.sent();
                res.status(200).json({
                    status: 'ok',
                    message: 'Database connection successful',
                    database: result.rows[0].database,
                    user: result.rows[0].user,
                });
                return [3 /*break*/, 3];
            case 2:
                error_1 = _a.sent();
                console.error('Database health check failed:', error_1);
                res.status(503).json({
                    status: 'error',
                    message: 'Database unavailable',
                });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
app.get('/api/health/db-query', function (_req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, userCount, formCount, error_2;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                return [4 /*yield*/, Promise.all([
                        prisma_js_1.prisma.user.count(),
                        prisma_js_1.prisma.form.count(),
                    ])];
            case 1:
                _a = _b.sent(), userCount = _a[0], formCount = _a[1];
                res.status(200).json({
                    status: 'ok',
                    message: 'Prisma database queries successful',
                    tables: {
                        users: userCount,
                        forms: formCount,
                    },
                });
                return [3 /*break*/, 3];
            case 2:
                error_2 = _b.sent();
                console.error('Prisma query failed:', error_2);
                res.status(503).json({
                    status: 'error',
                    message: 'Database query failed',
                });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
app.get('/api/health/session', function (req, res) {
    req.session.sessionCheck = true;
    res.status(200).json({
        status: 'ok',
        message: 'Session middleware is working',
        sessionActive: req.session.sessionCheck,
    });
});
app.listen(PORT, function () {
    console.log("FormPilot API running at http://localhost:".concat(PORT));
});
