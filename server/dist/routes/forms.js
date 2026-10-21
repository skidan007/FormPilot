import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
const formsRouter = Router();
// Validate form IDs before sending them to Prisma.
function getFormId(id) {
    if (typeof id !== 'string') {
        return null;
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(id) ? id : null;
}
// Validation schemas.
const createFormSchema = z.object({
    title: z.string().trim().min(1).max(150),
    description: z.string().trim().max(2000).optional(),
});
const updateFormSchema = z.object({
    title: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(2000).optional(),
}).refine((data) => data.title !== undefined || data.description !== undefined, { message: 'Provide a title or description to update' });
// POST /api/forms — create a form.
formsRouter.post('/', requireAuth, async (req, res) => {
    const validation = createFormSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid form details',
            errors: validation.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }
    const ownerId = req.session.userId;
    if (!ownerId) {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication required',
        });
    }
    try {
        const form = await prisma.form.create({
            data: {
                ownerId,
                title: validation.data.title,
                description: validation.data.description,
            },
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return res.status(201).json({
            status: 'ok',
            message: 'Form created successfully',
            form,
        });
    }
    catch (error) {
        console.error('Form creation failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to create form',
        });
    }
});
// GET /api/forms — list only the signed-in user's forms.
formsRouter.get('/', requireAuth, async (req, res) => {
    const ownerId = req.session.userId;
    if (!ownerId) {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication required',
        });
    }
    try {
        const forms = await prisma.form.findMany({
            where: { ownerId },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: { submissions: true },
                },
            },
        });
        return res.status(200).json({
            status: 'ok',
            count: forms.length,
            forms,
        });
    }
    catch (error) {
        console.error('Form listing failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to retrieve forms',
        });
    }
});
// GET /api/forms/:id — retrieve one owned form and its fields.
formsRouter.get('/:id', requireAuth, async (req, res) => {
    const ownerId = req.session.userId;
    if (!ownerId) {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication required',
        });
    }
    const formId = getFormId(req.params.id);
    if (!formId) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid form ID',
        });
    }
    try {
        const form = await prisma.form.findFirst({
            where: { id: formId, ownerId },
            include: {
                fields: { orderBy: { position: 'asc' } },
                _count: {
                    select: { submissions: true },
                },
            },
        });
        if (!form) {
            return res.status(404).json({
                status: 'error',
                message: 'Form not found',
            });
        }
        return res.status(200).json({
            status: 'ok',
            form,
        });
    }
    catch (error) {
        console.error('Form retrieval failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to retrieve form',
        });
    }
});
// PATCH /api/forms/:id — update an owned form's title/description.
formsRouter.patch('/:id', requireAuth, async (req, res) => {
    const ownerId = req.session.userId;
    if (!ownerId) {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication required',
        });
    }
    const formId = getFormId(req.params.id);
    if (!formId) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid form ID',
        });
    }
    const validation = updateFormSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid form update',
            errors: validation.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }
    try {
        const result = await prisma.form.updateMany({
            where: {
                id: formId,
                ownerId,
                status: 'DRAFT',
            },
            data: validation.data,
        });
        if (result.count === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Draft form not found',
            });
        }
        const form = await prisma.form.findFirst({
            where: { id: formId, ownerId },
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                updatedAt: true,
            },
        });
        return res.status(200).json({
            status: 'ok',
            message: 'Form updated successfully',
            form,
        });
    }
    catch (error) {
        console.error('Form update failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to update form',
        });
    }
});
// DELETE /api/forms/:id — delete only an owned draft with no submissions.
formsRouter.delete('/:id', requireAuth, async (req, res) => {
    const ownerId = req.session.userId;
    if (!ownerId) {
        return res.status(401).json({
            status: 'error',
            message: 'Authentication required',
        });
    }
    const formId = getFormId(req.params.id);
    if (!formId) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid form ID',
        });
    }
    try {
        const form = await prisma.form.findFirst({
            where: { id: formId, ownerId },
            select: {
                id: true,
                status: true,
                _count: {
                    select: { submissions: true },
                },
            },
        });
        if (!form) {
            return res.status(404).json({
                status: 'error',
                message: 'Form not found',
            });
        }
        if (form.status !== 'DRAFT' || form._count.submissions > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'Only draft forms without submissions can be deleted',
            });
        }
        const deleted = await prisma.form.deleteMany({
            where: {
                id: formId,
                ownerId,
                status: 'DRAFT',
            },
        });
        if (deleted.count === 0) {
            return res.status(409).json({
                status: 'error',
                message: 'Form could not be deleted; refresh and try again',
            });
        }
        return res.status(200).json({
            status: 'ok',
            message: 'Form deleted successfully',
        });
    }
    catch (error) {
        console.error('Form deletion failed:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to delete form',
        });
    }
});
export default formsRouter;
