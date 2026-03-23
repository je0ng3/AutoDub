import { redirect } from "next/navigation"
import { signOut } from "@/auth"
import { requestAccess } from "@/lib/db"

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; status?: string }>
}) {
  const params = await searchParams
  const email = params.email
  const status = params.status

  async function handleRequestAccess() {
    "use server"
    if (email) {
      await requestAccess(email)
      redirect(`/unauthorized?email=${encodeURIComponent(email)}&status=requested`)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 p-10 rounded-2xl border border-black/[.08] dark:border-white/[.145] max-w-sm text-center">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-xl font-semibold">접근 권한 없음</h1>
          <p className="text-sm text-foreground/60 leading-relaxed">
            이 서비스는 허용된 사용자만 이용할 수 있습니다.
            <br />
            접근 권한이 필요하다면 관리자에게 문의하거나 아래에서 요청하세요.
          </p>
        </div>

        {email && (
          <div className="flex flex-col items-center gap-2 w-full">
            {status === "requested" ? (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                접근 요청이 완료되었습니다. 관리자 승인 후 이용 가능합니다.
              </p>
            ) : (
              <form action={handleRequestAccess} className="w-full">
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full border border-black/[.12] dark:border-white/[.2] bg-background hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] transition-colors text-sm font-medium cursor-pointer"
                >
                  접근 요청하기
                </button>
              </form>
            )}
          </div>
        )}

        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/login" })
          }}
        >
          <button
            type="submit"
            className="px-5 py-2 rounded-full border border-black/[.12] dark:border-white/[.2] bg-background hover:bg-[#f2f2f2] dark:hover:bg-[#1a1a1a] transition-colors text-sm font-medium cursor-pointer"
          >
            다른 계정으로 로그인
          </button>
        </form>
      </div>
    </main>
  )
}
