"use client";

import { usePathname } from "next/navigation";

const Binder = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="13" height="18" rx="2" /><path d="M17 6h3v15H8" /><path d="M8 7h5" /></svg>
);
const Scan = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3.2" /></svg>
);
const Users = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6M17.5 20a5.5 5.5 0 0 0-3-4.9" /></svg>
);
const Swap = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
);
const Star = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
);
const Chart = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
);
const Pulse = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 6 4-14 2 8h6" /></svg>
);
const Deck = () => (
  <svg className="nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z" /><path d="m3.5 12 8.5 4.5 8.5-4.5" /><path d="m3.5 16.5 8.5 4.5 8.5-4.5" /></svg>
);

export function SideNav() {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const Item = ({ href, label, icon: Icon }: { href: string; label: string; icon: () => React.ReactElement }) => (
    <a className={"nav__item" + (active(href) ? " nav__item--active" : "")} href={href} aria-current={active(href) ? "page" : undefined}>
      <Icon /> {label}
    </a>
  );
  return (
    <nav className="nav" aria-label="Primary">
      <div className="nav__label">Collection</div>
      <Item href="/" label="Binder" icon={Binder} />
      <Item href="/scan" label="Scan" icon={Scan} />
      <Item href="/decks" label="Decks" icon={Deck} />
      <Item href="/insights" label="Insights" icon={Chart} />
      <Item href="/wishlist" label="Wishlist" icon={Star} />

      <div className="nav__label" style={{ marginTop: 18 }}>Social</div>
      <Item href="/friends" label="Friends" icon={Users} />
      <Item href="/trades" label="Trades" icon={Swap} />
      <Item href="/feed" label="Activity" icon={Pulse} />
    </nav>
  );
}
