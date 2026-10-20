
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

function requiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

const databaseUrl = new URL('postgresql://localhost:5432/formpilot')

databaseUrl.hostname = requiredEnv('PGHOST')
databaseUrl.port = process.env.PGPORT ?? '5432'
databaseUrl.username = requiredEnv('PGUSER')
databaseUrl.password = requiredEnv('PGPASSWORD')
databaseUrl.pathname = `/${requiredEnv('PGDATABASE')}`

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl.toString(),
  },
})
