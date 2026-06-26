import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RARITY, type Rarity, artUrl } from "@/lib/cards";
import { TradeActions } from "@/components/trade-actions";
import { TradeChat } from "@/components/trade-chat";

type Item = { id: string; cardId: number; cardName: string; rarity: string; setCode: string; condition: string; valueUsd: number | null };

function Items({ items }: { items: Item[] }) {
  if (items.length === 0) return <p className="muted">—</p>;
  return (
    <div className="tdetail__items">
      {items.map((i) => {
        const r = RARITY[i.rarity as Rarity];
        return (
          <div className="titem" key={i.id}>
            <img src={artUrl(i.cardId, true)} alt={i.cardName} />
            <div className="titem__info">
              <div className="titem__name">{i.cardName}</div>
              <div className="titem__meta"><span style={{ color: r?.color }}>{r?.label ?? i.rarity}</span> · {i.setCode} · {i.condition}</div>
            </div>
            <div className="titem__val">${(i.valueUsd || 0).toFixed(2)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const me = session.user.id;

  const trade = await prisma.trade.findUnique({ where: { id }, include: { items: true, proposer: true, receiver: true, messages: { orderBy: { createdAt: "asc" } } } });
  if (!trade) notFound();
  if (trade.proposerId !== me && trade.receiverId !== me) notFound();

  const iAmProposer = trade.proposerId === me;
  const iAmReceiver = trade.receiverId === me;
  const other = iAmProposer ? trade.receiver : trade.proposer;
  const give = trade.items.filter((i) => i.ownerId === me);
  const get = trade.items.filter((i) => i.ownerId !== me);
  const giveVal = give.reduce((s, i) => s + (i.valueUsd || 0), 0);
  const getVal = get.reduce((s, i) => s + (i.valueUsd || 0), 0);
  const delta = giveVal - getVal;
  const otherName = other.displayName || other.username;
  const verdict = Math.abs(delta) < 1 ? "Even trade" : delta > 0 ? `Favours ${otherName} by $${delta.toFixed(2)}` : `Favours you by $${(-delta).toFixed(2)}`;
  const leftPct = giveVal + getVal > 0 ? (giveVal / (giveVal + getVal)) * 100 : 50;
  const msgs = trade.messages.map((m) => ({ id: m.id, mine: m.senderId === me, body: m.body, at: m.createdAt.getTime() }));

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Trade · {trade.status}</span>
          <h1 className="page-title">Trade with {otherName}</h1>
        </div>
      </header>
      <div className="content">
        <div className="tdetail">
          <section className="tdetail__col">
            <h2 className="tdetail__h">You give <span>${giveVal.toFixed(2)}</span></h2>
            <Items items={give} />
          </section>
          <section className="tdetail__col">
            <h2 className="tdetail__h">You get <span>${getVal.toFixed(2)}</span></h2>
            <Items items={get} />
          </section>
        </div>

        <div className="fairness">
          <div className="fm">
            <div className="fm__head">
              <span>You ${giveVal.toFixed(2)}</span>
              <span className="fm__verdict">{verdict}</span>
              <span>${getVal.toFixed(2)} {otherName}</span>
            </div>
            <div className="fm__bar"><div className="fm__fill" style={{ width: leftPct + "%" }} /></div>
          </div>
          <TradeActions
            id={trade.id}
            status={trade.status}
            iAmProposer={iAmProposer}
            iAmReceiver={iAmReceiver}
            proposerConfirmed={trade.proposerConfirmed}
            receiverConfirmed={trade.receiverConfirmed}
          />
        </div>
        <TradeChat tradeId={trade.id} messages={msgs} />
      </div>
    </>
  );
}
