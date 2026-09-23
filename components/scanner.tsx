"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RARITY, type Rarity, type Condition, artUrl } from "@/lib/cards";
import { addToCollection, searchCards } from "@/lib/actions";
import { aiIdentify, identifyByPasscode, resolveScan, type ScanCard, type ScanResolution } from "@/lib/scan";
import type { ScanGuess } from "@/lib/fuzzy";

const CONDITIONS: Condition[] = ["NM", "LP", "MP", "HP", "DMG"];
const CARD_RATIO = 59 / 86; // width / height of a Yu-Gi-Oh! card
type Choice = ScanResolution["choices"][number];

/**
 * Scanner: the camera fills the stage, a card-shaped guide shows where to hold the card,
 * and capture crops to that guide so the AI sees only the card. The <video> stays
 * mounted the whole time (the shot is an overlay) — unmounting it is what left iOS with a
 * black feed after "Retake". Results open in a panel (desktop: right column; phone:
 * sheet over the camera) so the page itself never scrolls.
 */
export function Scanner({ aiEnabled }: { aiEnabled: boolean }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [camError, setCamError] = useState(false);
  const [guide, setGuide] = useState({ w: 0, h: 0 }); // guide box in CSS px
  const [status, setStatus] = useState("");
  const [shot, setShot] = useState<string>();
  const [identifying, setIdentifying] = useState(false);
  const [read, setRead] = useState<ScanGuess | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [candidate, setCandidate] = useState<ScanCard | null>(null);
  const [results, setResults] = useState<ScanCard[]>([]);
  const [printingId, setPrintingId] = useState("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [qty, setQty] = useState(1);
  const [forTrade, setForTrade] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, startBusy] = useTransition();
  const [added, setAdded] = useState<string>();
  const [sheet, setSheet] = useState(false); // phone: results/manual sheet open

  // ---- camera -------------------------------------------------------------------
  const startCamera = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const live = streamRef.current?.getVideoTracks().some((t) => t.readyState === "live");
      if (!live) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      }
      if (v.srcObject !== streamRef.current) v.srcObject = streamRef.current;
      await v.play();
      setCamError(false);
    } catch {
      setCamError(true);
    }
  }, []);

  useEffect(() => {
    startCamera();
    // iOS pauses the feed when the tab is backgrounded; resume when it comes back.
    const onVis = () => document.visibilityState === "visible" && startCamera();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [startCamera]);

  // Guide box: as tall as fits (74% of the stage) at card aspect, never wider than 84%.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const h = Math.min(height * 0.74, (width * 0.84) / CARD_RATIO);
      setGuide({ w: h * CARD_RATIO, h });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function reset(keepShot = false) {
    setCandidate(null);
    setChoices([]);
    setResults([]);
    setRead(null);
    setPrintingId("");
    setStatus("");
    if (!keepShot) setShot(undefined);
  }

  function retake() {
    reset();
    setSheet(false);
    startCamera(); // re-attach + play; iOS drops the feed otherwise
  }

  function pick(card: ScanCard, pinned?: string | null) {
    setCandidate(card);
    setChoices([]);
    setResults([]);
    setPrintingId(pinned && card.printings.some((p) => p.id === pinned) ? pinned : card.printings[0]?.id ?? "");
    setSheet(true);
  }

  /** Crop the live frame to the guide box (plus a small margin) → JPEG data URL ≤ 1024px. */
  function cropToGuide(): string | null {
    const v = videoRef.current;
    const stage = stageRef.current;
    if (!v || !stage || !v.videoWidth || !guide.w) return null;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    // object-fit: cover → uniform scale, centred
    const scale = Math.max(sw / v.videoWidth, sh / v.videoHeight);
    const offX = (sw - v.videoWidth * scale) / 2;
    const offY = (sh - v.videoHeight * scale) / 2;
    const margin = 0.05;
    const gw = guide.w * (1 + margin * 2);
    const gh = guide.h * (1 + margin * 2);
    const gx = (sw - gw) / 2;
    const gy = sh * 0.46 - gh / 2; // guide is centred at 46% height (see CSS)
    const sx = Math.max(0, (gx - offX) / scale);
    const sy = Math.max(0, (gy - offY) / scale);
    const cw = Math.min(v.videoWidth - sx, gw / scale);
    const ch = Math.min(v.videoHeight - sy, gh / scale);
    const out = Math.min(1, 1024 / Math.max(cw, ch));
    const c = document.createElement("canvas");
    c.width = Math.round(cw * out);
    c.height = Math.round(ch * out);
    c.getContext("2d")!.drawImage(v, sx, sy, cw, ch, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.88);
  }

  function applyResolution(r: ScanResolution, guess: ScanGuess) {
    setRead(guess);
    if (r.best) {
      pick(r.best, r.printingId);
      setStatus("");
      return;
    }
    if (r.choices.length === 1) {
      pick(r.choices[0]);
      setStatus("Best guess — please check it's the right card.");
      return;
    }
    if (r.choices.length > 1) {
      setChoices(r.choices);
      setStatus("Not sure — pick the right one.");
      setSheet(true);
      return;
    }
    setStatus(guess.name ? `Read "${guess.name}" but found no match — try again or search below.` : "Couldn't read the card — hold it inside the frame and try again.");
    setSheet(true);
  }

  async function capture() {
    const url = cropToGuide();
    if (!url) {
      setStatus("Camera not ready yet.");
      return;
    }
    setShot(url);
    reset(true);
    setIdentifying(true);
    try {
      if (aiEnabled) {
        setStatus("Reading the card…");
        const guess = await aiIdentify(url);
        if (guess) {
          const r = await resolveScan(guess);
          applyResolution(r, guess);
          return;
        }
        setStatus("AI didn't answer — trying on-device OCR…");
      }
      // Fallback: on-device OCR for passcode + set code only.
      setStatus("Reading the card (OCR)…");
      const T = await import("tesseract.js");
      const img = new Image();
      img.src = url;
      await img.decode();
      const { data } = await T.recognize(img, "eng");
      const text = (data.text || "").toUpperCase();
      const pass = text.match(/\b(\d{8})\b/)?.[1];
      const setCode = text.match(/\b([A-Z0-9]{2,5}-[A-Z]{0,3}\d{1,3}[A-Z]?)\b/)?.[1];
      const guess: ScanGuess = { passcode: pass ? Number(pass) : undefined, setCode };
      if (!pass && !setCode) {
        setStatus("Couldn't read the card — try again or search below.");
        setSheet(true);
        return;
      }
      applyResolution(await resolveScan(guess), guess);
    } catch {
      setStatus("Identification failed — try again or search below.");
      setSheet(true);
    } finally {
      setIdentifying(false);
    }
  }

  function runManual(e: React.FormEvent) {
    e.preventDefault();
    const q = manual.trim();
    if (!q) return;
    startBusy(async () => {
      if (/^\d{6,8}$/.test(q)) {
        const card = await identifyByPasscode(Number(q));
        if (card) pick(card);
        else setStatus("No card with that passcode.");
      } else {
        const r = await searchCards(q);
        if (r.length === 1) pick(r[0]);
        else {
          setResults(r);
          setCandidate(null);
          setStatus(r.length ? "" : "No cards found.");
        }
      }
    });
  }

  function add() {
    if (!printingId || !candidate) return;
    const name = candidate.name;
    startBusy(async () => {
      await addToCollection({ printingId, condition, quantity: qty, forTrade });
      setAdded(name);
      window.setTimeout(() => setAdded(undefined), 2600);
      reset();
      setQty(1);
      setForTrade(false);
      setManual("");
      setSheet(false);
      startCamera();
      router.refresh();
    });
  }

  const showChoices = choices.length > 0 && !candidate;
  const readSummary = read && (read.name || read.frame) ? [read.name, read.frame, read.attribute].filter(Boolean).join(" · ") : null;

  return (
    <div className="scanpage">
      <div className="scan__stage" ref={stageRef}>
        <video ref={videoRef} className="scan__video" playsInline muted autoPlay />
        {shot && <img src={shot} alt="Captured card" className="scan__shot" />}
        {!shot && !camError && <div className="scan__guide" style={{ width: guide.w, height: guide.h }} aria-hidden="true" />}
        {camError && !shot && (
          <div className="scan__camerr">
            Camera unavailable.
            <br />
            <button className="btn-mini" onClick={startCamera}>Try again</button> or type the card in below.
          </div>
        )}
        <div className="scan__chip">SCAN · BETA</div>
        {added && <div className="scan__toast">Added <b>{added}</b> ✓</div>}

        <div className="scan__shutter">
          <div className="scan__status" aria-live="polite">
            {identifying ? status || "Reading…" : status || (shot ? "" : "Hold the card inside the frame")}
          </div>
          <div className="scan__buttons">
            {shot ? (
              <button className="btn-mini" onClick={retake} disabled={identifying}>Retake</button>
            ) : (
              <button className="scan__capture" onClick={capture} disabled={camError || identifying} aria-label="Capture and identify">
                <span />
              </button>
            )}
            <button className="btn-mini scan__type" onClick={() => setSheet((s) => !s)}>{sheet ? "Close" : "Type it in"}</button>
          </div>
        </div>
      </div>

      <aside className={"scan__panel" + (sheet ? " scan__panel--open" : "")}>
        <button className="scan__close" onClick={() => setSheet(false)} aria-label="Close">×</button>

        {candidate ? (
          <div className="add__form">
            <div className="scan__cand">
              <img src={artUrl(candidate.id)} alt={candidate.name} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              <div>
                <h3 className="add__detail-name">{candidate.name}</h3>
                {readSummary && <p className="scan__read">Read: {readSummary}</p>}
                <button className="add__back" onClick={() => { setCandidate(null); if (read) setStatus(""); }}>← Not this card</button>
              </div>
            </div>
            <label className="add__label">Set / rarity</label>
            <select className="add__input" value={printingId} onChange={(e) => setPrintingId(e.target.value)}>
              {candidate.printings.length === 0 && <option value="">No printings on record</option>}
              {candidate.printings.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.setCode} · {RARITY[p.rarity as Rarity]?.label ?? p.rarity}
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
        ) : showChoices ? (
          <>
            <h2 className="panel__title">Which card is it?</h2>
            {readSummary && <p className="muted scan__read">Read: {readSummary}</p>}
            <div className="add__results scan__results">
              {choices.map((c) => (
                <button key={c.id} className="add__result" onClick={() => pick(c)}>
                  <img src={artUrl(c.id, true)} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                  <span className="add__result-name">{c.name}</span>
                  <span className="add__result-meta">{c.reasons[0] ?? `${c.score}`}</span>
                </button>
              ))}
            </div>
            <button className="add__back" onClick={() => { setChoices([]); setStatus(""); }}>None of these — search instead</button>
          </>
        ) : (
          <>
            <h2 className="panel__title">Type it in</h2>
            <p className="muted">The 8-digit passcode or the card name.</p>
            <form className="addfriend" onSubmit={runManual}>
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="89631139  or  Blue-Eyes White Dragon" aria-label="Passcode or card name" />
              <button className="btn-add" type="submit" disabled={busy}>Find</button>
            </form>
            {status && <p className="muted scan__status">{status}</p>}
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
            <p className={"scan__ai" + (aiEnabled ? "" : " scan__ai--off")}>
              {aiEnabled ? "✦ AI vision on — reads name, frame, attribute, type and stats, then matches your card" : "AI vision off — on-device OCR of the passcode + manual search"}
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
