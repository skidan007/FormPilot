import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'

type TestUser = {
  id: string
  email: string
  name: string | null
  passwordHash: string
  createdAt: Date
}

const testState = vi.hoisted(() => ({
  users: new Map<string, TestUser>(),
  nextId: 1,
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    form: { count: vi.fn() },
  },
}))

vi.mock('../src/lib/prisma.ts', () => ({ prisma: testState.prisma }))

vi.mock('../src/lib/session.ts', async () => {
  const sessionModule = await import('express-session')

  return {
    sessionMiddleware: sessionModule.default({
      store: new sessionModule.MemoryStore(),
      name: 'formpilot.sid',
      secret: 'isolated-auth-test-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax' },
    }),
  }
})

// App construction reads these settings, but mocked auth persistence never
// connects to PostgreSQL or the configured application database.
process.env.PGHOST ??= '127.0.0.1'
process.env.PGPORT ??= '5432'
process.env.PGDATABASE ??= 'formpilot_auth_test'
process.env.PGUSER ??= 'formpilot_auth_test'
process.env.PGPASSWORD ??= 'formpilot_auth_test'
process.env.SESSION_SECRET ??= 'isolated-auth-test-session-secret'

const { default: app } = await import('../src/app.js')

function selectedUser(user: TestUser, select?: Record<string, boolean>) {
  if (!select) return user

  return Object.fromEntries(
    Object.entries(select)
      .filter(([, enabled]) => enabled)
      .map(([key]) => [key, user[key as keyof TestUser]]),
  )
}

beforeEach(() => {
  testState.users.clear()
  testState.nextId = 1
  testState.prisma.user.findUnique.mockReset()
  testState.prisma.user.create.mockReset()
  testState.prisma.user.count.mockReset().mockResolvedValue(0)
  testState.prisma.form.count.mockReset().mockResolvedValue(0)

  testState.prisma.user.findUnique.mockImplementation(async ({ where, select }) => {
    const user = where.email
      ? testState.users.get(String(where.email))
      : [...testState.users.values()].find((candidate) => candidate.id === where.id)

    return user ? selectedUser(user, select) : null
  })

  testState.prisma.user.create.mockImplementation(async ({ data, select }) => {
    const id = `00000000-0000-4000-8000-${String(testState.nextId++).padStart(12, '0')}`
    const user: TestUser = {
      id,
      email: data.email,
      name: data.name ?? null,
      passwordHash: data.passwordHash,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    testState.users.set(user.email, user)
    return selectedUser(user, select)
  })
})

const validRegistration = {
  name: 'Test User',
  email: 'auth-test@example.test',
  password: 'correct-horse-battery-staple',
}

describe('FormPilot authentication', () => {
  it('registers a user with valid data', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send(validRegistration)

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      status: 'ok',
      message: 'Account created successfully',
      user: {
        name: validRegistration.name,
        email: validRegistration.email,
      },
    })
    expect(response.body.user.passwordHash).toBeUndefined()
    expect(testState.users.size).toBe(1)
  })

  it('rejects registration with a duplicate email', async () => {
    const agent = request.agent(app)

    const first = await agent.post('/api/auth/register').send(validRegistration)
    const duplicate = await agent.post('/api/auth/register').send(validRegistration)

    expect(first.status).toBe(201)
    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toEqual({
      status: 'error',
      message: 'An account with this email already exists',
    })
    expect(testState.users.size).toBe(1)
  })

  it('logs in with valid credentials', async () => {
    const passwordHash = await bcrypt.hash(validRegistration.password, 4)
    testState.users.set(validRegistration.email, {
      id: '00000000-0000-4000-8000-000000000010',
      email: validRegistration.email,
      name: validRegistration.name,
      passwordHash,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .send({ email: validRegistration.email, password: validRegistration.password })
    const currentUser = await agent.get('/api/auth/me')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'ok', message: 'Login successful' })
    expect(currentUser.status).toBe(200)
    expect(currentUser.body.user.email).toBe(validRegistration.email)
  })

  it('rejects login with invalid credentials', async () => {
    const agent = request.agent(app)
    const response = await agent
      .post('/api/auth/login')
      .send({ email: validRegistration.email, password: validRegistration.password })

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      status: 'error',
      message: 'Invalid email or password',
    })
  })

  it('rejects unauthenticated access to the current-user endpoint', async () => {
    const response = await request(app).get('/api/auth/me')

    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      status: 'error',
      message: 'Authentication required',
    })
  })

  it('logs out and invalidates the authenticated session', async () => {
    const agent = request.agent(app)
    const registered = await agent.post('/api/auth/register').send(validRegistration)
    const beforeLogout = await agent.get('/api/auth/me')
    const logout = await agent.post('/api/auth/logout')
    const afterLogout = await agent.get('/api/auth/me')

    expect(registered.status).toBe(201)
    expect(beforeLogout.status).toBe(200)
    expect(logout.status).toBe(200)
    expect(logout.body).toEqual({ status: 'ok', message: 'Logout successful' })
    expect(afterLogout.status).toBe(401)
    expect(afterLogout.body).toEqual({
      status: 'error',
      message: 'Authentication required',
    })
  })
})
