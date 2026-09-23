"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { auth, signIn } from "@/auth";
import { INVITE_COOKIE } from "@/lib/oauth";

const schema = z.object({
  displayName: z.string().min(1).max(40),
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/i, "letters, numbers, underscore only"),
  email: z.string().min(3).max(120),
  password: z.string().min(6).max(100),
  invite: z.string().optional(),
});

export async function registerUser(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const parsed = schema.safeParse({
    displayName: formData.get("displayName"),
    username: String(formData.get("username") || "").toLowerCase().trim(),
    email: String(formData.get("email") || "").toLowerCase().trim(),
    password: formData.get("password"),
    invite: formData.get("invite") || undefined,
  });
  if (!parsed.success) return "Check your details — username is 3–20 letters/numbers, password 6+ characters.";
  const { displayName, username, email, password, invite } = parsed.data;

  // Invite gating: unless open sign-up is enabled, a valid unused invite is required.
  const openSignup = process.env.ALLOW_OPEN_SIGNUP === "true";
  const inviteRow = invite ? await prisma.invite.findUnique({ where: { code: invite } }) : null;
  const validInvite = inviteRow && !inviteRow.usedById ? inviteRow : null;
  if (!openSignup && !validInvite) return "Sign-up is invite-only — ask a friend for an invite link.";

  if (await prisma.user.findUnique({ where: { email } })) return "That email is already registered.";
  if (await prisma.user.findUnique({ where: { username } })) return "That username is taken.";

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { displayName, username, email, passwordHash } });

  // Redeem the invite → become friends with the inviter automatically.
  if (validInvite && validInvite.createdById !== user.id) {
    const [a, b] = [user.id, validInvite.createdById].sort();
    await prisma.$transaction([
      prisma.friendship.upsert({ where: { userAId_userBId: { userAId: a, userBId: b } }, update: {}, create: { userAId: a, userBId: b } }),
      prisma.invite.update({ where: { id: validInvite.id }, data: { usedById: user.id } }),
      prisma.notification.create({ data: { userId: validInvite.createdById, type: "FRIEND_JOINED", body: `${displayName} joined from your invite`, href: `/u/${username}` } }),
    ]);
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) return "Account created — please sign in.";
    throw e; // re-throw the success redirect
  }
  return undefined;
}

/** Logged-in user mints a single-use invite code → /signup?invite=<code>. */
export async function createInvite(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  await prisma.invite.create({ data: { code, createdById: session.user.id } });
  return code;
}

/** Start Google sign-in. An invite code (from /signup?invite=…) is parked in a short-lived
 *  cookie so the signIn callback can redeem it once Google sends the person back. */
export async function googleSignIn(formData: FormData): Promise<void> {
  const invite = String(formData.get("invite") || "").trim();
  const jar = await cookies();
  if (invite) {
    jar.set(INVITE_COOKIE, invite, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  } else {
    jar.delete(INVITE_COOKIE);
  }
  await signIn("google", { redirectTo: "/" });
}
