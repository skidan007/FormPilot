import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
const authRouter = Router();
const registerSchema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(72),
});
authRouter.post('/register', async (req, res) => {
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
            data: {
                name,
                email,
                passwordHash,
            },
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
export default authRouter;
