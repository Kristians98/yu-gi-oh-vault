// Server-only: Azure OpenAI chat → builds a Yu-Gi-Oh! deck as JSON.
// Uses a deck-specific deployment if set (AZURE_AI_DECK_DEPLOYMENT) else falls back to
// the scanner's deployment. Point AZURE_AI_DECK_DEPLOYMENT at a GPT-5-class deployment
// when you have one — no code change needed.

const ENDPOINT = process.env.AZURE_AI_ENDPOINT?.replace(/\/$/, "");
const KEY = process.env.AZURE_AI_KEY;
const DEPLOYMENT = process.env.AZURE_AI_DECK_DEPLOYMENT || process.env.AZURE_AI_DEPLOYMENT;
const API_VERSION = process.env.AZURE_AI_API_VERSION || "2024-05-01-preview";

export function deckAiConfigured(): boolean {
  return Boolean(ENDPOINT && KEY && DEPLOYMENT);
}

// Pull the first balanced {...} object out of a model reply (it may wrap JSON in
// markdown fences or add prose before/after — a greedy regex breaks on that).
function extractFirstJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export type RawDeckEntry = { name: string; copies: number };
export type RawDeck = {
  deckName: string;
  strategy: string;
  mainDeck: RawDeckEntry[];
  extraDeck: RawDeckEntry[];
  sideDeck: RawDeckEntry[];
};

const FORMAT_LABEL: Record<string, string> = {
  advanced: "the current TCG Advanced format",
  goat: "the Goat Control format (TCG, mid-2005 card pool — nothing newer than Cybernetic Revolution)",
  edison: "the Edison format (TCG, March–April 2010 card pool)",
};

/** Build the system + user messages, then call the model and parse its JSON deck. */
export async function buildDeckJSON(opts: {
  format: string;
  strategy: string;
  poolMode: "collection" | "any";
  poolList?: string; // newline list of legal owned cards (collection mode)
}): Promise<RawDeck | null> {
  if (!deckAiConfigured()) return null;

  const fmt = FORMAT_LABEL[opts.format] ?? "the current TCG Advanced format";
  const poolRule =
    opts.poolMode === "collection"
      ? "You may use ONLY cards from the player's legal collection listed below, and never more copies of a card than they own. Do not invent cards that are not in the list."
      : "You may use any card that is legal in this format (Forbidden cards for this format are banned).";
  const strategyLine = opts.strategy.trim()
    ? `The player asked for this strategy/theme: "${opts.strategy.trim()}". Build around it.`
    : "Choose a strong, coherent strategy that suits the format.";

  const system = [
    `You are an expert Yu-Gi-Oh! TCG deck builder. Build ONE coherent, competitively reasonable deck for ${fmt}.`,
    "Hard rules you MUST obey:",
    "- Main Deck: 40 to 60 cards total (prefer 40 unless the strategy needs more).",
    "- Extra Deck: 0 to 15 cards total. Side Deck: 0 to 15 cards (may be empty).",
    "- A card may appear at most 3 times total, and never more than its banlist limit for this format (Limited = 1, Semi-Limited = 2). Forbidden cards are not allowed.",
    "- The Extra Deck contains ONLY Fusion, Synchro, Xyz and Link monsters; everything else goes in the Main Deck.",
    "- CRITICAL — every Extra Deck card MUST be summonable with the Main Deck you build:",
    "    Fusion → include a Fusion Spell (e.g. Polymerization) or a card that Fusion Summons, plus its materials.",
    "    Synchro → include at least one Tuner plus non-Tuner monsters whose Levels can total the Synchro's Level.",
    "    Xyz → include at least two Main-Deck monsters whose Level equals the Xyz's Rank.",
    "    Link → include enough monsters to meet the Link Rating.",
    "  Do NOT list an Extra Deck card you cannot summon — leave it out instead.",
    `- ${poolRule}`,
    "Build to these five pillars of a great deck:",
    "  1) Consistency — ~10–14 one-card starters plus searchers/draw so you rarely brick; run 3 copies of key engine cards; keep dead/high-cost 'brick' cards low; aim for 40 cards.",
    '  2) Resilience — add extenders and backup lines so a single hand trap (Ash Blossom, Maxx "C", Infinite Impermanence) does not stop the play.',
    "  3) Disruption — try to end Turn 1 with multiple interruptions (negates, removal, or a floodgate) via quick-effect monsters or Traps.",
    "  4) Resource management — include ways to recycle resources and rebuild after a board wipe (Graveyard recursion, searchers, draw).",
    "  5) Format fitness — every card legal for the format; include format-appropriate hand traps and a Side Deck (up to 15) to answer popular strategies.",
    "Counts must add up.",
    strategyLine,
    "Before answering, re-check every rule above — especially that EVERY Extra Deck card is summonable from your Main Deck — and fix any violation.",
    'Respond with ONLY this JSON (no markdown, no prose): {"deckName":string,"strategy":string,"mainDeck":[{"name":string,"copies":number}],"extraDeck":[{"name":string,"copies":number}],"sideDeck":[{"name":string,"copies":number}]}',
    '"strategy" is 2–4 sentences explaining the game plan. Card names must be exact official English names.',
  ].join("\n");

  const user =
    opts.poolMode === "collection"
      ? `Legal cards in the player's collection (name — owned×N [type]):\n${opts.poolList ?? "(none)"}\n\nBuild the best deck you can from these cards.`
      : `Build the deck now for ${fmt}.`;

  const url = `${ENDPOINT}/models/chat/completions?api-version=${API_VERSION}`;
  const body = {
    model: DEPLOYMENT,
    // GPT-5 / o-series reject `max_tokens` (use `max_completion_tokens`) and only allow
    // the default temperature, so we omit temperature. Generous cap leaves room for the
    // model's reasoning tokens before the deck JSON. gpt-4o-mini also accepts this shape.
    max_completion_tokens: 8000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": KEY as string },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Azure deck HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const jsonStr = extractFirstJson(text);
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr) as Partial<RawDeck>;
    const clean = (arr: unknown): RawDeckEntry[] =>
      Array.isArray(arr)
        ? arr
            .map((e) => ({ name: String((e as RawDeckEntry)?.name ?? "").trim(), copies: Math.max(1, Math.round(Number((e as RawDeckEntry)?.copies) || 1)) }))
            .filter((e) => e.name)
        : [];
    return {
      deckName: String(parsed.deckName ?? "Untitled Deck").trim().slice(0, 80) || "Untitled Deck",
      strategy: String(parsed.strategy ?? "").trim().slice(0, 800),
      mainDeck: clean(parsed.mainDeck),
      extraDeck: clean(parsed.extraDeck),
      sideDeck: clean(parsed.sideDeck),
    };
  } catch (e) {
    console.error("Azure deck build failed", e);
    return null;
  }
}

