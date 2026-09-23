// Google sign-in → local User row. Plain module (no "use server") so auth.ts can call it
// from its callbacks. Google-created accounts have no password: passwordHash is "" and the
// credentials provider refuses to log them in that way.
import { prisma } from "@/lib/prisma";

export const INVITE_COOKIE = "vault_invite";

export type GoogleProfile = { email: string; name?: string | null; picture?: string | null };

/** letters/numbers/underscore, 3–20 chars, unique — derived from the email's local part. */
async function uniqueUsername(email: string, name?: string | null): Promise<string> {
  const raw = (email.split("@")[0] || name || "duelist").toLowerCase().replace(/[^a-z0-9_]/g, "");
  const base = (raw.length >= 3 ? raw : `${raw}duelist`).slice(0, 20);
  for (let i = 0; i < 100; i++) {
    const suffix = i === 0 ? "" : String(i + 1);
    const candidate = base.slice(0, 20 - suffix.length) + suffix;
    if (!(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate;
  }
  return `duelist${Date.now().toString(36)}`;
}

export type GoogleResult = { ok: true; userId: string } | { ok: false; reason: "invite-only" };

/**
 * Resolve a Google account to a user. Existing email → that user (avatar filled in if
 * missing). New email → create, but only if open sign-up is on or a valid unused invite
 * code was carried over from /signup?invite=…, which is then redeemed (friendship + notice).
 */
export async function resolveGoogleUser(profile: GoogleProfile, inviteCode?: string | null): Promise<GoogleResult> {
  const email = profile.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!existing.avatarUrl && profile.picture) {
      await prisma.user.update({ where: { id: existing.id }, data: { avatarUrl: profile.picture } });
    }
    return { ok: true, userId: existing.id };
  }

  const openSignup = process.env.ALLOW_OPEN_SIGNUP === "true";
  const inviteRow = inviteCode ? await prisma.invite.findUnique({ where: { code: inviteCode } }) : null;
  const invite = inviteRow && !inviteRow.usedById ? inviteRow : null;
  if (!openSignup && !invite) return { ok: false, reason: "invite-only" };

  const username = await uniqueUsername(email, profile.name);
  const displayName = (profile.name || username).slice(0, 40);
  const user = await prisma.user.create({
    data: { email, username, displayName, avatarUrl: profile.picture ?? null, passwordHash: "" },
  });

  if (invite && invite.createdById !== user.id) {
    const [a, b] = [user.id, invite.createdById].sort();
    await prisma.$transaction([
      prisma.friendship.upsert({ where: { userAId_userBId: { userAId: a, userBId: b } }, update: {}, create: { userAId: a, userBId: b } }),
      prisma.invite.update({ where: { id: invite.id }, data: { usedById: user.id } }),
      prisma.notification.create({ data: { userId: invite.createdById, type: "FRIEND_JOINED", body: `${displayName} joined from your invite`, href: `/u/${username}` } }),
    ]);
  }
  return { ok: true, userId: user.id };
}
