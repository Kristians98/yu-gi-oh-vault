import { auth } from "@/auth";
import { getFriendsWithCounts, getIncomingRequests } from "@/lib/social";
import { FriendsPanel } from "@/components/friends-panel";

export default async function FriendsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [friends, requests] = await Promise.all([
    getFriendsWithCounts(session.user.id),
    getIncomingRequests(session.user.id),
  ]);

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Social</span>
          <h1 className="page-title">Friends</h1>
        </div>
      </header>
      <div className="content">
        <FriendsPanel friends={friends} requests={requests} />
      </div>
    </>
  );
}
