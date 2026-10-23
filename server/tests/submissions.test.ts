import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

type UserRecord = {
  id: string
  email: string
  name: string | null
  passwordHash: string
  createdAt: Date
}

type FormFieldRecord = {
  id: string
  formId: string
  label: string
  type: 'SHORT_TEXT' | 'EMAIL' | 'NUMBER' | 'CHECKBOX'
  required: boolean
  position: number
  options: string[] | null
  validation: Record<string, unknown> | null
}

type FormRecord = {
  id: string
  ownerId: string
  title: string
  description: string | null
  status: 'DRAFT' | 'PUBLISHED'
  publicId: string | null
  schemaVersion: number
  fields: FormFieldRecord[]
}

type AnswerRecord = {
  id: string
  fieldId: string
  fieldLabel: string
  fieldType: string
  value: unknown
}

type SubmissionRecord = {
  id: string
  formId: string
  formSchemaVersion: number
  formVersionSnapshot: Record<string, unknown>
  submittedAt: Date
  answers: AnswerRecord[]
}

const testState = vi.hoisted(() => ({
  users: new Map<string, UserRecord>(),
  forms: new Map<string, FormRecord>(),
  submissions: new Map<string, SubmissionRecord>(),
  nextUserId: 1,
  nextSubmissionId: 1,
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
    form: { findFirst: vi.fn(), count: vi.fn() },
    submission: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('../src/lib/prisma.ts', () => ({ prisma: testState.prisma }))

vi.mock('../src/lib/session.ts', async () => {
  const sessionModule = await import('express-session')

  return {
    sessionMiddleware: sessionModule.default({
      store: new sessionModule.MemoryStore(),
      name: 'formpilot.sid',
      secret: 'isolated-submissions-test-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax' },
    }),
  }
})

// App construction reads database settings, but these tests use mocked Prisma
// and session modules and never connect to a database.
process.env.PGHOST ??= '127.0.0.1'
process.env.PGPORT ??= '5432'
process.env.PGDATABASE ??= 'formpilot_submissions_test'
process.env.PGUSER ??= 'formpilot_submissions_test'
process.env.PGPASSWORD ??= 'formpilot_submissions_test'
process.env.SESSION_SECRET ??= 'isolated-submissions-test-session-secret'

const { default: app } = await import('../src/app.js')

const validFormId = '60000000-0000-4000-8000-000000000001'
const secondFormId = '60000000-0000-4000-8000-000000000002'
const emailFieldId = '70000000-0000-4000-8000-000000000001'
const messageFieldId = '70000000-0000-4000-8000-000000000002'
const publicId = 'c'.repeat(32)
const password = 'correct-horse-battery-staple'

beforeEach(() => {
  testState.users.clear()
  testState.forms.clear()
  testState.submissions.clear()
  testState.nextUserId = 1
  testState.nextSubmissionId = 1

  for (const method of Object.values(testState.prisma.user)) method.mockReset()
  for (const method of Object.values(testState.prisma.form)) method.mockReset()
  for (const method of Object.values(testState.prisma.submission)) method.mockReset()
  testState.prisma.user.count.mockResolvedValue(0)
  testState.prisma.form.count.mockResolvedValue(0)

  testState.prisma.user.findUnique.mockImplementation(async ({ where, select }) => {
    const user = where.email
      ? testState.users.get(String(where.email))
      : [...testState.users.values()].find((candidate) => candidate.id === where.id)
    if (!user) return null
    return select ? Object.fromEntries(Object.keys(select).map((key) => [key, user[key as keyof UserRecord]])) : user
  })
  testState.prisma.user.create.mockImplementation(async ({ data, select }) => {
    const user: UserRecord = {
      id: `80000000-0000-4000-8000-${String(testState.nextUserId++).padStart(12, '0')}`,
      email: data.email,
      name: data.name ?? null,
      passwordHash: data.passwordHash,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    }
    testState.users.set(user.email, user)
    return select ? Object.fromEntries(Object.keys(select).map((key) => [key, user[key as keyof UserRecord]])) : user
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

    if (args.select) {
      const selected: Record<string, unknown> = {}
      for (const key of Object.keys(args.select)) {
        if (key === 'fields') {
          const fieldSelect = args.select.fields.select
          selected.fields = form.fields.map((field) => fieldSelect
            ? Object.fromEntries(Object.keys(fieldSelect).map((fieldKey) => [fieldKey, field[fieldKey as keyof FormFieldRecord]]))
            : field)
        } else {
          selected[key] = form[key as keyof FormRecord]
        }
      }
      return selected
    }

    if (args.include?.fields) return { ...form, fields: [...form.fields] }
    return form
  })

  testState.prisma.submission.create.mockImplementation(async ({ data, select }) => {
    const submission: SubmissionRecord = {
      id: `90000000-0000-4000-8000-${String(testState.nextSubmissionId++).padStart(12, '0')}`,
      formId: data.formId,
      formSchemaVersion: data.formSchemaVersion,
      formVersionSnapshot: data.formVersionSnapshot,
      submittedAt: new Date('2026-02-02T03:04:05.000Z'),
      answers: (data.answers?.create ?? []).map((answer: Omit<AnswerRecord, 'id'>, index: number) => ({
        id: `a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ...answer,
      })),
    }
    testState.submissions.set(submission.id, submission)
    return Object.fromEntries(Object.keys(select).map((key) => [key, submission[key as keyof SubmissionRecord]]))
  })

  testState.prisma.submission.findMany.mockImplementation(async ({ where, orderBy, select, include }) => {
    const submissions = [...testState.submissions.values()]
      .filter((submission) => submission.formId === where.formId)
      .sort((a, b) => orderBy?.submittedAt === 'asc'
        ? a.submittedAt.getTime() - b.submittedAt.getTime()
        : b.submittedAt.getTime() - a.submittedAt.getTime())

    if (include?.answers) return submissions
    return submissions.map((submission) => ({
      id: submission.id,
      submittedAt: submission.submittedAt,
      ...(select?._count ? { _count: { answers: submission.answers.length } } : {}),
    }))
  })

  testState.prisma.submission.findFirst.mockImplementation(async ({ where, include }) => {
    const submission = testState.submissions.get(String(where.id))
    const form = testState.forms.get(String(where.formId))
    if (
      !submission || submission.formId !== where.formId || !form ||
      form.ownerId !== where.form.ownerId
    ) {
      return null
    }
    return {
      ...submission,
      answers: include?.answers?.select
        ? submission.answers.map((answer) => Object.fromEntries(
            Object.keys(include.answers.select).map((key) => [key, answer[key as keyof AnswerRecord]]),
          ))
        : submission.answers,
    }
  })
})

function makeField(id: string, formId: string, label: string, type: FormFieldRecord['type'], required: boolean, position: number): FormFieldRecord {
  return { id, formId, label, type, required, position, options: null, validation: null }
}

function seedForm(ownerId: string, status: FormRecord['status'] = 'PUBLISHED', id = validFormId) {
  const form: FormRecord = {
    id,
    ownerId,
    title: 'Customer feedback',
    description: 'Tell us what you think',
    status,
    publicId: id === validFormId ? publicId : 'd'.repeat(32),
    schemaVersion: 3,
    fields: [
      makeField(emailFieldId, id, 'Email address', 'EMAIL', true, 1),
      makeField(messageFieldId, id, 'Message', 'SHORT_TEXT', false, 2),
    ],
  }
  testState.forms.set(id, form)
  return form
}

function seedSubmission(formId: string, overrides: Partial<SubmissionRecord> = {}) {
  const submission: SubmissionRecord = {
    id: 'a1000000-0000-4000-8000-000000000001',
    formId,
    formSchemaVersion: 3,
    formVersionSnapshot: {
      title: 'Customer feedback',
      fields: [
        { id: emailFieldId, label: 'Email address', type: 'EMAIL', position: 1 },
        { id: messageFieldId, label: 'Message', type: 'SHORT_TEXT', position: 2 },
      ],
    },
    submittedAt: new Date('2026-02-02T03:04:05.000Z'),
    answers: [
      { id: 'a2000000-0000-4000-8000-000000000001', fieldId: emailFieldId, fieldLabel: 'Email address', fieldType: 'EMAIL', value: 'person@example.test' },
      { id: 'a2000000-0000-4000-8000-000000000002', fieldId: messageFieldId, fieldLabel: 'Message', fieldType: 'SHORT_TEXT', value: 'Thanks for the product' },
    ],
    ...overrides,
  }
  testState.submissions.set(submission.id, submission)
  return submission
}

async function authenticatedAgent(email: string) {
  const agent = request.agent(app)
  const response = await agent.post('/api/auth/register').send({
    name: 'Submission Test User',
    email,
    password,
  })
  expect(response.status).toBe(201)
  return { agent, user: response.body.user as { id: string } }
}

describe('Public submissions', () => {
  it('accepts a valid submission for a published form and associates it with that form', async () => {
    seedForm('owner-id')

    const response = await request(app)
      .post(`/api/forms/public/${publicId}/submissions`)
      .send({
        answers: {
          [emailFieldId]: 'respondent@example.test',
          [messageFieldId]: 'Helpful service',
        },
      })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      status: 'ok',
      message: 'Response submitted successfully.',
      submission: { id: expect.any(String), submittedAt: expect.any(String) },
    })
    const stored = testState.submissions.get(response.body.submission.id)
    expect(stored?.formId).toBe(validFormId)
    expect(stored?.answers).toMatchObject([
      { fieldId: emailFieldId, fieldLabel: 'Email address', value: 'respondent@example.test' },
      { fieldId: messageFieldId, fieldLabel: 'Message', value: 'Helpful service' },
    ])
  })

  it('rejects invalid answer data and missing required answers', async () => {
    seedForm('owner-id')

    const invalidValue = await request(app)
      .post(`/api/forms/public/${publicId}/submissions`)
      .send({ answers: { [emailFieldId]: 'not-an-email' } })
    const missingRequired = await request(app)
      .post(`/api/forms/public/${publicId}/submissions`)
      .send({ answers: { [messageFieldId]: 'No email provided' } })

    expect(invalidValue.status).toBe(400)
    expect(invalidValue.body.message).toBe('"Email address" must be a valid email address.')
    expect(missingRequired.status).toBe(400)
    expect(missingRequired.body.message).toBe('"Email address" is required.')
    expect(testState.submissions.size).toBe(0)
  })

  it('rejects draft forms and unknown public form IDs', async () => {
    const draftPublicId = 'e'.repeat(32)
    seedForm('owner-id', 'DRAFT', secondFormId).publicId = draftPublicId

    const draft = await request(app)
      .post(`/api/forms/public/${draftPublicId}/submissions`)
      .send({ answers: { [emailFieldId]: 'respondent@example.test' } })
    const unknown = await request(app)
      .post(`/api/forms/public/${'f'.repeat(32)}/submissions`)
      .send({ answers: { [emailFieldId]: 'respondent@example.test' } })

    expect(draft.status).toBe(404)
    expect(draft.body.message).toBe('Published form not found.')
    expect(unknown.status).toBe(404)
    expect(unknown.body.message).toBe('Published form not found.')
    expect(testState.submissions.size).toBe(0)
  })

  it('handles malformed payloads and unknown field IDs safely', async () => {
    seedForm('owner-id')

    const nonObject = await request(app)
      .post(`/api/forms/public/${publicId}/submissions`)
      .send({ answers: ['respondent@example.test'] })
    const unknownField = await request(app)
      .post(`/api/forms/public/${publicId}/submissions`)
      .send({ answers: { '70000000-0000-4000-8000-000000000099': 'unexpected' } })
    const invalidPublicId = await request(app)
      .post('/api/forms/public/not-a-public-id/submissions')
      .send({ answers: {} })

    expect(nonObject.status).toBe(400)
    expect(nonObject.body.message).toBe('Answers must be an object keyed by field ID.')
    expect(unknownField.status).toBe(400)
    expect(unknownField.body.message).toBe('An answer references an invalid question.')
    expect(invalidPublicId.status).toBe(400)
    expect(invalidPublicId.body.message).toBe('Invalid public form link.')
    expect(testState.submissions.size).toBe(0)
  })
})

describe('Private submission management and CSV export', () => {
  it('allows an owner to list and retrieve their submissions', async () => {
    const { agent, user } = await authenticatedAgent('submission-owner@example.test')
    seedForm(user.id)
    const submission = seedSubmission(validFormId)

    const list = await agent.get(`/api/forms/${validFormId}/submissions`)
    const detail = await agent.get(`/api/forms/${validFormId}/submissions/${submission.id}`)

    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({
      status: 'ok',
      form: { id: validFormId, title: 'Customer feedback' },
      count: 1,
      submissions: [{ id: submission.id, _count: { answers: 2 } }],
    })
    expect(detail.status).toBe(200)
    expect(detail.body.submission).toMatchObject({
      id: submission.id,
      formId: validFormId,
      answers: [
        { fieldLabel: 'Email address', value: 'person@example.test' },
        { fieldLabel: 'Message', value: 'Thanks for the product' },
      ],
    })
  })

  it('rejects unauthenticated access to private submission endpoints', async () => {
    const submissionId = 'a1000000-0000-4000-8000-000000000001'
    const responses = await Promise.all([
      request(app).get(`/api/forms/${validFormId}/submissions`),
      request(app).get(`/api/forms/${validFormId}/submissions/export`),
      request(app).get(`/api/forms/${validFormId}/submissions/${submissionId}`),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401])
    expect(responses.every((response) => response.body.message === 'Authentication required'))
      .toBe(true)
  })

  it('prevents one user from reading or exporting another user’s submissions', async () => {
    const owner = await authenticatedAgent('submission-owner-b@example.test')
    const otherUser = await authenticatedAgent('submission-owner-a@example.test')
    seedForm(owner.user.id)
    const submission = seedSubmission(validFormId)

    const list = await otherUser.agent.get(`/api/forms/${validFormId}/submissions`)
    const detail = await otherUser.agent.get(`/api/forms/${validFormId}/submissions/${submission.id}`)
    const exportResponse = await otherUser.agent.get(`/api/forms/${validFormId}/submissions/export`)

    expect([list.status, detail.status, exportResponse.status]).toEqual([404, 404, 404])
    expect(testState.submissions.has(submission.id)).toBe(true)
  })

  it('handles unknown and malformed form or submission IDs', async () => {
    const { agent, user } = await authenticatedAgent('unknown-submission@example.test')
    seedForm(user.id)

    const unknownForm = await agent.get('/api/forms/60000000-0000-4000-8000-000000000099/submissions')
    const invalidForm = await agent.get('/api/forms/not-a-uuid/submissions')
    const unknownSubmission = await agent.get(
      `/api/forms/${validFormId}/submissions/a1000000-0000-4000-8000-000000000099`,
    )
    const invalidSubmission = await agent.get(`/api/forms/${validFormId}/submissions/not-a-uuid`)

    expect(unknownForm.status).toBe(404)
    expect(unknownForm.body.message).toBe('Form not found.')
    expect(invalidForm.status).toBe(400)
    expect(invalidSubmission.status).toBe(400)
    expect(invalidSubmission.body.message).toBe('Invalid form or submission ID.')
    expect(unknownSubmission.status).toBe(404)
    expect(unknownSubmission.body.message).toBe('Submission not found.')
  })

  it('exports owner submissions as CSV and escapes spreadsheet formulas', async () => {
    const { agent, user } = await authenticatedAgent('csv-owner@example.test')
    seedForm(user.id)
    const submission = seedSubmission(validFormId, {
      answers: [
        { id: 'a2000000-0000-4000-8000-000000000001', fieldId: emailFieldId, fieldLabel: 'Email address', fieldType: 'EMAIL', value: 'person@example.test' },
        { id: 'a2000000-0000-4000-8000-000000000002', fieldId: messageFieldId, fieldLabel: 'Message', fieldType: 'SHORT_TEXT', value: 'Thanks for the product' },
        { id: 'a2000000-0000-4000-8000-000000000003', fieldId: '70000000-0000-4000-8000-000000000003', fieldLabel: 'Formula probe', fieldType: 'SHORT_TEXT', value: '\n=1+1' },
      ],
      formVersionSnapshot: {
        fields: [
          { label: 'Email address', position: 1 },
          { label: 'Message', position: 2 },
          { label: 'Formula probe', position: 3 },
        ],
      },
    })

    const response = await agent.get(`/api/forms/${validFormId}/submissions/export`)
    const csv = response.text

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/i)
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="formpilot-responses-${validFormId}.csv"`,
    )
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Submission ID","Submitted At","Email address","Message","Formula probe"')
    expect(csv).toContain(`"${submission.id}","2026-02-02T03:04:05.000Z","person@example.test","Thanks for the product","'\n=1+1"`)
  })
})
