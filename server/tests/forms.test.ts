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
  createdAt: Date
  updatedAt: Date
  submissionsCount: number
}

const testState = vi.hoisted(() => ({
  users: new Map<string, UserRecord>(),
  forms: new Map<string, FormRecord>(),
  nextUserId: 1,
  nextFormId: 1,
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
    form: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    formField: {},
  },
}))

vi.mock('../src/lib/prisma.ts', () => ({ prisma: testState.prisma }))

vi.mock('../src/lib/session.ts', async () => {
  const sessionModule = await import('express-session')

  return {
    sessionMiddleware: sessionModule.default({
      store: new sessionModule.MemoryStore(),
      name: 'formpilot.sid',
      secret: 'isolated-forms-test-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax' },
    }),
  }
})

// App construction needs settings, but the Prisma and session modules are
// mocked below, so no PostgreSQL connection is made.
process.env.PGHOST ??= '127.0.0.1'
process.env.PGPORT ??= '5432'
process.env.PGDATABASE ??= 'formpilot_forms_test'
process.env.PGUSER ??= 'formpilot_forms_test'
process.env.PGPASSWORD ??= 'formpilot_forms_test'
process.env.SESSION_SECRET ??= 'isolated-forms-test-session-secret'

const { default: app } = await import('../src/app.js')

function selectFields<T extends Record<string, unknown>>(
  value: T,
  select?: Record<string, unknown>,
) {
  if (!select) return value

  return Object.fromEntries(
    Object.keys(select).map((key) => [key, value[key]]),
  )
}

function selectForm(form: FormRecord, args: Record<string, any> = {}) {
  const value: Record<string, unknown> = { ...form }

  if (args.include?.fields) value.fields = []
  if (args.include?._count || args.select?._count) {
    value._count = { submissions: form.submissionsCount }
  }
  if (args.select) return selectFields(value, args.select)

  delete value.submissionsCount
  return value
}

