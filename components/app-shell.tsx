// App shell: sidebar (brand + nav + user) and the main slot. Server component.
import { signOut } from "@/auth";
import { SideNav } from "./side-nav";
import { NotificationBell } from "./notification-bell";
import { MobileNav } from "./mobile-nav";
import { Realtime } from "./realtime";
import { ScrollReset } from "./scroll-reset";
import { ViewportHeight } from "./viewport-height";

const IconLogout = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
);

export function AppShell({
  user,
  children,
}: {
  user: { name?: string | null; username?: string; email?: string | null };
  children: React.ReactNode;
}) {
  const name = user.name || user.username || "Duelist";
  const initial = (name.trim()[0] || "D").toUpperCase();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__top">
          <div className="brand">
            <img className="brand__mark" src="/brand/binder.png" alt="" />
            <div>
              <div className="brand__name">VIRTUAL BINDER</div>
              <div className="brand__sub">Yu-Gi-Oh! collection</div>
            </div>
          </div>
          <NotificationBell />
        </div>

        <SideNav />

        <div className="user">
          <div className="user__avatar">{initial}</div>
          <div className="user__id">
            <div className="user__name">{name}</div>
            <div className="user__handle">@{user.username || "duelist"}</div>
          </div>
          <form action={logout}>
            <button className="user__logout" type="submit" aria-label="Sign out" title="Sign out">
              <IconLogout />
            </button>
          </form>
        </div>
      </aside>

      <div className="main">{children}</div>
      <MobileNav />
      <Realtime />
      <ScrollReset />
      <ViewportHeight />
    </div>
  );
}
