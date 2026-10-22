import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { randomBytes } from 'node:crypto';
const formsRouter = Router();
/**
 * POST /api/forms/:id/publish
 * Publish an owned draft form.
 */
formsRouter.post('/:id/publish', requireAuth, async (req, res) => {
    const ownerId = req.session.userId;
    const formId = getFormId(req.params.id);
    if (!formId) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid form ID.',
        });
    }
    try {
        const form = await prisma.form.findFirst({
            where: { id: formId, ownerId },
            include: {
                fields: {
                    orderBy: { position: 'asc' },
                },
            },
        });
        if (!form) {
            return res.status(404).json({
                status: 'error',
                message: 'Form not found.',
            });
        }
        if (form.status !== 'DRAFT') {
            return res.status(409).json({
                status: 'error',
                message: 'Only draft forms can be published.',
            });
        }
        if (form.fields.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Add at least one question before publishing.',
            });
        }
        // Reuse an existing ID or generate a secure, random public ID.
        const publicId = form.publicId ?? randomBytes(16).toString('hex');
        const result = await prisma.form.updateMany({
            where: {
                id: formId,
                ownerId,
                status: 'DRAFT',
            },
            data: {
                status: 'PUBLISHED',
                publicId,
                publishedAt: new Date(),
            },
        });
        if (result.count === 0) {
            return res.status(409).json({
                status: 'error',
                message: 'The form could not be published. Please try again.',
            });
        }
        const publishedForm = await prisma.form.findFirst({
            where: { id: formId, ownerId },
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                publicId: true,
                publishedAt: true,
                updatedAt: true,
            },
        });
        return res.status(200).json({
            status: 'ok',
            message: 'Form published successfully.',
            form: publishedForm,
        });
    }
    catch (error) {
        console.error('Publish form error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to publish form.',
        });
    }
});
formsRouter.post('/:id/repair-public-id', requireAuth, async (req, res) => {
    const ownerId = req.session.userId;
    const formId = getFormId(req.params.id);
    if (!formId) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid form ID.',
        });
    }
    try {
        const form = await prisma.form.findFirst({
            where: { id: formId, ownerId },
            select: {
                id: true,
                status: true,
                publicId: true,
            },
        });
        if (!form) {
            return res.status(404).json({
                status: 'error',
                message: 'Form not found.',
            });
        }
        if (form.status !== 'PUBLISHED') {
            return res.status(409).json({
                status: 'error',
                message: 'Only published forms can be repaired.',
            });
        }
        if (form.publicId) {
            return res.json({
                status: 'ok',
                message: 'This form already has a public ID.',
                publicId: form.publicId,
            });
        }
        const publicId = randomBytes(16).toString('hex');
        await prisma.form.updateMany({
            where: {
                id: formId,
                ownerId,
                status: 'PUBLISHED',
                publicId: null,
            },
            data: { publicId },
        });
        const updatedForm = await prisma.form.findFirst({
            where: { id: formId, ownerId },
            select: { publicId: true },
        });
        if (!updatedForm?.publicId) {
            return res.status(409).json({
                status: 'error',
                message: 'Unable to assign a public ID. Please retry.',
            });
        }
        return res.json({
            status: 'ok',
            message: 'Public ID assigned successfully.',
            publicId: updatedForm.publicId,
        });
    }
    catch (error) {
        console.error('Repair public ID error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to repair public ID.',
        });
    }
});
// Validate form IDs before sending them to Prisma.
function getFormId(id) {
    if (typeof id !== 'string') {
        return null;
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(id) ? id : null;
}
formsRouter.post('/public/:publicId/submissions', async (req, res) => {
    const publicId = req.params.publicId;
    if (typeof publicId !== 'string' ||
        !/^[a-f0-9]{32}$/i.test(publicId)) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid public form link.',
        });
    }
    try {
        const form = await prisma.form.findFirst({
            where: {
                publicId,
                status: 'PUBLISHED',
            },
            include: {
                fields: {
                    orderBy: { position: 'asc' },
                },
            },
        });
        if (!form) {
            return res.status(404).json({
                status: 'error',
                message: 'Published form not found.',
            });
        }
        const answers = req.body?.answers;
        if (!answers ||
            typeof answers !== 'object' ||
            Array.isArray(answers)) {
            return res.status(400).json({
                status: 'error',
                message: 'Answers must be an object keyed by field ID.',
            });
        }
        const allowedFieldIds = new Set(form.fields.map((field) => field.id));
        // Reject answers for fields that do not belong to this form.
        for (const fieldId of Object.keys(answers)) {
            if (!allowedFieldIds.has(fieldId)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'An answer references an invalid question.',
                });
            }
        }
        const normalizedAnswers = [];
        for (const field of form.fields) {
            const rawValue = answers[field.id];
            const isEmpty = rawValue === undefined ||
                rawValue === null ||
                rawValue === '';
            if (field.required && isEmpty) {
                return res.status(400).json({
                    status: 'error',
                    message: `"${field.label}" is required.`,
                });
            }
            if (isEmpty)
                continue;
            let value;
            if (field.type === 'CHECKBOX') {
                if (typeof rawValue !== 'boolean') {
                    return res.status(400).json({
                        status: 'error',
                        message: `"${field.label}" must be a checkbox value.`,
                    });
                }
                value = rawValue;
            }
            else if (field.type === 'NUMBER') {
                if ((typeof rawValue !== 'string' &&
                    typeof rawValue !== 'number') ||
                    String(rawValue).trim() === '' ||
                    !Number.isFinite(Number(rawValue))) {
                    return res.status(400).json({
                        status: 'error',
                        message: `"${field.label}" must be a valid number.`,
                    });
                }
                value = Number(rawValue);
            }
            else {
                if (typeof rawValue !== 'string' ||
                    rawValue.trim().length > 5000) {
                    return res.status(400).json({
                        status: 'error',
                        message: `"${field.label}" must be text under 5,000 characters.`,
                    });
                }
                value = rawValue.trim();
                if (field.type === 'EMAIL' &&
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                    return res.status(400).json({
                        status: 'error',
                        message: `"${field.label}" must be a valid email address.`,
                    });
                }
                if (field.type === 'DROPDOWN' ||
                    field.type === 'MULTIPLE_CHOICE') {
                    const options = Array.isArray(field.options)
                        ? field.options
                        : [];
                    if (!options.some((option) => typeof option === 'string' && option === value)) {
                        return res.status(400).json({
                            status: 'error',
                            message: `Select a valid option for "${field.label}".`,
                        });
                    }
                }
                if (field.type === 'DATE' &&
                    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                        Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
                        new Date(`${value}T00:00:00Z`)
                            .toISOString()
                            .slice(0, 10) !== value)) {
                    return res.status(400).json({
                        status: 'error',
                        message: `"${field.label}" must be a valid date.`,
                    });
                }
            }
            normalizedAnswers.push({
                fieldId: field.id,
                fieldLabel: field.label,
                fieldType: field.type,
                value,
            });
        }
        const submission = await prisma.submission.create({
            data: {
                formId: form.id,
                formSchemaVersion: form.schemaVersion,
                formVersionSnapshot: {
                    title: form.title,
                    description: form.description,
                    schemaVersion: form.schemaVersion,
                    fields: form.fields.map((field) => ({
                        id: field.id,
                        label: field.label,
                        type: field.type,
                        required: field.required,
                        position: field.position,
                        options: field.options,
                        validation: field.validation,
                    })),
                },
                answers: {
                    create: normalizedAnswers.map((answer) => ({
                        fieldId: answer.fieldId,
                        fieldLabel: answer.fieldLabel,
                        fieldType: answer.fieldType,
                        value: answer.value,
                    })),
                },
            },
            select: {
                id: true,
                submittedAt: true,
            },
        });
        return res.status(201).json({
            status: 'ok',
            message: 'Response submitted successfully.',
            submission,
        });
    }
    catch (error) {
        console.error('Submit public form error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to submit your response.',
        });
    }
});
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
formsRouter.get('/public/:publicId', async (req, res) => {
    const publicId = req.params.publicId;
    if (typeof publicId !== 'string' || !/^[a-f0-9]{32}$/i.test(publicId)) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid public form link.',
        });
    }
    try {
        const form = await prisma.form.findFirst({
            where: {
                publicId,
                status: 'PUBLISHED',
            },
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                publicId: true,
                fields: {
                    orderBy: { position: 'asc' },
                    select: {
                        id: true,
                        label: true,
                        type: true,
                        required: true,
                        position: true,
                        options: true,
                        validation: true,
                    },
                },
            },
        });
        if (!form) {
            return res.status(404).json({
                status: 'error',
                message: 'Published form not found.',
            });
        }
        return res.json({
            status: 'ok',
            form,
        });
    }
    catch (error) {
        console.error('Load public form error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Unable to load this form.',
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
