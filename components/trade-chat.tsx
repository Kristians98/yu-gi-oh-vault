"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendTradeMessage } from "@/lib/trades";

type Msg = { id: string; mine: boolean; body: string; at: number };

export function TradeChat({ tradeId, messages }: { tradeId: string; messages: Msg[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    start(async () => {
      await sendTradeMessage(tradeId, body);
      setText("");
      router.refresh();
    });
  }

  return (
    <section className="chat">
      <h2 className="chat__title">Chat</h2>
      <div className="chat__log">
        {messages.length === 0 ? (
          <p className="muted">No messages yet — say hi or arrange the meetup.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={"chat__msg" + (m.mine ? " mine" : "")}>{m.body}</div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form className="chat__form" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" maxLength={1000} aria-label="Message" />
        <button className="btn-add" type="submit" disabled={pending || !text.trim()}>Send</button>
      </form>
    </section>
  );
}
