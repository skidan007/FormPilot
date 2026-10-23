
import { describe, expect, it } from 'vitest'
import request from 'supertest'

// The health endpoint does not use the database. Supply local placeholder
// settings so importing the app does not depend on a developer's .env file.
process.env.PGHOST ??= '127.0.0.1'
process.env.PGPORT ??= '5432'
process.env.PGDATABASE ??= 'formpilot_test'
process.env.PGUSER ??= 'formpilot_test'
process.env.PGPASSWORD ??= 'formpilot_test'
process.env.SESSION_SECRET ??= 'formpilot-test-session-secret'

const { default: app } = await import('../src/app.js')

describe('FormPilot API health check', () => {
  it('returns the expected status and message', async () => {
    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'ok',
      message: 'FormPilot API is running',
    })
  })
})
