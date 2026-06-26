// App shell: sidebar (brand + nav + user) and the main slot. Server component.
import { signOut } from "@/auth";
import { SideNav } from "./side-nav";
import { NotificationBell } from "./notification-bell";
import { MobileNav } from "./mobile-nav";
import { Realtime } from "./realtime";

function MarkEye() {
  return (
    <svg className="brand__mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M24 4 L44 40 H4 Z" stroke="#d9b45b" strokeWidth="2" strokeLinejoin="round" />
      <path d="M13 29 q11 -11 22 0 q-11 9 -22 0 Z" fill="#0a0710" stroke="#f2d488" strokeWidth="1.6" />
      <circle cx="24" cy="28.5" r="3.4" fill="#f2d488" />
      <path d="M24 32 v5 M19 32 l-2.5 4 M29 32 l2.5 4" stroke="#d9b45b" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

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
            <MarkEye />
            <div>
              <div className="brand__name">THE VAULT</div>
              <div className="brand__sub">Duelist Binder</div>
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
    </div>
  );
}
