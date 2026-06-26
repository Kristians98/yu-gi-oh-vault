"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptFriendRequest, declineFriendRequest, removeFriend, sendFriendRequest } from "@/lib/friends";
import { createInvite } from "@/lib/auth-actions";

type Friend = { id: string; username: string; displayName: string | null; cardCount: number; forTradeCount: number };
type Req = { id: string; username: string; displayName: string | null };

export function FriendsPanel({ friends, requests }: { friends: Friend[]; requests: Req[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [inviteLink, setInviteLink] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    start(async () => {
      const r = await sendFriendRequest(name);
      setErr(r);
      if (!r) setName("");
      router.refresh();
    });
  }
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  function makeInvite() {
    start(async () => {
      const code = await createInvite();
      setInviteLink(`${window.location.origin}/signup?invite=${code}`);
      setCopied(false);
    });
  }
  function copy() {
    if (inviteLink) {
      navigator.clipboard?.writeText(inviteLink).catch(() => {});
      setCopied(true);
    }
  }

  return (
    <div className="friends">
      <section className="panel">
        <h2 className="panel__title">Add a friend</h2>
        <form className="addfriend" onSubmit={add}>
          <input value={name} onChange={(e) => { setName(e.target.value); setErr(undefined); }} placeholder="Their username — e.g. mai" aria-label="Friend username" />
          <button className="btn-add" type="submit" disabled={pending}>Send request</button>
        </form>
        {err && <p className="addfriend__err">{err}</p>}

        <div className="invite">
          <button className="btn-mini" onClick={makeInvite} disabled={pending}>＋ Create invite link</button>
          {inviteLink && (
            <div className="invite__row">
              <input readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
              <button className="btn-mini btn-accept" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            </div>
          )}
          <p className="muted invite__hint">Send the link to a friend — they create an account and you&rsquo;re instantly connected.</p>
        </div>
      </section>

      {requests.length > 0 && (
        <section className="panel">
          <h2 className="panel__title">Requests <span className="panel__count">{requests.length}</span></h2>
          <ul className="rowlist">
            {requests.map((r) => (
              <li key={r.id} className="rowlist__item">
                <span className="av">{(r.displayName || r.username)[0].toUpperCase()}</span>
                <span className="rowlist__name">{r.displayName || r.username} <i>@{r.username}</i></span>
                <button className="btn-mini btn-accept" disabled={pending} onClick={() => act(() => acceptFriendRequest(r.id))}>Accept</button>
                <button className="btn-mini" disabled={pending} onClick={() => act(() => declineFriendRequest(r.id))}>Decline</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2 className="panel__title">Your friends <span className="panel__count">{friends.length}</span></h2>
        {friends.length === 0 ? (
          <p className="muted">No friends yet — add one above or share an invite link.</p>
        ) : (
          <ul className="rowlist">
            {friends.map((f) => (
              <li key={f.id} className="rowlist__item">
                <span className="av av--lg">{(f.displayName || f.username)[0].toUpperCase()}</span>
                <div className="rowlist__info">
                  <div className="rowlist__name">{f.displayName || f.username} <i>@{f.username}</i></div>
                  <div className="rowlist__meta">{f.cardCount} cards · {f.forTradeCount} for trade</div>
                </div>
                <a className="btn-mini" href={`/u/${f.username}`}>Binder</a>
                <a className="btn-mini btn-accept" href={`/trades/new?to=${f.username}`}>Trade</a>
                <button className="btn-mini btn-danger" disabled={pending} onClick={() => act(() => removeFriend(f.id))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
