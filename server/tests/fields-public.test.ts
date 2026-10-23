import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

type UserRecord = {
  id: string
  email: string
  name: string | null
  passwordHash: string
  createdAt: Date
}

type FormRecord = {
  id: string
  ownerId: string
  title: string
  description: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  publicId: string | null
  publishedAt: Date | null
  schemaVersion: number
  createdAt: Date
  updatedAt: Date
}

type FieldRecord = {
  id: string
  formId: string
  label: string
  type: string
  required: boolean
  position: number
  options: string[] | null
  validation: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
}

const testState = vi.hoisted(() => ({
  users: new Map<string, UserRecord>(),
  forms: new Map<string, FormRecord>(),
  fields: new Map<string, FieldRecord>(),
  nextUserId: 1,
  nextFormId: 1,
  nextFieldId: 1,
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
    form: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    formField: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    submission: { create: vi.fn() },
  },
}))

vi.mock('../src/lib/prisma.ts', () => ({ prisma: testState.prisma }))

vi.mock('../src/lib/session.ts', async () => {
  const sessionModule = await import('express-session')

  return {
    sessionMiddleware: sessionModule.default({
      store: new sessionModule.MemoryStore(),
      name: 'formpilot.sid',
      secret: 'isolated-field-public-test-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax' },
    }),
  }
})

// The app constructs a PostgreSQL pool during import; these harmless local
// placeholders satisfy configuration while the Prisma and session modules
// are mocked and never open a database connection.
process.env.PGHOST ??= '127.0.0.1'
process.env.PGPORT ??= '5432'
process.env.PGDATABASE ??= 'formpilot_fields_test'
process.env.PGUSER ??= 'formpilot_fields_test'
process.env.PGPASSWORD ??= 'formpilot_fields_test'
process.env.SESSION_SECRET ??= 'isolated-field-public-test-session-secret'

const { default: app } = await import('../src/app.js')

function select(value: Record<string, unknown>, keys?: Record<string, unknown>) {
  if (!keys) return value
  return Object.fromEntries(Object.keys(keys).map((key) => [key, value[key]]))
}

function fieldsFor(formId: string) {
  return [...testState.fields.values()]
    .filter((field) => field.formId === formId)
    .sort((a, b) => a.position - b.position)
}

function projectField(field: FieldRecord, fieldSelect?: Record<string, unknown>) {
  return select({ ...field }, fieldSelect)
}

function projectForm(form: FormRecord, args: Record<string, any> = {}) {
  const value: Record<string, unknown> = { ...form }
  if (args.include?.fields) {
    value.fields = fieldsFor(form.id).map((field) => projectField(field))
  }
  if (args.include?._count || args.select?._count) {
    value._count = { submissions: 0 }
  }
  if (args.select) {
    if (args.select.fields?.select) {
      value.fields = fieldsFor(form.id).map((field) =>
        projectField(field, args.select.fields.select),
      )
    }
    return select(value, args.select)
  }
  return value
}

