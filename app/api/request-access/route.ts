import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { requestAccess } from "@/lib/db"

export async function POST() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await requestAccess(session.user.email)
  return NextResponse.json({ ok: true })
}
