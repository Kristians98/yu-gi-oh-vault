import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFriendIds } from "@/lib/social";

function ago(date: Date, now: number): string {
  const s = Math.floor((now - date.getTime()) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default async function FeedPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const friendIds = await getFriendIds(session.user.id);
  const actorIds = [...friendIds, session.user.id];
  const events = await prisma.activityEvent.findMany({
    where: { userId: { in: actorIds } },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { user: true },
  });
  const now = Date.now();

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Social</span>
          <h1 className="page-title">Activity</h1>
        </div>
      </header>
      <div className="content">
        {events.length === 0 ? (
          <div className="grid__empty">No activity yet — add cards or make a trade and it&rsquo;ll show up here.</div>
        ) : (
          <ul className="feed">
            {events.map((e) => (
              <li key={e.id} className="feed__item">
                <span className="av">{(e.user.displayName || e.user.username)[0].toUpperCase()}</span>
                <div className="feed__body">{e.href ? <a href={e.href}>{e.body}</a> : e.body}</div>
                <span className="feed__time">{ago(e.createdAt, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