beforeEach(() => {
  testState.users.clear()
  testState.forms.clear()
  testState.fields.clear()
  testState.nextUserId = 1
  testState.nextFormId = 1
  testState.nextFieldId = 1

  for (const method of Object.values(testState.prisma.user)) method.mockReset()
  for (const method of Object.values(testState.prisma.form)) method.mockReset()
  for (const method of Object.values(testState.prisma.formField)) method.mockReset()
  testState.prisma.submission.create.mockReset()
  testState.prisma.user.count.mockResolvedValue(0)
  testState.prisma.form.count.mockResolvedValue(0)

  testState.prisma.user.findUnique.mockImplementation(async ({ where, select: userSelect }) => {
    const user = where.email
      ? testState.users.get(String(where.email))
      : [...testState.users.values()].find((candidate) => candidate.id === where.id)
    return user ? select(user, userSelect) : null
  })
  testState.prisma.user.create.mockImplementation(async ({ data, select: userSelect }) => {
    const user: UserRecord = {
      id: `30000000-0000-4000-8000-${String(testState.nextUserId++).padStart(12, '0')}`,
      email: data.email,
      name: data.name ?? null,
      passwordHash: data.passwordHash,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    testState.users.set(user.email, user)
    return select(user, userSelect)
  })

  testState.prisma.form.create.mockImplementation(async ({ data, select: formSelect }) => {
    const now = new Date('2026-01-02T00:00:00.000Z')
    const form: FormRecord = {
      id: `40000000-0000-4000-8000-${String(testState.nextFormId++).padStart(12, '0')}`,
      ownerId: data.ownerId,
      title: data.title,
      description: data.description ?? null,
      status: 'DRAFT',
      publicId: null,
      publishedAt: null,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    }
    testState.forms.set(form.id, form)
    return projectForm(form, { select: formSelect })
  })
  testState.prisma.form.findFirst.mockImplementation(async ({ where, ...args }) => {
    const form = where.publicId
      ? [...testState.forms.values()].find((candidate) => candidate.publicId === where.publicId)
      : testState.forms.get(String(where.id))
    if (
      !form ||
      (where.ownerId !== undefined && form.ownerId !== where.ownerId) ||
      (where.status !== undefined && form.status !== where.status)
    ) {
      return null
    }
    return projectForm(form, args)
  })
  testState.prisma.form.findMany.mockImplementation(async ({ where, select: formSelect }) =>
    [...testState.forms.values()]
      .filter((form) => form.ownerId === where.ownerId)
      .map((form) => projectForm(form, { select: formSelect })),
  )
  testState.prisma.form.updateMany.mockImplementation(async ({ where, data }) => {
    const form = testState.forms.get(String(where.id))
    if (
      !form || form.ownerId !== where.ownerId ||
      (where.status !== undefined && form.status !== where.status) ||
      (where.publicId === null && form.publicId !== null)
    ) {
      return { count: 0 }
    }
    Object.assign(form, data, { updatedAt: new Date('2026-01-03T00:00:00.000Z') })
    return { count: 1 }
  })
  testState.prisma.form.update.mockImplementation(async ({ where, data }) => {
    const form = testState.forms.get(String(where.id))
    if (!form) throw new Error('Form not found')
    Object.assign(form, data)
    return form
  })
  testState.prisma.form.deleteMany.mockImplementation(async ({ where }) => {
    const form = testState.forms.get(String(where.id))
    if (!form || form.ownerId !== where.ownerId || form.status !== where.status) {
      return { count: 0 }
    }
    testState.forms.delete(form.id)
    return { count: 1 }
  })

  testState.prisma.formField.findFirst.mockImplementation(async ({ where, orderBy }) => {
    const fields = fieldsFor(String(where.formId))
    if (where.id) return fields.find((field) => field.id === where.id) ?? null
    return orderBy?.position === 'desc' ? fields.at(-1) ?? null : null
  })
  testState.prisma.formField.findMany.mockImplementation(async ({ where, orderBy, select: fieldSelect }) => {
    const fields = fieldsFor(String(where.formId))
    if (orderBy?.position === 'asc') fields.sort((a, b) => a.position - b.position)
    return fields.map((field) => projectField(field, fieldSelect))
  })
  testState.prisma.formField.create.mockImplementation(async ({ data }) => {
    const now = new Date('2026-01-02T00:00:00.000Z')
    const field: FieldRecord = {
      id: `50000000-0000-4000-8000-${String(testState.nextFieldId++).padStart(12, '0')}`,
      formId: data.formId,
      label: data.label,
      type: data.type,
      required: data.required,
      position: data.position,
      options: data.options ?? null,
      validation: data.validation ?? null,
      createdAt: now,
      updatedAt: now,
    }
    testState.fields.set(field.id, field)
    return field
  })
  testState.prisma.formField.update.mockImplementation(async ({ where, data }) => {
    const field = testState.fields.get(String(where.id))
    if (!field) throw new Error('Field not found')
    Object.assign(field, data, { updatedAt: new Date('2026-01-03T00:00:00.000Z') })
    return field
  })
  testState.prisma.formField.delete.mockImplementation(async ({ where }) => {
    const field = testState.fields.get(String(where.id))
    if (!field) throw new Error('Field not found')
    testState.fields.delete(field.id)
    return field
  })
})

const password = 'correct-horse-battery-staple'

async function authenticatedAgent(email: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({
    name: 'Field Test User',
    email,
    password,
  })
  expect(response.status).toBe(201)
  return { agent, user: response.body.user as { id: string } }
}

async function createOwnedForm(agent: ReturnType<typeof request.agent>, title = 'Test form') {
  const response = await agent.post('/api/forms').send({ title })
  expect(response.status).toBe(201)
  return response.body.form as { id: string }
}

async function createField(
  agent: ReturnType<typeof request.agent>,
  formId: string,
  label = 'Full name',
) {
  return agent.post(`/api/forms/${formId}/fields`).send({
    label,
    type: 'SHORT_TEXT',
    required: true,
  })
}

describe('Form field management', () => {
  it('allows an authenticated owner to create and list fields', async () => {
    const { agent } = await authenticatedAgent('fields-create-list@example.test')
    const form = await createOwnedForm(agent)
    const created = await createField(agent, form.id)
    const listed = await agent.get(`/api/forms/${form.id}/fields`)

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      status: 'ok',
      message: 'Form field created successfully',
      field: { formId: form.id, label: 'Full name', type: 'SHORT_TEXT', required: true, position: 1 },
    })
    expect(listed.status).toBe(200)
    expect(listed.body.count).toBe(1)
    expect(listed.body.fields[0].id).toBe(created.body.field.id)
  })

  it('allows an owner to update and delete their field', async () => {
    const { agent } = await authenticatedAgent('fields-update-delete@example.test')
    const form = await createOwnedForm(agent)
    const created = await createField(agent, form.id)
    const fieldId = created.body.field.id as string

    const updated = await agent
      .patch(`/api/forms/${form.id}/fields/${fieldId}`)
      .send({ label: 'Preferred name' })
    const deleted = await agent.delete(`/api/forms/${form.id}/fields/${fieldId}`)
    const listed = await agent.get(`/api/forms/${form.id}/fields`)

    expect(updated.status).toBe(200)
    expect(updated.body.field.label).toBe('Preferred name')
    expect(deleted.status).toBe(200)
    expect(deleted.body.message).toBe('Form field deleted successfully')
    expect(listed.body.count).toBe(0)
  })

  it('rejects unauthenticated field-management requests', async () => {
    const formId = '40000000-0000-4000-8000-000000000001'
    const fieldId = '50000000-0000-4000-8000-000000000001'
    const responses = await Promise.all([
      request(app).post(`/api/forms/${formId}/fields`).send({ label: 'Name', type: 'SHORT_TEXT' }),
      request(app).get(`/api/forms/${formId}/fields`),
      request(app).patch(`/api/forms/${formId}/fields/${fieldId}`).send({ label: 'Changed' }),
      request(app).delete(`/api/forms/${formId}/fields/${fieldId}`),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401])
    expect(responses.every((response) => response.body.message === 'Authentication required'))
      .toBe(true)
  })

  it('does not allow a user to modify or delete another user’s field', async () => {
    const userA = await authenticatedAgent('fields-owner-a@example.test')
    const userB = await authenticatedAgent('fields-owner-b@example.test')
    const form = await createOwnedForm(userB.agent, 'B form')
    const created = await createField(userB.agent, form.id, 'B field')
    const fieldId = created.body.field.id as string

    const update = await userA.agent
      .patch(`/api/forms/${form.id}/fields/${fieldId}`)
      .send({ label: 'Hijacked field' })
    const remove = await userA.agent.delete(`/api/forms/${form.id}/fields/${fieldId}`)
    const ownerList = await userB.agent.get(`/api/forms/${form.id}/fields`)

    expect(update.status).toBe(404)
    expect(remove.status).toBe(404)
    expect(ownerList.status).toBe(200)
    expect(ownerList.body.fields[0].label).toBe('B field')
  })

  it('rejects invalid field data using the existing validation rules', async () => {
    const { agent } = await authenticatedAgent('fields-invalid@example.test')
    const form = await createOwnedForm(agent)

    const emptyLabel = await agent.post(`/api/forms/${form.id}/fields`).send({
      label: '   ',
      type: 'SHORT_TEXT',
    })
    const missingOptions = await agent.post(`/api/forms/${form.id}/fields`).send({
      label: 'Choose one',
      type: 'DROPDOWN',
      options: ['Only one'],
    })

    expect(emptyLabel.status).toBe(400)
    expect(emptyLabel.body.message).toBe('Invalid field data')
    expect(missingOptions.status).toBe(400)
    expect(missingOptions.body.message)
      .toBe('Dropdown and multiple-choice fields need at least two options')
    expect(testState.fields.size).toBe(0)
  })
})

