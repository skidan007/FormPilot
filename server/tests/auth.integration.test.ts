import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import request from 'supertest'

type DatabaseTarget = Pick<NodeJS.ProcessEnv, 'PGDATABASE' | 'PGUSER'>

function assertTestDatabaseTarget(target: DatabaseTarget): void {
  if (
    target.PGDATABASE !== 'formpilot_test' ||
    target.PGUSER !== 'formpilot_test_role'
  ) {
    throw new Error(
      'Authentication integration tests require PGDATABASE=formpilot_test and PGUSER=formpilot_test_role.',
    )
  }
}

// Fail during module setup, before importing the app or creating any database
// clients, if the configured target is not the isolated test database/role.
assertTestDatabaseTarget(process.env)

for (const name of ['PGHOST', 'PGPASSWORD', 'SESSION_SECRET'] as const) {
  if (!process.env[name]) {
    throw new Error(`Authentication integration tests require ${name} to be set.`)
  }
}

const { default: app } = await import('../src/app.ts')
const { prisma } = await import('../src/lib/prisma.ts')

const databasePool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  connectionTimeoutMillis: 5_000,
})

const email = `formpilot.integration.${randomUUID()}@example.com`
const password = 'integration-test-password-42'
const agent = request.agent(app)
const loginAgent = request.agent(app)
let userId: string | undefined
let databaseIdentityVerified = false

async function persistedSessionCount(id: string): Promise<number> {
  const result = await databasePool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM public.user_sessions
     WHERE sess->>'userId' = $1`,
    [id],
  )

  return Number(result.rows[0].count)
}

describe('real PostgreSQL authentication integration', () => {
  beforeAll(async () => {
    const identity = await databasePool.query<{
      database: string
      role: string
    }>('SELECT current_database() AS database, current_user AS role')

    if (
      identity.rows[0]?.database !== 'formpilot_test' ||
      identity.rows[0]?.role !== 'formpilot_test_role'
    ) {
      throw new Error(
        'PostgreSQL identity check failed; refusing to run integration tests.',
      )
    }
    databaseIdentityVerified = true

    const schema = await databasePool.query<{
      userTable: boolean
      formTable: boolean
      fieldTable: boolean
      submissionTable: boolean
      answerTable: boolean
      migrationsTable: boolean
    }>(`SELECT
      to_regclass('public."User"') IS NOT NULL AS "userTable",
      to_regclass('public."Form"') IS NOT NULL AS "formTable",
      to_regclass('public."FormField"') IS NOT NULL AS "fieldTable",
      to_regclass('public."Submission"') IS NOT NULL AS "submissionTable",
      to_regclass('public."SubmissionAnswer"') IS NOT NULL AS "answerTable",
      to_regclass('public."_prisma_migrations"') IS NOT NULL AS "migrationsTable"`)

    if (!schema.rows[0] || !Object.values(schema.rows[0]).every(Boolean)) {
      throw new Error(
        'Expected migrated FormPilot schema is missing from formpilot_test.',
      )
    }

    const migration = await databasePool.query<{ applied: boolean }>(
      `SELECT finished_at IS NOT NULL AND rolled_back_at IS NULL AS applied
       FROM public."_prisma_migrations"
       WHERE migration_name = $1`,
      ['20261020105047_init'],
    )

    if (!migration.rows[0]?.applied) {
      throw new Error(
        'Expected FormPilot migration is not applied to formpilot_test.',
      )
    }
  }, 15_000)

  it('rejects database names and roles outside the dedicated test target', () => {
    expect(() =>
      assertTestDatabaseTarget({
        PGDATABASE: 'formpilot',
        PGUSER: 'formpilot_test_role',
      }),
    ).toThrow(/require PGDATABASE=formpilot_test/)

    expect(() =>
      assertTestDatabaseTarget({
        PGDATABASE: 'formpilot_test',
        PGUSER: 'another_role',
      }),
    ).toThrow(/require PGDATABASE=formpilot_test/)
  })

  it('rejects unauthenticated requests to the current-user endpoint', async () => {
    const response = await request(app).get('/api/auth/me')

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      status: 'error',
      message: 'Authentication required',
    })
  }, 15_000)

  it('registers a user, stores a bcrypt hash, and persists the session', async () => {
    const response = await agent.post('/api/auth/register').send({
      name: 'Integration Test User',
      email,
      password,
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      status: 'ok',
      user: { email, name: 'Integration Test User' },
    })
    expect(response.body.user).not.toHaveProperty('passwordHash')

    userId = response.body.user.id as string
    expect(userId).toBeTruthy()

    const storedUser = await prisma.user.findUnique({
      where: { id: userId },
    })
    expect(storedUser).not.toBeNull()
    expect(storedUser?.passwordHash).not.toBe(password)
    expect(await bcrypt.compare(password, storedUser!.passwordHash)).toBe(true)

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user).toMatchObject({ id: userId, email })

    const sessionTable = await databasePool.query<{ present: boolean }>(
      `SELECT to_regclass('public.user_sessions') IS NOT NULL AS present`,
    )
    expect(sessionTable.rows[0].present).toBe(true)
    expect(await persistedSessionCount(userId!)).toBeGreaterThan(0)
  }, 20_000)

  it('authenticates valid credentials, rejects invalid credentials, and invalidates logout', async () => {
    const invalid = await request(app).post('/api/auth/login').send({
      email,
      password: `${password}-wrong`,
    })
    expect(invalid.status).toBe(401)

    const login = await loginAgent.post('/api/auth/login').send({
      email,
      password,
    })
    expect(login.status).toBe(200)
    expect(login.body).toMatchObject({ status: 'ok', user: { email } })
    expect(login.body.user).not.toHaveProperty('passwordHash')

    const me = await loginAgent.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user).toMatchObject({ id: userId, email })
    const sessionsBeforeLogout = await persistedSessionCount(userId!)
    expect(sessionsBeforeLogout).toBeGreaterThan(0)

    const logout = await loginAgent.post('/api/auth/logout')
    expect(logout.status).toBe(200)
    expect(logout.body).toMatchObject({ status: 'ok' })

    const afterLogout = await loginAgent.get('/api/auth/me')
    expect(afterLogout.status).toBe(401)
    expect(await persistedSessionCount(userId!)).toBe(sessionsBeforeLogout - 1)
  }, 20_000)
})

afterAll(async () => {
  try {
    if (databaseIdentityVerified) {
      const createdUsers = await prisma.user.findMany({
        where: { email },
        select: { id: true },
      })
      const ids = createdUsers.map((user) => user.id)

      if (ids.length > 0) {
        const sessionTable = await databasePool.query<{ present: boolean }>(
          `SELECT to_regclass('public.user_sessions') IS NOT NULL AS present`,
        )

        if (sessionTable.rows[0]?.present) {
          await databasePool.query(
            `DELETE FROM public.user_sessions WHERE sess->>'userId' = ANY($1::text[])`,
            [ids],
          )
        }

        await prisma.user.deleteMany({ where: { id: { in: ids } } })
      }

      if (await prisma.user.count({ where: { email } }) !== 0) {
        throw new Error('Test account cleanup did not complete.')
      }
    }
  } finally {
    await Promise.all([prisma.$disconnect(), databasePool.end()])
  }
}, 15_000)
