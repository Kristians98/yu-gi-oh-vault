// Internal helpers (not server actions) called by other server actions to
// record notifications and activity. Failures are swallowed so a notification
// problem never breaks the underlying action.
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/events";

export async function notify(userId: string, type: string, body: string, href?: string) {
  try {
    await prisma.notification.create({ data: { userId, type, body, href } });
    publish(userId, { type: "notification" });
  } catch {
    /* ignore */
  }
}

export async function logActivity(userId: string, type: string, body: string, href?: string) {
  try {
    await prisma.activityEvent.create({ data: { userId, type, body, href } });
  } catch {
    /* ignore */
  }
}

/** Convenience: a user's display name for message text. */
export async function displayNameOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } });
  return u?.displayName || u?.username || "Someone";
}
