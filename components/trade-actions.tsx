"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptTrade, cancelTrade, confirmTrade, declineTrade } from "@/lib/trades";

export function TradeActions({
  id,
  status,
  iAmProposer,
  iAmReceiver,
  proposerConfirmed,
  receiverConfirmed,
}: {
  id: string;
  status: string;
  iAmProposer: boolean;
  iAmReceiver: boolean;
  proposerConfirmed: boolean;
  receiverConfirmed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  const myConfirmed = iAmProposer ? proposerConfirmed : receiverConfirmed;

  if (status === "PENDING" && iAmReceiver) {
    return (
      <div className="tactions">
        <button className="btn-add" disabled={pending} onClick={() => act(() => acceptTrade(id))}>Accept trade</button>
        <button className="btn-mini btn-danger" disabled={pending} onClick={() => act(() => declineTrade(id))}>Decline</button>
      </div>
    );
  }
  if (status === "PENDING" && iAmProposer) {
    return (
      <div className="tactions">
        <span className="muted">Waiting for them to respond…</span>
        <button className="btn-mini btn-danger" disabled={pending} onClick={() => act(() => cancelTrade(id))}>Cancel</button>
      </div>
    );
  }
  if (status === "ACCEPTED") {
    return (
      <div className="tactions">
        {myConfirmed ? (
          <span className="muted">You confirmed the swap — waiting for the other duelist…</span>
        ) : (
          <button className="btn-add" disabled={pending} onClick={() => act(() => confirmTrade(id))}>Confirm handoff</button>
        )}
        {iAmProposer && <button className="btn-mini btn-danger" disabled={pending} onClick={() => act(() => cancelTrade(id))}>Cancel</button>}
      </div>
    );
  }
  return null;
}
