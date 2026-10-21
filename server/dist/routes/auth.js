import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
const authRouter = Router();
// Limit repeated authentication attempts.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        status: 'error',
        message: 'Too many login attempts. Please try again in 15 minutes.',
    },
});
const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        status: 'error',
        message: 'Too many registration attempts. Please try again later.',
    },
});
// Registration validation.
const registerSchema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(254)
        .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(72),
});
// POST /api/auth/register
authRouter.post('/register', registerLimiter, async (req, res) => {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid registration details',
            errors: validation.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }
    const { name, email, password } = validation.data;
    try {
        const existingUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true },
        });
        if (existingUser) {
            return res.status(409).json({
                status: 'error',
                message: 'An account with this email already exists',
            });
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const user = await prisma.user.create({
            data: { name, email, passwordHash },
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
            },
        });
        req.session.regenerate((sessionError) => {
            if (sessionError) {
                console.error('Session regeneration failed:', sessionError);
                return res.status(500).json({
                    status: 'error',
                    message: 'Account created, but sign-in could not be completed. Please log in.',
                });
            }
            req.session.userId = user.id;
            req.session.save((saveError) => {
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
                    user,
                });
            });
        });
    }
    catch (error) {
        console.error('Registration failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to create account',
        });
    }
});
// Login validation.
const loginSchema = z.object({
    email: z.string().trim().email().max(254)
        .transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(72),
});
// POST /api/auth/login
authRouter.post('/login', loginLimiter, async (req, res) => {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            status: 'error',
            message: 'Please provide a valid email and password',
        });
    }
    const { email, password } = validation.data;
    try {
        const user = await prisma.user.findUnique({
            where: { email },
        });
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid email or password',
            });
        }
        req.session.regenerate((sessionError) => {
            if (sessionError) {
                console.error('Session regeneration failed:', sessionError);
                return res.status(500).json({
                    status: 'error',
                    message: 'Unable to start your session',
                });
            }
            req.session.userId = user.id;
            req.session.save((saveError) => {
                if (saveError) {
                    console.error('Session save failed:', saveError);
                    return res.status(500).json({
                        status: 'error',
                        message: 'Unable to save your session',
                    });
                }
                return res.status(200).json({
                    status: 'ok',
                    message: 'Login successful',
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                    },
                });
            });
        });
    }
    catch (error) {
        console.error('Login failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to log in',
        });
    }
});
// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({
            status: 'error',
            message: 'Not authenticated',
        });
    }
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.session.userId },
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
            },
        });
        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Not authenticated',
            });
        }
        return res.status(200).json({
            status: 'ok',
            user,
        });
    }
    catch (error) {
        console.error('Current-user lookup failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to retrieve account',
        });
    }
});
// POST /api/auth/logout
authRouter.post('/logout', (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error('Logout failed:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Unable to log out',
            });
        }
        res.clearCookie('formpilot.sid', {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        });
        return res.status(200).json({
            status: 'ok',
            message: 'Logout successful',
        });
    });
});
export default authRouter;
