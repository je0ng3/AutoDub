import { createClient } from "@libsql/client"

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

let initialized = false

async function ensureInit() {
  if (initialized) return
  initialized = true
  await db.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS access_requests (
        email TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      args: [],
    },
  ])
}

export async function isEmailWhitelisted(email: string): Promise<boolean> {
  await ensureInit()
  const result = await db.execute({
    sql: "SELECT 1 FROM whitelist WHERE email = ? LIMIT 1",
    args: [email],
  })
  return result.rows.length > 0
}

export async function isEmailUser(email: string): Promise<boolean> {
  await ensureInit()
  const result = await db.execute({
    sql: "SELECT 1 FROM users WHERE email = ? LIMIT 1",
    args: [email],
  })
  return result.rows.length > 0
}

export async function canAccess(email: string): Promise<boolean> {
  const [whitelisted, user] = await Promise.all([
    isEmailWhitelisted(email),
    isEmailUser(email),
  ])
  return whitelisted || user
}

export async function requestAccess(email: string): Promise<void> {
  await ensureInit()
  await db.execute({
    sql: "INSERT OR IGNORE INTO access_requests (email) VALUES (?)",
    args: [email],
  })
}

export async function getAccessRequests(): Promise<
  Array<{ email: string; created_at: string }>
> {
  await ensureInit()
  const result = await db.execute(
    "SELECT email, created_at FROM access_requests ORDER BY created_at DESC"
  )
  return result.rows.map((row) => ({
    email: row.email as string,
    created_at: row.created_at as string,
  }))
}

export async function getUsers(): Promise<
  Array<{ email: string; created_at: string }>
> {
  await ensureInit()
  const result = await db.execute(
    "SELECT email, created_at FROM users ORDER BY created_at DESC"
  )
  return result.rows.map((row) => ({
    email: row.email as string,
    created_at: row.created_at as string,
  }))
}

export async function addUser(email: string): Promise<void> {
  await ensureInit()
  await db.batch([
    { sql: "INSERT OR IGNORE INTO users (email) VALUES (?)", args: [email] },
    { sql: "DELETE FROM access_requests WHERE email = ?", args: [email] },
  ])
}

export async function getAdmins(): Promise<Array<{ email: string }>> {
  await ensureInit()
  const result = await db.execute("SELECT email FROM whitelist ORDER BY email ASC")
  return result.rows.map((row) => ({ email: row.email as string }))
}

export async function removeUser(email: string): Promise<void> {
  await ensureInit()
  await db.execute({
    sql: "DELETE FROM users WHERE email = ?",
    args: [email],
  })
}

export default db
