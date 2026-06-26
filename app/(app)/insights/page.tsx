import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RARITY, type Rarity, EXODIA_PIECES, artUrl, money } from "@/lib/cards";
import { effectiveValue } from "@/lib/value";

export default async function InsightsPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const userId = session.user.id;

  const owned = await prisma.ownedCard.findMany({ where: { userId }, include: { printing: { include: { card: true } } } });

  if (owned.length === 0) {
    return (
      <>
        <header className="topbar"><div><span className="page-eyebrow">Collection</span><h1 className="page-title">Insights</h1></div></header>
        <div className="content"><div className="grid__empty">Add some cards and your collection insights will appear here.</div></div>
      </>
    );
  }

  const totalQty = owned.reduce((s, o) => s + o.quantity, 0);
  const value = owned.reduce((s, o) => s + effectiveValue(o.printing.priceUsd, o.condition) * o.quantity, 0);
  const ownedCardIds = new Set(owned.map((o) => o.printing.card.id));
  const tradesDone = await prisma.trade.count({ where: { status: "COMPLETED", OR: [{ proposerId: userId }, { receiverId: userId }] } });

  // Rarity breakdown (by quantity)
  const rc = new Map<string, number>();
  for (const o of owned) rc.set(o.printing.rarity, (rc.get(o.printing.rarity) || 0) + o.quantity);
  const rarityRows = (Object.keys(RARITY) as Rarity[]).filter((r) => rc.get(r)).map((r) => ({ r, count: rc.get(r)! })).sort((a, b) => RARITY[b.r].tier - RARITY[a.r].tier);
  const maxRarity = Math.max(1, ...rarityRows.map((x) => x.count));

  // Most valuable single card
  let top = owned[0];
  let topVal = -1;
  for (const o of owned) {
    const v = effectiveValue(o.printing.priceUsd, o.condition);
    if (v > topVal) { topVal = v; top = o; }
  }

  // Set completion (top sets the user has cards in)
  const bySet = new Map<string, Set<number>>();
  for (const o of owned) {
    const s = bySet.get(o.printing.setName) ?? new Set<number>();
    s.add(o.printing.card.id);
    bySet.set(o.printing.setName, s);
  }
  const topSets = [...bySet.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const setCompletion: { setName: string; owned: number; total: number }[] = [];
  for (const [setName, ids] of topSets) {
    const total = (await prisma.cardPrinting.findMany({ where: { setName }, distinct: ["cardId"], select: { cardId: true } })).length;
    setCompletion.push({ setName, owned: ids.size, total: Math.max(total, ids.size) });
  }

  // Achievements (derived)
  const setMaster = setCompletion.some((s) => s.total > 0 && s.owned >= s.total);
  const ach = [
    { name: "Exodia, Obliterate!", desc: "Own all five Forbidden One pieces", earned: EXODIA_PIECES.every((id) => ownedCardIds.has(id)) },
    { name: "Holographic", desc: "Own a Secret Rare or better", earned: owned.some((o) => (RARITY[o.printing.rarity as Rarity]?.tier ?? 0) >= 4) },
    { name: "Dealmaker", desc: "Complete a trade", earned: tradesDone >= 1 },
    { name: "Master Trader", desc: "Complete 10 trades", earned: tradesDone >= 10 },
    { name: "Collector", desc: "Own 20+ unique cards", earned: owned.length >= 20 },
    { name: "Set Master", desc: "Complete a full set", earned: setMaster },
  ];

  const Stat = ({ label, value: v, sub }: { label: string; value: string; sub: string }) => (
    <div className="stat"><span className="stat__label">{label}</span><span className="stat__value">{v}</span><span className="stat__sub">{sub}</span></div>
  );

  return (
    <>
      <header className="topbar"><div><span className="page-eyebrow">Collection</span><h1 className="page-title">Insights</h1></div></header>
      <div className="content">
        <div className="insights">
          <Stat label="Cards" value={String(totalQty)} sub={`${owned.length} unique`} />
          <Stat label="Sets" value={String(bySet.size)} sub="in your binder" />
          <Stat label="Est. value" value={money(Math.round(value))} sub="condition-adjusted" />
          <Stat label="Trades done" value={String(tradesDone)} sub="completed" />
        </div>

        <section className="panel">
          <h2 className="panel__title">Rarity breakdown</h2>
          <div className="ins-bars">
            {rarityRows.map(({ r, count }) => (
              <div className="ins-bar" key={r}>
                <span className="ins-bar__label" style={{ color: RARITY[r].color }}>{RARITY[r].label}</span>
                <span className="ins-bar__track"><span className="ins-bar__fill" style={{ width: `${(count / maxRarity) * 100}%`, background: RARITY[r].color }} /></span>
                <span className="ins-bar__val">{count}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">Set completion</h2>
          <div className="ins-bars">
            {setCompletion.map((s) => (
              <div className="ins-bar" key={s.setName}>
                <span className="ins-bar__label">{s.setName}</span>
                <span className="ins-bar__track"><span className="ins-bar__fill ins-bar__fill--gold" style={{ width: `${(s.owned / s.total) * 100}%` }} /></span>
                <span className="ins-bar__val">{s.owned}/{s.total}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">Most valuable</h2>
          <div className="topcard">
            <img src={artUrl(top.printing.card.id, true)} alt={top.printing.card.name} />
            <div>
              <div className="rowlist__name">{top.printing.card.name}</div>
              <div className="rowlist__meta" style={{ color: RARITY[top.printing.rarity as Rarity]?.color }}>{RARITY[top.printing.rarity as Rarity]?.label ?? top.printing.rarity} · {top.condition}</div>
            </div>
            <div className="topcard__v">{money(Math.round(topVal))}</div>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">Achievements</h2>
          <div className="ach-grid">
            {ach.map((a) => (
              <div key={a.name} className={"ach" + (a.earned ? " earned" : "")}>
                <div className="ach__name">{a.name}</div>
                <div className="ach__desc">{a.desc}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
