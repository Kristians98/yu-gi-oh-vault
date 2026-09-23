import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { INVITE_COOKIE, resolveGoogleUser } from "@/lib/oauth";

const loginSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});

/** Google SSO is optional: it only appears when both env vars are configured. */
export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const parsed = loginSchema.safeParse(creds);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        if (!user || !user.passwordHash) return null; // Google-only accounts have no password
        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          name: user.displayName,
          email: user.email,
          image: user.avatarUrl,
          username: user.username,
        };
      },
    }),
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            // Always let the person pick an account; no silent re-login into the wrong one.
            authorization: { params: { prompt: "select_account" } },
          }),
        ]
      : []),
  ],
  callbacks: {
    // Google: map the Google identity onto a local user (or create one if sign-up allows).
    // Returning a URL sends the person there instead of signing them in.
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email = profile?.email;
      if (!email || profile?.email_verified === false) return "/login?error=google";
      const jar = await cookies();
      const invite = jar.get(INVITE_COOKIE)?.value || null;
      const result = await resolveGoogleUser(
        { email, name: profile?.name, picture: typeof profile?.picture === "string" ? profile.picture : null },
        invite,
      );
      if (invite) jar.delete(INVITE_COOKIE);
      if (!result.ok) return "/signup?error=invite-only";
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && token.email) {
        // `user.id` here is Google's subject, not ours — look the local row up by email.
        const local = await prisma.user.findUnique({ where: { email: token.email.toLowerCase() }, select: { id: true, username: true } });
        if (local) {
          token.id = local.id;
          token.username = local.username;
        }
      } else if (user) {
        token.id = user.id as string;
        token.username = (user as { username?: string }).username;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.username = (token.username as string) ?? "";
      }
      return session;
    },
  },
});
