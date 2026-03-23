import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { canAccess, isEmailWhitelisted } from "@/lib/db"

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
      const allowed = await canAccess(user.email)
      return allowed ? true : `/unauthorized?email=${encodeURIComponent(user.email)}`
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.isAdmin = await isEmailWhitelisted(user.email)
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.isAdmin = token.isAdmin as boolean | undefined
      }
      return session
    },
  },
})
