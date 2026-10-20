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
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var zod_1 = require("zod");
var bcryptjs_1 = require("bcryptjs");
var prisma_js_1 = require("../lib/prisma.js");
var authRouter = (0, express_1.Router)();
var registerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(100).optional(),
    email: zod_1.z.string().trim().email().max(254).transform(function (value) { return value.toLowerCase(); }),
    password: zod_1.z.string().min(12).max(72),
});
authRouter.post('/register', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var validation, _a, name, email, password, existingUser, passwordHash, user_1, error_1;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                validation = registerSchema.safeParse(req.body);
                if (!validation.success) {
                    return [2 /*return*/, res.status(400).json({
                            status: 'error',
                            message: 'Invalid registration details',
                            errors: validation.error.issues.map(function (issue) { return ({
                                field: issue.path.join('.'),
                                message: issue.message,
                            }); }),
                        })];
                }
                _a = validation.data, name = _a.name, email = _a.email, password = _a.password;
                _b.label = 1;
            case 1:
                _b.trys.push([1, 5, , 6]);
                return [4 /*yield*/, prisma_js_1.prisma.user.findUnique({
                        where: { email: email },
                        select: { id: true },
                    })];
            case 2:
                existingUser = _b.sent();
                if (existingUser) {
                    return [2 /*return*/, res.status(409).json({
                            status: 'error',
                            message: 'An account with this email already exists',
                        })];
                }
                return [4 /*yield*/, bcryptjs_1.default.hash(password, 12)];
            case 3:
                passwordHash = _b.sent();
                return [4 /*yield*/, prisma_js_1.prisma.user.create({
                        data: {
                            name: name,
                            email: email,
                            passwordHash: passwordHash,
                        },
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            createdAt: true,
                        },
                    })];
            case 4:
                user_1 = _b.sent();
                req.session.regenerate(function (sessionError) {
                    if (sessionError) {
                        console.error('Session regeneration failed:', sessionError);
                        return res.status(500).json({
                            status: 'error',
                            message: 'Account created, but sign-in could not be completed. Please log in.',
                        });
                    }
                    req.session.userId = user_1.id;
                    req.session.save(function (saveError) {
                        if (saveError) {
                            console.error('Session save failed:', saveError);
                            return res.status(500).json({
                                status: 'error',
                                message: 'Account created, but sign-in could not be completed. Please log in.',
                            });
                        }
                        return res.status(201).json({
                            status: 'ok',
                            message: 'Account created successfully',
                            user: user_1,
                        });
                    });
                });
                return [3 /*break*/, 6];
            case 5:
                error_1 = _b.sent();
                console.error('Registration failed:', error_1);
                return [2 /*return*/, res.status(500).json({
                        status: 'error',
                        message: 'Unable to create account',
                    })];
            case 6: return [2 /*return*/];
        }
    });
}); });
exports.default = authRouter;
