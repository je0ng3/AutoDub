import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { isEmailWhitelisted } from "@/lib/db"

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  providers: [Google],
  pages: {
    signIn: "/login",
    error: "/unauthorized",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      const allowed = await isEmailWhitelisted(user.email)
      return allowed ? true : "/unauthorized"
    },
  },
})
