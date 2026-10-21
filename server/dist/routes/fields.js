import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
const fieldsRouter = Router({ mergeParams: true });
const fieldSchema = z.object({
    label: z.string().trim().min(1).max(200),
    type: z.enum([
        'SHORT_TEXT',
        'LONG_TEXT',
        'EMAIL',
        'NUMBER',
        'DROPDOWN',
        'MULTIPLE_CHOICE',
        'CHECKBOX',
        'DATE',
    ]),
    required: z.boolean().optional().default(false),
    options: z.array(z.string().trim().min(1).max(200))
        .max(100)
        .optional(),
    validation: z.record(z.string(), z.unknown()).optional(),
});
fieldsRouter.post('/', requireAuth, async (req, res) => {
    try {
        const ownerId = req.session.userId;
        const formId = req.params.formId;
        if (!ownerId) {
            res.status(401).json({
                status: 'error',
                message: 'Authentication required',
            });
            return;
        }
        if (typeof formId !== 'string') {
            res.status(400).json({
                status: 'error',
                message: 'Invalid form ID',
            });
            return;
        }
        const validation = fieldSchema.safeParse(req.body);
        if (!validation.success) {
            res.status(400).json({
                status: 'error',
                message: 'Invalid field data',
                errors: validation.error.flatten(),
            });
            return;
        }
        const form = await prisma.form.findFirst({
            where: {
                id: formId,
                ownerId,
                status: 'DRAFT',
            },
            select: { id: true },
        });
        if (!form) {
            res.status(404).json({
                status: 'error',
                message: 'Draft form not found',
            });
            return;
        }
        const fieldType = validation.data.type;
        const options = validation.data.options;
        if (['DROPDOWN', 'MULTIPLE_CHOICE'].includes(fieldType) &&
            (!options || options.length < 2)) {
            res.status(400).json({
                status: 'error',
                message: 'Dropdown and multiple-choice fields need at least two options',
            });
            return;
        }
        if (!['DROPDOWN', 'MULTIPLE_CHOICE'].includes(fieldType) &&
            options !== undefined) {
            res.status(400).json({
                status: 'error',
                message: 'Options are only supported for dropdown and multiple-choice fields',
            });
            return;
        }
        const lastField = await prisma.formField.findFirst({
            where: { formId },
            orderBy: { position: 'desc' },
            select: { position: true },
        });
        const field = await prisma.formField.create({
            data: {
                formId,
                label: validation.data.label,
                type: fieldType,
                required: validation.data.required,
                position: (lastField?.position ?? 0) + 1,
                options: options ?? undefined,
                validation: validation.data.validation,
            },
        });
        await prisma.form.update({
            where: { id: formId },
            data: { updatedAt: new Date() },
        });
        res.status(201).json({
            status: 'ok',
            message: 'Form field created successfully',
            field,
        });
    }
    catch (error) {
        console.error('Create form field error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Unable to create form field',
        });
    }
});
const updateFieldSchema = z.object({
    label: z.string().trim().min(1).max(200).optional(),
    type: z.enum([
        'SHORT_TEXT',
        'LONG_TEXT',
        'EMAIL',
        'NUMBER',
        'DROPDOWN',
        'MULTIPLE_CHOICE',
        'CHECKBOX',
        'DATE',
    ]).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(200))
        .max(100)
        .optional(),
    validation: z.record(z.string(), z.unknown()).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field property to update' });
fieldsRouter.patch('/:fieldId', requireAuth, async (req, res) => {
    try {
        const ownerId = req.session.userId;
        const formId = req.params.formId;
        const fieldId = req.params.fieldId;
        if (!ownerId) {
            res.status(401).json({
                status: 'error',
                message: 'Authentication required',
            });
            return;
        }
        if (typeof formId !== 'string' ||
            typeof fieldId !== 'string') {
            res.status(400).json({
                status: 'error',
                message: 'Invalid form or field ID',
            });
            return;
        }
        const parsed = updateFieldSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                status: 'error',
                message: 'Invalid field data',
                errors: parsed.error.flatten(),
            });
            return;
        }
        const form = await prisma.form.findFirst({
            where: {
                id: formId,
                ownerId,
                status: 'DRAFT',
            },
            select: { id: true },
        });
        if (!form) {
            res.status(404).json({
                status: 'error',
                message: 'Draft form not found',
            });
            return;
        }
        const existingField = await prisma.formField.findFirst({
            where: { id: fieldId, formId },
        });
        if (!existingField) {
            res.status(404).json({
                status: 'error',
                message: 'Form field not found',
            });
            return;
        }
        const data = parsed.data;
        const nextType = data.type ?? existingField.type;
        const nextOptions = data.options ?? (Array.isArray(existingField.options)
            ? existingField.options.filter((option) => typeof option === 'string')
            : undefined);
        if (['DROPDOWN', 'MULTIPLE_CHOICE'].includes(nextType) &&
            (!nextOptions || nextOptions.length < 2)) {
            res.status(400).json({
                status: 'error',
                message: 'Dropdown and multiple-choice fields need at least two options',
            });
            return;
        }
        if (!['DROPDOWN', 'MULTIPLE_CHOICE'].includes(nextType) &&
            data.options !== undefined) {
            res.status(400).json({
                status: 'error',
                message: 'Options are only supported for dropdown and multiple-choice fields',
            });
            return;
        }
        const field = await prisma.formField.update({
            where: { id: fieldId },
            data: {
                ...(data.label !== undefined && { label: data.label }),
                ...(data.type !== undefined && { type: data.type }),
                ...(data.required !== undefined && { required: data.required }),
                ...(data.options !== undefined && { options: data.options }),
                ...(data.validation !== undefined && {
                    validation: data.validation,
                }),
            },
        });
        await prisma.form.update({
            where: { id: formId },
            data: { updatedAt: new Date() },
        });
        res.json({
            status: 'ok',
            message: 'Form field updated successfully',
            field,
        });
    }
    catch (error) {
        console.error('Update form field error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Unable to update form field',
        });
    }
});
fieldsRouter.delete('/:fieldId', requireAuth, async (req, res) => {
    try {
        const ownerId = req.session.userId;
        const formId = req.params.formId;
        const fieldId = req.params.fieldId;
        if (!ownerId) {
            res.status(401).json({
                status: 'error',
                message: 'Authentication required',
            });
            return;
        }
        if (typeof formId !== 'string' ||
            typeof fieldId !== 'string') {
            res.status(400).json({
                status: 'error',
                message: 'Invalid form or field ID',
            });
            return;
        }
        const form = await prisma.form.findFirst({
            where: {
                id: formId,
                ownerId,
                status: 'DRAFT',
            },
            select: { id: true },
        });
        if (!form) {
            res.status(404).json({
                status: 'error',
                message: 'Draft form not found',
            });
            return;
        }
        const field = await prisma.formField.findFirst({
            where: { id: fieldId, formId },
            select: { id: true },
        });
        if (!field) {
            res.status(404).json({
                status: 'error',
                message: 'Form field not found',
            });
            return;
        }
        await prisma.formField.delete({
            where: { id: fieldId },
        });
        await prisma.form.update({
            where: { id: formId },
            data: { updatedAt: new Date() },
        });
        res.json({
            status: 'ok',
            message: 'Form field deleted successfully',
        });
    }
    catch (error) {
        console.error('Delete form field error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Unable to delete form field',
        });
    }
});
fieldsRouter.get('/', requireAuth, async (req, res) => {
    try {
        const ownerId = req.session.userId;
        const formId = req.params.formId;
        if (!ownerId) {
            res.status(401).json({
                status: 'error',
                message: 'Authentication required',
            });
            return;
        }
        if (typeof formId !== 'string') {
            res.status(400).json({
                status: 'error',
                message: 'Invalid form ID',
            });
            return;
        }
        // Confirm that the form belongs to the logged-in user.
        const form = await prisma.form.findFirst({
            where: {
                id: formId,
                ownerId,
            },
            select: {
                id: true,
                title: true,
                status: true,
            },
        });
        if (!form) {
            res.status(404).json({
                status: 'error',
                message: 'Form not found',
            });
            return;
        }
        // Retrieve questions in their saved order.
        const fields = await prisma.formField.findMany({
            where: { formId },
            orderBy: { position: 'asc' },
        });
        res.json({
            status: 'ok',
            form,
            count: fields.length,
            fields,
        });
    }
    catch (error) {
        console.error('Get form fields error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Unable to retrieve form fields',
        });
    }
});
const reorderFieldsSchema = z.object({
    fieldIds: z.array(z.string().uuid()).min(1).max(100),
}).refine((data) => new Set(data.fieldIds).size === data.fieldIds.length, { message: 'Field IDs must not contain duplicates' });
fieldsRouter.patch('/reorder', requireAuth, async (req, res) => {
    try {
        const ownerId = req.session.userId;
        const formId = req.params.formId;
        if (!ownerId) {
            res.status(401).json({
                status: 'error',
                message: 'Authentication required',
            });
            return;
        }
        if (typeof formId !== 'string') {
            res.status(400).json({
                status: 'error',
                message: 'Invalid form ID',
            });
            return;
        }
        const parsed = reorderFieldsSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                status: 'error',
                message: 'Invalid field order',
                errors: parsed.error.flatten(),
            });
            return;
        }
        const form = await prisma.form.findFirst({
            where: {
                id: formId,
                ownerId,
                status: 'DRAFT',
            },
            select: { id: true },
        });
        if (!form) {
            res.status(404).json({
                status: 'error',
                message: 'Draft form not found',
            });
            return;
        }
        const existingFields = await prisma.formField.findMany({
            where: { formId },
            select: { id: true },
        });
        const requestedIds = parsed.data.fieldIds;
        const existingIds = new Set(existingFields.map((field) => field.id));
        // Require every field to be included exactly once.
        if (requestedIds.length !== existingFields.length ||
            requestedIds.some((id) => !existingIds.has(id))) {
            res.status(400).json({
                status: 'error',
                message: 'Provide every field ID belonging to this form, exactly once',
            });
            return;
        }
        await prisma.$transaction(async (tx) => {
            // Move positions to temporary negative values first to avoid
            // conflicts with the unique constraint on (formId, position).
            for (let index = 0; index < requestedIds.length; index++) {
                await tx.formField.update({
                    where: { id: requestedIds[index] },
                    data: { position: -(index + 1) },
                });
            }
            for (let index = 0; index < requestedIds.length; index++) {
                await tx.formField.update({
                    where: { id: requestedIds[index] },
                    data: { position: index + 1 },
                });
            }
            await tx.form.update({
                where: { id: formId },
                data: { updatedAt: new Date() },
            });
        });
        const fields = await prisma.formField.findMany({
            where: { formId },
            orderBy: { position: 'asc' },
        });
        res.json({
            status: 'ok',
            message: 'Form fields reordered successfully',
            fields,
        });
    }
    catch (error) {
        console.error('Reorder form fields error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Unable to reorder form fields',
        });
    }
});
export default fieldsRouter;
