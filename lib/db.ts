import { createClient } from "@libsql/client"

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export async function isEmailWhitelisted(email: string): Promise<boolean> {
  const result = await db.execute({
    sql: "SELECT 1 FROM whitelist WHERE email = ? LIMIT 1",
    args: [email],
  })
  return result.rows.length > 0
}

export default db