beforeEach(() => {
  testState.users.clear()
  testState.forms.clear()
  testState.nextUserId = 1
  testState.nextFormId = 1

  for (const method of Object.values(testState.prisma.user)) {
    method.mockReset()
  }
  for (const method of Object.values(testState.prisma.form)) {
    method.mockReset()
  }

  testState.prisma.user.findUnique.mockImplementation(async ({ where, select }) => {
    const user = where.email
      ? testState.users.get(String(where.email))
      : [...testState.users.values()].find((candidate) => candidate.id === where.id)
    if (!user) return null
    return select ? selectFields(user, select) : user
  })

  testState.prisma.user.create.mockImplementation(async ({ data, select }) => {
    const id = `10000000-0000-4000-8000-${String(testState.nextUserId++).padStart(12, '0')}`
    const user: UserRecord = {
      id,
      email: data.email,
      name: data.name ?? null,
      passwordHash: data.passwordHash,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    testState.users.set(user.email, user)
    return select ? selectFields(user, select) : user
  })
  testState.prisma.user.count.mockResolvedValue(0)

  testState.prisma.form.create.mockImplementation(async ({ data, select }) => {
    const now = new Date('2026-01-02T00:00:00.000Z')
    const id = `20000000-0000-4000-8000-${String(testState.nextFormId++).padStart(12, '0')}`
    const form: FormRecord = {
      id,
      ownerId: data.ownerId,
      title: data.title,
      description: data.description ?? null,
      status: 'DRAFT',
      createdAt: now,
      updatedAt: now,
      submissionsCount: 0,
    }
    testState.forms.set(id, form)
    return selectForm(form, { select })
  })

  testState.prisma.form.findMany.mockImplementation(async ({ where, orderBy, select }) => {
    const forms = [...testState.forms.values()]
      .filter((form) => form.ownerId === where.ownerId)
      .sort((a, b) => orderBy?.updatedAt === 'desc'
        ? b.updatedAt.getTime() - a.updatedAt.getTime()
        : 0)
    return forms.map((form) => selectForm(form, { select }))
  })

  testState.prisma.form.findFirst.mockImplementation(async ({ where, ...args }) => {
    const form = testState.forms.get(String(where.id))
    if (
      !form ||
      (where.ownerId !== undefined && form.ownerId !== where.ownerId) ||
      (where.status !== undefined && form.status !== where.status)
    ) {
      return null
    }
    return selectForm(form, args)
  })

  testState.prisma.form.updateMany.mockImplementation(async ({ where, data }) => {
    const form = testState.forms.get(String(where.id))
    if (
      !form || form.ownerId !== where.ownerId ||
      (where.status !== undefined && form.status !== where.status)
    ) {
      return { count: 0 }
    }
    Object.assign(form, data, { updatedAt: new Date('2026-01-03T00:00:00.000Z') })
    return { count: 1 }
  })

  testState.prisma.form.deleteMany.mockImplementation(async ({ where }) => {
    const form = testState.forms.get(String(where.id))
    if (!form || form.ownerId !== where.ownerId || form.status !== where.status) {
      return { count: 0 }
    }
    testState.forms.delete(form.id)
    return { count: 1 }
  })
  testState.prisma.form.count.mockResolvedValue(0)
})

const password = 'correct-horse-battery-staple'

async function authenticatedAgent(email: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({
    name: 'Form Test User',
    email,
    password,
  })
  expect(response.status).toBe(201)
  return { agent, user: response.body.user as { id: string } }
}

async function createForm(agent: ReturnType<typeof request.agent>, title: string) {
  return agent.post('/api/forms').send({ title, description: 'Test description' })
}

describe('Form management', () => {
  it('creates a form for the authenticated user', async () => {
    const { agent, user } = await authenticatedAgent('create-form@example.test')
    const response = await createForm(agent, 'Customer feedback')

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      status: 'ok',
      message: 'Form created successfully',
      form: {
        title: 'Customer feedback',
        description: 'Test description',
        status: 'DRAFT',
      },
    })
    expect(testState.forms.get(response.body.form.id)?.ownerId).toBe(user.id)
  })

  it('lists only the authenticated user’s forms', async () => {
    const userA = await authenticatedAgent('list-a@example.test')
    const userB = await authenticatedAgent('list-b@example.test')
    await createForm(userA.agent, 'A private form')
    await createForm(userB.agent, 'B private form')

    const response = await userA.agent.get('/api/forms')

    expect(response.status).toBe(200)
    expect(response.body.count).toBe(1)
    expect(response.body.forms.map((form: { title: string }) => form.title))
      .toEqual(['A private form'])
  })

  it('retrieves an authenticated user’s own form', async () => {
    const { agent } = await authenticatedAgent('retrieve-form@example.test')
    const created = await createForm(agent, 'Owned form')

    const response = await agent.get(`/api/forms/${created.body.form.id}`)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'ok',
      form: { id: created.body.form.id, title: 'Owned form', fields: [] },
    })
  })

  it('updates an authenticated user’s own draft form', async () => {
    const { agent } = await authenticatedAgent('update-form@example.test')
    const created = await createForm(agent, 'Before update')

    const response = await agent
      .patch(`/api/forms/${created.body.form.id}`)
      .send({ title: 'After update' })

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      status: 'ok',
      message: 'Form updated successfully',
      form: { id: created.body.form.id, title: 'After update' },
    })
  })

  it('deletes an authenticated user’s own empty draft form', async () => {
    const { agent } = await authenticatedAgent('delete-form@example.test')
    const created = await createForm(agent, 'To delete')

    const response = await agent.delete(`/api/forms/${created.body.form.id}`)
    const retrieve = await agent.get(`/api/forms/${created.body.form.id}`)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok', message: 'Form deleted successfully' })
    expect(retrieve.status).toBe(404)
  })

  it('rejects protected form operations without authentication', async () => {
    const formId = '20000000-0000-4000-8000-000000000001'
    const responses = await Promise.all([
      request(app).post('/api/forms').send({ title: 'No session' }),
      request(app).get('/api/forms'),
      request(app).get(`/api/forms/${formId}`),
      request(app).patch(`/api/forms/${formId}`).send({ title: 'No session' }),
      request(app).delete(`/api/forms/${formId}`),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401])
    expect(responses.every((response) => response.body.message === 'Authentication required'))
      .toBe(true)
  })

  it('does not let User A read, update, or delete User B’s private form', async () => {
    const userA = await authenticatedAgent('private-form-a@example.test')
    const userB = await authenticatedAgent('private-form-b@example.test')
    const created = await createForm(userB.agent, 'B private form')
    const formId = created.body.form.id as string

    const read = await userA.agent.get(`/api/forms/${formId}`)
    const update = await userA.agent.patch(`/api/forms/${formId}`).send({ title: 'Taken over' })
    const remove = await userA.agent.delete(`/api/forms/${formId}`)
    const ownerRead = await userB.agent.get(`/api/forms/${formId}`)

    expect([read.status, update.status, remove.status]).toEqual([404, 404, 404])
    expect(ownerRead.status).toBe(200)
    expect(ownerRead.body.form.title).toBe('B private form')
    expect(testState.forms.get(formId)?.ownerId).toBe(userB.user.id)
  })

  it('rejects invalid form data using the existing validation rules', async () => {
    const { agent } = await authenticatedAgent('invalid-form@example.test')
    const response = await agent.post('/api/forms').send({
      title: '   ',
      description: 'Test description',
    })

    expect(response.status).toBe(400)
    expect(response.body.status).toBe('error')
    expect(response.body.message).toBe('Invalid form details')
    expect(response.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'title' }),
    ]))
    expect(testState.forms.size).toBe(0)
  })
})
