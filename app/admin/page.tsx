import { redirect } from "next/navigation"
import { auth, signOut } from "@/auth"
import {
  isEmailWhitelisted,
  getAccessRequests,
  getUsers,
  getAdmins,
  addUser,
  removeUser,
} from "@/lib/db"

export default async function AdminPage() {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")

  const isAdmin = await isEmailWhitelisted(session.user.email)
  if (!isAdmin) redirect("/unauthorized")

  const [requests, users, admins] = await Promise.all([getAccessRequests(), getUsers(), getAdmins()])

  async function handleAddUser(formData: FormData) {
    "use server"
    const email = formData.get("email") as string
    if (email) await addUser(email)
    redirect("/admin")
  }

  async function handleRemoveUser(formData: FormData) {
    "use server"
    const email = formData.get("email") as string
    if (email) await removeUser(email)
    redirect("/admin")
  }

  async function handleSignOut() {
    "use server"
    await signOut({ redirectTo: "/login" })
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-black/[.08] dark:border-white/[.08] px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <a href="/" className="text-sm font-semibold tracking-tight">AOTO DUB</a>
          <form action={handleSignOut}>
            <button type="submit" className="text-xs text-foreground/40 hover:text-foreground/60 transition-colors cursor-pointer">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main className="p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-10">
        <h1 className="text-2xl font-semibold">관리자 페이지</h1>

        {/* Access Requests */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">접근 요청 목록</h2>
          {requests.length === 0 ? (
            <p className="text-sm text-foreground/50">접근 요청이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {requests.map((req) => (
                <li
                  key={req.email}
                  className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-black/[.08] dark:border-white/[.145]"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{req.email}</span>
                    <span className="text-xs text-foreground/50">{req.created_at}</span>
                  </div>
                  <form action={handleAddUser}>
                    <input type="hidden" name="email" value={req.email} />
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-full bg-foreground text-background text-xs font-medium hover:opacity-80 transition-opacity cursor-pointer"
                    >
                      승인
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Admins */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">관리자 목록</h2>
          {admins.length === 0 ? (
            <p className="text-sm text-foreground/50">등록된 관리자가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {admins.map((admin) => (
                <li
                  key={admin.email}
                  className="flex items-center px-4 py-3 rounded-xl border border-black/[.08] dark:border-white/[.145]"
                >
                  <span className="text-sm font-medium">{admin.email}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Current Users */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">일반 사용자 목록</h2>
          {users.length === 0 ? (
            <p className="text-sm text-foreground/50">등록된 사용자가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {users.map((user) => (
                <li
                  key={user.email}
                  className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-black/[.08] dark:border-white/[.145]"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{user.email}</span>
                    <span className="text-xs text-foreground/50">{user.created_at}</span>
                  </div>
                  <form action={handleRemoveUser}>
                    <input type="hidden" name="email" value={user.email} />
                    <button
                      type="submit"
                      className="px-4 py-1.5 rounded-full border border-black/[.12] dark:border-white/[.2] text-xs font-medium hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] transition-colors cursor-pointer"
                    >
                      삭제
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {/* Manual add */}
          <form action={handleAddUser} className="flex gap-2 mt-2">
            <input
              type="email"
              name="email"
              placeholder="이메일 직접 추가"
              className="flex-1 px-4 py-2 rounded-full border border-black/[.12] dark:border-white/[.2] bg-background text-sm outline-none focus:border-foreground/40 transition-colors"
            />
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-80 transition-opacity cursor-pointer"
            >
              추가
            </button>
          </form>
        </section>
      </div>
      </main>
    </div>
  )
}
