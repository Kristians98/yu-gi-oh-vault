import { prisma } from "@/lib/prisma";
import { cronAuthed } from "@/lib/cron-auth";
import { syncCards } from "@/prisma/card-sync.mjs";

export const dynamic = "force-dynamic";
// 60 is the ceiling on every Vercel plan (a higher value fails the Hobby build). A full
// sync needs far less: the YGOPRODeck pull is CDN-cached (~1 s) and the diff is in-memory.
export const maxDuration = 60;

// Weekly: pull newly released cards and reprints from YGOPRODeck (see prisma/card-sync.mjs).
// Full sync by default; `?since=YYYY-MM-DD` limits it to TCG releases since that date.
export async function GET(req: Request) {
  if (!cronAuthed(req)) return new Response("forbidden", { status: 403 });
  const since = new URL(req.url).searchParams.get("since") || undefined;
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return new Response("since must be YYYY-MM-DD", { status: 400 });
  try {
    const summary = await syncCards(prisma, { since });
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
