"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RARITY, type Rarity, type Condition, artUrl } from "@/lib/cards";
import { addToCollection, searchCards } from "@/lib/actions";
import { aiIdentify, findPrintingBySetCode, identifyByPasscode } from "@/lib/scan";

type IdCard = NonNullable<Awaited<ReturnType<typeof identifyByPasscode>>>;
const CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];

export function Scanner({ aiEnabled }: { aiEnabled: boolean }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [camError, setCamError] = useState(false);
  const [status, setStatus] = useState("");
  const [shot, setShot] = useState<string>();
  const [candidate, setCandidate] = useState<IdCard | null>(null);
  const [results, setResults] = useState<IdCard[]>([]);
  const [printingId, setPrintingId] = useState("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [qty, setQty] = useState(1);
  const [forTrade, setForTrade] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, startBusy] = useTransition();
  const [added, setAdded] = useState<string>();

  useEffect(() => {
    let stream: MediaStream | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setCamError(true);
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function pick(card: IdCard) {
    setCandidate(card);
    setResults([]);
    setPrintingId(card.printings[0]?.id ?? "");
  }

  async function capture() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) {
      setStatus("Camera not ready yet.");
      return;
    }
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.9);
    setShot(url);

    // 1) Cloud vision (Azure gpt-4o-mini) — primary path
    if (aiEnabled) {
      setStatus("Identifying with AI…");
      try {
        const scale = Math.min(1, 1024 / c.width);
        let aiUrl = url;
        if (scale < 1) {
          const sc = document.createElement("canvas");
          sc.width = Math.round(c.width * scale);
          sc.height = Math.round(c.height * scale);
          sc.getContext("2d")!.drawImage(c, 0, 0, sc.width, sc.height);
          aiUrl = sc.toDataURL("image/jpeg", 0.8);
        }
        const ai = await aiIdentify(aiUrl);
        if (ai && (ai.passcode || ai.name)) {
          let card = ai.passcode ? await identifyByPasscode(ai.passcode) : null;
          if (!card && ai.name) {
            const r = await searchCards(ai.name);
            card = r[0] ?? null;
          }
          if (card) {
            pick(card);
            if (ai.setCode) {
              const pid = await findPrintingBySetCode(ai.setCode);
              if (pid && card.printings.some((p) => p.id === pid)) setPrintingId(pid);
            }
            setStatus("");
            return;
          }
        }
      } catch {
        /* fall back to OCR */
      }
    }

    // 2) On-device OCR — fallback
    setStatus("Reading card…");
    try {
      const T = await import("tesseract.js");
      const { data } = await T.recognize(c, "eng");
      const text = (data.text || "").toUpperCase();
      const pass = text.match(/\b(\d{8})\b/) || text.match(/(\d{7,8})/);
      const setCode = text.match(/\b([A-Z0-9]{2,5}-[A-Z]{0,3}\d{1,3}[A-Z]?)\b/);
      if (pass) {
        const card = await identifyByPasscode(Number(pass[1]));
        if (card) {
          pick(card);
          if (setCode) {
            const pid = await findPrintingBySetCode(setCode[1]);
            if (pid && card.printings.some((p) => p.id === pid)) setPrintingId(pid);
          }
          setStatus("");
          return;
        }
      }
      setStatus("Couldn't read the passcode automatically — enter it below.");
      if (pass) setManual(pass[1]);
    } catch {
      setStatus("On-device OCR couldn't load — enter the card below.");
    }
  }

  function runManual(e: React.FormEvent) {
    e.preventDefault();
    const q = manual.trim();
    if (!q) return;
    startBusy(async () => {
      if (/^\d{6,8}$/.test(q)) {
        const card = await identifyByPasscode(Number(q));
        if (card) { pick(card); setStatus(""); } else setStatus("No card with that passcode.");
      } else {
        const r = await searchCards(q);
        if (r.length === 1) pick(r[0]);
        else { setResults(r); setCandidate(null); setStatus(r.length ? "" : "No cards found."); }
      }
    });
  }

  function add() {
    if (!printingId) return;
    const name = candidate?.name;
    startBusy(async () => {
      await addToCollection({ printingId, condition, quantity: qty, forTrade });
      setAdded(name);
      setCandidate(null);
      setShot(undefined);
      setPrintingId("");
      setQty(1);
      setForTrade(false);
      setManual("");
      router.refresh();
    });
  }

  return (
    <div className="content scan">
      {added && <div className="scan__toast">Added <b>{added}</b> to your binder ✓</div>}

      <div className="scan__grid">
        <div className="scan__cam">
          {shot ? (
            <img src={shot} alt="Captured card" className="scan__shot" />
          ) : (
            <video ref={videoRef} className="scan__video" playsInline muted />
          )}
          {camError && !shot && <div className="scan__camerr">Camera unavailable.<br />Use manual entry →</div>}
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div className="scan__cambar">
            {shot ? (
              <button className="btn-mini" onClick={() => { setShot(undefined); setStatus(""); }}>Retake</button>
            ) : (
              <button className="btn-add" onClick={capture} disabled={camError}>Capture &amp; identify</button>
            )}
            {status && <span className="scan__status">{status}</span>}
          </div>
          {aiEnabled ? (
            <p className="scan__ai">✦ AI vision on — gpt-4o-mini reads the card for you</p>
          ) : (
            <p className="scan__ai scan__ai--off">AI vision off — using on-device OCR + manual entry</p>
          )}
          <p className="scan__hint">Point at a card so the name, 8-digit passcode (bottom-left) and set code (bottom-right) are sharp. The passcode is the card&rsquo;s exact ID; the set code resolves its rarity.</p>
        </div>

        <div className="scan__panel">
          {candidate ? (
            <div className="add__form">
              <div className="scan__cand">
                <img src={artUrl(candidate.id)} alt={candidate.name} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                <div>
                  <h3 className="add__detail-name">{candidate.name}</h3>
                  <button className="add__back" onClick={() => setCandidate(null)}>← Not this card</button>
                </div>
              </div>
              <label className="add__label">Set / rarity</label>
              <select className="add__input" value={printingId} onChange={(e) => setPrintingId(e.target.value)}>
                {candidate.printings.length === 0 && <option value="">No printings on record</option>}
                {candidate.printings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.setCode} · {RARITY[p.rarity as Rarity]?.label ?? p.rarity}{p.priceUsd ? ` · $${p.priceUsd}` : ""}
                  </option>
                ))}
              </select>
              <div className="add__row">
                <div>
                  <label className="add__label">Condition</label>
                  <select className="add__input" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
                    {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="add__label">Quantity</label>
                  <input className="add__input" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
                </div>
              </div>
              <label className="add__check">
                <input type="checkbox" checked={forTrade} onChange={(e) => setForTrade(e.target.checked)} /> Mark as available to trade
              </label>
              <button className="add__submit" onClick={add} disabled={busy || !printingId}>{busy ? "Adding…" : "Add to binder"}</button>
            </div>
          ) : (
            <>
              <h2 className="panel__title">Manual entry</h2>
              <p className="muted">Type the 8-digit passcode or the card name.</p>
              <form className="addfriend" onSubmit={runManual}>
                <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="89631139  or  Blue-Eyes White Dragon" aria-label="Passcode or card name" />
                <button className="btn-add" type="submit" disabled={busy}>Find</button>
              </form>
              {status && !shot && <p className="muted scan__status">{status}</p>}
              {results.length > 0 && (
                <div className="add__results scan__results">
                  {results.map((c) => (
                    <button key={c.id} className="add__result" onClick={() => pick(c)}>
                      <img src={artUrl(c.id, true)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                      <span className="add__result-name">{c.name}</span>
                      <span className="add__result-meta">{c.printings.length} printings</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