export type RefineResult = {
  reply: string;
  changed: boolean;
  deckName?: string;
  strategy?: string;
  mainDeck?: RawDeckEntry[];
  extraDeck?: RawDeckEntry[];
  sideDeck?: RawDeckEntry[];
};

/** Conversational follow-up on a built deck: answer a question, or apply a change and
 *  return the full revised deck. */
export async function refineDeckJSON(opts: {
  format: string;
  poolMode: "collection" | "any";
  current: { main: { name: string; copies: number }[]; extra: { name: string; copies: number }[]; side: { name: string; copies: number }[] };
  currentName: string;
  currentStrategy: string;
  history: { role: string; content: string }[];
  message: string;
}): Promise<RefineResult | null> {
  if (!deckAiConfigured()) return null;
  const fmt = FORMAT_LABEL[opts.format] ?? "the current TCG Advanced format";
  const list = (a: { name: string; copies: number }[]) => (a.length ? a.map((e) => `${e.copies}x ${e.name}`).join(", ") : "(none)");
  const poolRule =
    opts.poolMode === "collection"
      ? "Use only cards the player owns (those already in this deck, or others from their collection) — don't add cards they don't own."
      : "You may use any card legal in the format.";
  const system = [
    `You are an expert Yu-Gi-Oh! deck builder discussing a deck you built for ${fmt}. Be concise and concrete.`,
    `Current deck "${opts.currentName}":`,
    `MAIN (${opts.current.main.reduce((s, e) => s + e.copies, 0)}): ${list(opts.current.main)}`,
    `EXTRA: ${list(opts.current.extra)}`,
    `SIDE: ${list(opts.current.side)}`,
    "The player will either ask a question or request a change.",
    '- Question only → answer in "reply", set "changed": false, and omit the deck arrays.',
    '- Change requested → apply it while keeping the deck legal (40–60 Main, ≤15 Extra/Side, ≤3 copies and banlist limits), every Extra Deck card summonable, and the five pillars healthy (consistency, resilience, disruption, resources, format fitness). Set "changed": true and return the FULL updated deck in mainDeck/extraDeck/sideDeck, and explain the change in "reply".',
    poolRule,
    'Respond with ONLY JSON: {"reply":string,"changed":boolean,"deckName":string,"strategy":string,"mainDeck":[{"name":string,"copies":number}],"extraDeck":[{"name":string,"copies":number}],"sideDeck":[{"name":string,"copies":number}]}. Use exact official English card names.',
  ].join("\n");
  const messages = [
    { role: "system", content: system },
    ...opts.history.slice(-8).map((h) => ({ role: h.role === "user" ? "user" : "assistant", content: h.content })),
    { role: "user", content: opts.message },
  ];
  const url = `${ENDPOINT}/models/chat/completions?api-version=${API_VERSION}`;
  const body = { model: DEPLOYMENT, max_completion_tokens: 8000, messages };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": KEY as string },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Azure refine HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const jsonStr = extractFirstJson(text);
    if (!jsonStr) return null;
    const p = JSON.parse(jsonStr) as Partial<RefineResult>;
    const clean = (arr: unknown): RawDeckEntry[] =>
      Array.isArray(arr)
        ? arr.map((e) => ({ name: String((e as RawDeckEntry)?.name ?? "").trim(), copies: Math.max(1, Math.round(Number((e as RawDeckEntry)?.copies) || 1)) })).filter((e) => e.name)
        : [];
    return {
      reply: String(p.reply ?? "").trim() || "(no reply)",
      changed: Boolean(p.changed),
      deckName: p.deckName ? String(p.deckName).trim().slice(0, 80) : undefined,
      strategy: p.strategy ? String(p.strategy).trim().slice(0, 800) : undefined,
      mainDeck: clean(p.mainDeck),
      extraDeck: clean(p.extraDeck),
      sideDeck: clean(p.sideDeck),
    };
  } catch (e) {
    console.error("Azure refine failed", e);
    return null;
  }
}
