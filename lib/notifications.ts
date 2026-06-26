"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function getMyNotifications() {
  const s = await auth();
  if (!s?.user?.id) return { items: [] as { id: string; body: string; href: string | null; read: boolean; at: number }[], unread: 0 };
  const rows = await prisma.notification.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const unread = await prisma.notification.count({ where: { userId: s.user.id, readAt: null } });
  return {
    items: rows.map((n) => ({ id: n.id, body: n.body, href: n.href, read: !!n.readAt, at: n.createdAt.getTime() })),
    unread,
  };
}

export async function markAllRead() {
  const s = await auth();
  if (!s?.user?.id) return;
  await prisma.notification.updateMany({ where: { userId: s.user.id, readAt: null }, data: { readAt: new Date() } });
}
