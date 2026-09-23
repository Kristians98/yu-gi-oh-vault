import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RowData = {
  id: string;
  status: string;
  otherName: string;
  initial: string;
  giveN: number;
  getN: number;
};

function Row({ r }: { r: RowData }) {
  return (
    <a className="trow" href={`/trades/${r.id}`}>
      <span className="av">{r.initial}</span>
      <div className="trow__main">
        <div className="trow__top">
          <b>{r.otherName}</b>
          <span className={"tstatus tstatus--" + r.status.toLowerCase()}>{r.status}</span>
        </div>
        <div className="trow__sub">
          You give {r.giveN} card{r.giveN === 1 ? "" : "s"} · get {r.getN}
        </div>
      </div>
      <span className="trow__arrow">→</span>
    </a>
  );
}

function Section({ title, rows }: { title: string; rows: RowData[] }) {
  return (
    <section className="panel">
      <h2 className="panel__title">{title} <span className="panel__count">{rows.length}</span></h2>
      <div className="trows">{rows.map((r) => <Row key={r.id} r={r} />)}</div>
    </section>
  );
}

export default async function TradesPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const me = session.user.id;

  const trades = await prisma.trade.findMany({
    where: { OR: [{ proposerId: me }, { receiverId: me }] },
    include: { items: true, proposer: true, receiver: true },
    orderBy: { updatedAt: "desc" },
  });

  const rows = trades.map((t) => {
    const iAmReceiver = t.receiverId === me;
    const other = iAmReceiver ? t.proposer : t.receiver;
    const give = t.items.filter((i) => i.ownerId === me);
    const get = t.items.filter((i) => i.ownerId !== me);
    const name = other.displayName || other.username;
    return {
      iAmReceiver,
      status: t.status,
      data: {
        id: t.id,
        status: t.status,
        otherName: name,
        initial: name[0].toUpperCase(),
        giveN: give.length,
        getN: get.length,
      } as RowData,
    };
  });

  const needsResponse = rows.filter((r) => r.iAmReceiver && r.status === "PENDING").map((r) => r.data);
  const active = rows.filter((r) => r.status === "ACCEPTED").map((r) => r.data);
  const sent = rows.filter((r) => !r.iAmReceiver && r.status === "PENDING").map((r) => r.data);
  const history = rows.filter((r) => ["DECLINED", "CANCELLED", "COMPLETED"].includes(r.status)).map((r) => r.data);

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Social</span>
          <h1 className="page-title">Trades</h1>
        </div>
      </header>
      <div className="content">
        {trades.length === 0 && <div className="grid__empty">No trades yet — open a friend&rsquo;s binder and propose one.</div>}
        {needsResponse.length > 0 && <Section title="Needs your response" rows={needsResponse} />}
        {active.length > 0 && <Section title="Active" rows={active} />}
        {sent.length > 0 && <Section title="Sent" rows={sent} />}
        {history.length > 0 && <Section title="History" rows={history} />}
      </div>
    </>
  );
}
