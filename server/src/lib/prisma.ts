
import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

function requiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

const pool = new Pool({
  host: requiredEnv('PGHOST'),
  port: Number(process.env.PGPORT ?? 5432),
  database: requiredEnv('PGDATABASE'),
  user: requiredEnv('PGUSER'),
  password: requiredEnv('PGPASSWORD'),
})

const adapter = new PrismaPg(pool)

export const prisma = new PrismaClient({ adapter })