describe('Form publishing and public access', () => {
  it('publishes a form and returns only the public form data', async () => {
    const { agent } = await authenticatedAgent('publish-form@example.test')
    const form = await createOwnedForm(agent, 'Public feedback')
    await createField(agent, form.id, 'Your feedback')

    const published = await agent.post(`/api/forms/${form.id}/publish`)
    const publicId = published.body.form.publicId as string
    const publicResponse = await request(app).get(`/api/forms/public/${publicId}`)

    expect(published.status).toBe(200)
    expect(published.body).toMatchObject({
      status: 'ok',
      message: 'Form published successfully.',
      form: { id: form.id, title: 'Public feedback', status: 'PUBLISHED' },
    })
    expect(publicId).toMatch(/^[a-f0-9]{32}$/i)
    expect(publicResponse.status).toBe(200)
    expect(publicResponse.body).toMatchObject({
      status: 'ok',
      form: {
        id: form.id,
        title: 'Public feedback',
        status: 'PUBLISHED',
        publicId,
        fields: [{ id: expect.any(String), label: 'Your feedback', type: 'SHORT_TEXT' }],
      },
    })
    expect(publicResponse.body.form).not.toHaveProperty('ownerId')
    expect(publicResponse.body.form).not.toHaveProperty('schemaVersion')
    expect(publicResponse.body.form).not.toHaveProperty('createdAt')
    expect(publicResponse.body.form.fields[0]).not.toHaveProperty('formId')
    expect(publicResponse.body.form.fields[0]).not.toHaveProperty('createdAt')
  })

  it('does not publicly expose a draft form with an unpublished public ID', async () => {
    const { agent } = await authenticatedAgent('draft-form-public@example.test')
    const form = await createOwnedForm(agent, 'Still private')
    const publicId = 'a'.repeat(32)
    const storedForm = testState.forms.get(form.id)!
    storedForm.publicId = publicId

    const response = await request(app).get(`/api/forms/public/${publicId}`)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      status: 'error',
      message: 'Published form not found.',
    })
  })

  it('rejects malformed and unknown public form identifiers', async () => {
    const malformed = await request(app).get('/api/forms/public/not-a-public-id')
    const unknown = await request(app).get(`/api/forms/public/${'b'.repeat(32)}`)

    expect(malformed.status).toBe(400)
    expect(malformed.body).toEqual({
      status: 'error',
      message: 'Invalid public form link.',
    })
    expect(unknown.status).toBe(404)
    expect(unknown.body).toEqual({
      status: 'error',
      message: 'Published form not found.',
    })
  })
})
