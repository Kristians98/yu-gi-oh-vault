import Link from "next/link";
import { auth } from "@/auth";
import { deckAiConfigured } from "@/lib/deck-ai";
import { loadPlayHome, type DuelRow, type HeadToHead } from "@/lib/duel-view";
import { FORMAT_LABEL, MODES } from "@/lib/duel-rules";
import { DuelChallenge } from "@/components/duel-challenge";

function Row({ r }: { r: DuelRow }) {
  return (
    <Link className="trow" href={`/play/${r.id}`}>
      <span className="av">{r.initial}</span>
      <div className="trow__main">
        <div className="trow__top">
          <b>{r.otherName}</b>
          <span className={"tstatus tstatus--" + r.status.toLowerCase()}>{r.status === "DONE" ? "Finished" : r.status}</span>
          <span className="trow__tag">{MODES[r.mode]?.label ?? r.mode} · {FORMAT_LABEL[r.format]}</span>
        </div>
        <div className="trow__sub">{r.hint}</div>
      </div>
      <span className="trow__arrow">→</span>
    </Link>
  );
}

function Rows({ title, rows }: { title: string; rows: DuelRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="panel">
      <h2 className="panel__title">{title} <span className="panel__count">{rows.length}</span></h2>
      <div className="trows">{rows.map((r) => <Row key={r.id} r={r} />)}</div>
    </section>
  );
}

function Record({ h }: { h: HeadToHead }) {
  const streak = h.streak > 0 ? `W${h.streak}` : h.streak < 0 ? `L${-h.streak}` : "—";
  const fmt = (Object.keys(h.byFormat) as (keyof typeof h.byFormat)[]).filter((f) => h.byFormat[f].w + h.byFormat[f].l > 0);
  const modes = (Object.keys(h.byMode) as (keyof typeof h.byMode)[]).filter((m) => h.byMode[m].w + h.byMode[m].l > 0);
  return (
    <div className="record">
      <div className="record__head">
        <span className="av">{h.name[0].toUpperCase()}</span>
        <div>
          <b>vs {h.name}</b>
          <div className="dots" aria-label="Recent results, newest first">
            {h.recent.map((w, i) => <span key={i} className={"dot " + (w ? "dot--w" : "dot--l")} title={w ? "Won" : "Lost"} />)}
          </div>
        </div>
        <span className="record__score" title="Your wins – your losses">{h.wins}<span>–</span>{h.losses}</span>
      </div>
      <div className="record__sub">
        <span>streak {streak}</span>
        {fmt.map((f) => <span key={f}>{FORMAT_LABEL[f]} {h.byFormat[f].w}–{h.byFormat[f].l}</span>)}
        {modes.map((m) => <span key={m}>{MODES[m].label} {h.byMode[m].w}–{h.byMode[m].l}</span>)}
      </div>
    </div>
  );
}

export default async function PlayPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const home = await loadPlayHome(session.user.id);
  const aiOn = deckAiConfigured();

  return (
    <>
      <header className="topbar">
        <div>
          <span className="page-eyebrow">Social</span>
          <h1 className="page-title">Play</h1>
        </div>
      </header>
      <div className="content">
        <Rows title="Your move" rows={home.yourMove} />
        <Rows title="Waiting on them" rows={home.waiting} />

        <section className="panel">
          <h2 className="panel__title">Challenge a friend</h2>
          <p className="deck-form__lead">
            Both decks are built by the AI from each player&rsquo;s <b>own binder</b>, so you can duel with the real cards. Pick a format, a mode,
            and optional mutators. Rerolls, kills and pins are limited — spend them well.
          </p>
          {home.friends.length === 0 ? (
            <p className="deck-note">No friends yet — <Link href="/friends">add one</Link> to start duelling.</p>
          ) : (
            <DuelChallenge friends={home.friends} myPools={home.myPools} aiOn={aiOn} />
          )}
        </section>

        {home.records.length > 0 && (
          <section className="panel">
            <h2 className="panel__title">Record</h2>
            <div className="records">{home.records.map((h) => <Record key={h.userId} h={h} />)}</div>
          </section>
        )}

        <Rows title="History" rows={home.history} />
      </div>
    </>
  );
}
