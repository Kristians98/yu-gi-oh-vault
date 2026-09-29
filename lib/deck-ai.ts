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

/** `reasoning_effort` to send for a deployment: env override, else "low" for GPT-5 / o-series,
 *  else nothing (gpt-4o and friends reject the parameter). */
export function reasoningEffortFor(deployment: string | undefined): string | null {
  const env = (process.env.AZURE_AI_DECK_REASONING || "").trim().toLowerCase();
  if (env === "off" || env === "none") return null;
  if (["minimal", "low", "medium", "high"].includes(env)) return env;
  const d = (deployment || "").toLowerCase();
  return /gpt-5|^o\d/.test(d) ? "low" : null;
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
export type BuildOutcome = { deck: RawDeck } | { deck: null; error: string };
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
  // Play constraints (all optional):
  banned?: string[]; // must not appear
  pinned?: string[]; // must appear
  mutatorLines?: string[]; // extra hard rules, already phrased for the prompt
  current?: { name: string; strategy: string; main: RawDeckEntry[]; extra: RawDeckEntry[]; side: RawDeckEntry[] }; // patch mode
}): Promise<BuildOutcome> {
  if (!deckAiConfigured()) return { deck: null, error: "AI isn't configured (AZURE_AI_ENDPOINT / AZURE_AI_KEY / deployment)." };

  const fmt = FORMAT_LABEL[opts.format] ?? "the current TCG Advanced format";
  const poolRule =
    opts.poolMode === "collection"
      ? "You may use ONLY cards from the player's legal collection listed below, and never more copies of a card than they own. Do not invent cards that are not in the list."
      : "You may use any card that is legal in this format (Forbidden cards for this format are banned).";
  const strategyLine = opts.strategy.trim()
    ? `The player asked for this strategy/theme: "${opts.strategy.trim()}". Build around it.`
    : "Choose a strong, coherent strategy that suits the format.";
  const banned = (opts.banned ?? []).filter(Boolean);
  const pinned = (opts.pinned ?? []).filter(Boolean);
  const constraintLines = [
    ...(banned.length ? [`- BANNED for this deck (must NOT appear anywhere, not even in the Side Deck): ${banned.join("; ")}.`] : []),
    ...(pinned.length ? [`- MUST INCLUDE these cards in the Main or Extra Deck (at least 1 copy each, more if it helps): ${pinned.join("; ")}.`] : []),
    ...(opts.mutatorLines ?? []).map((l) => `- ${l}`),
  ];
  const list = (a: RawDeckEntry[]) => (a.length ? a.map((e) => `${e.copies}x ${e.name}`).join(", ") : "(none)");
  const patchLines = opts.current
    ? [
        `PATCH MODE — start from the player's current deck "${opts.current.name}" and change as little as possible:`,
        `  MAIN: ${list(opts.current.main)}`,
        `  EXTRA: ${list(opts.current.extra)}`,
        `  SIDE: ${list(opts.current.side)}`,
        "  Remove any banned cards, add any must-include cards, then only swap/fill what is needed to keep the deck legal (40 Main) and coherent. Keep the deck name and strategy unless the change forces a new plan.",
        ...(opts.current.strategy ? [`  Current strategy: ${opts.current.strategy}`] : []),
      ]
    : [];

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
    ...(constraintLines.length ? ["Extra HARD rules for this build:", ...constraintLines] : []),
    ...patchLines,
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
  const body: Record<string, unknown> = {
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
  // Reasoning models: a 600-card pool + a 40-card answer at default effort can run long enough
  // for Azure to give up with a 500. Low effort is plenty for deck building and ~3x faster.
  // AZURE_AI_DECK_REASONING overrides (minimal|low|medium|high, or "off" to send nothing).
  const reasoning = reasoningEffortFor(DEPLOYMENT);
  if (reasoning) body.reasoning_effort = reasoning;

  // Azure can answer 429 (tokens-per-minute quota — e.g. two duelists drawing at once) or a
  // transient 5xx. Retry those a couple of times, honouring Retry-After, while staying inside
  // the 60s the page allows.
  const startedAt = Date.now();
  let res: Response | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const payload = JSON.stringify(body);
      if (attempt === 0) console.info("Azure deck request", { deployment: DEPLOYMENT, reasoning: body.reasoning_effort ?? null, chars: payload.length });
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": KEY as string },
        body: payload,
        signal: AbortSignal.timeout(50_000),
      });
    } catch (e) {
      lastErr = e instanceof Error && e.name === "TimeoutError" ? "the model took longer than 50s" : `network error (${e instanceof Error ? e.message : String(e)})`;
      console.error("Azure deck fetch failed", e);
      res = null;
    }
    if (res?.ok) break;
    if (res) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      console.error("Azure deck HTTP", res.status, text);
      // A deployment that doesn't know `reasoning_effort` answers 400 — drop it and go again.
      if (res.status === 400 && body.reasoning_effort && /reasoning_effort/i.test(text)) {
        delete body.reasoning_effort;
        res = null;
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = res.status === 429 ? "Azure rate limit (429) — the deployment's tokens-per-minute quota is used up" : `Azure returned HTTP ${res.status}${text ? ` — ${text.replace(/\s+/g, " ").slice(0, 140)}` : ""}`;
      if (!retryable) return { deck: null, error: lastErr };
      const after = Number(res.headers.get("retry-after"));
      // 5xx: Azure's transient errors usually clear within seconds; give them a real pause.
      const wait = Math.min(15_000, Number.isFinite(after) && after > 0 ? after * 1000 : res.status === 429 ? 4000 * (attempt + 1) : 6000 * (attempt + 1));
      if (Date.now() - startedAt + wait > 32_000) break; // no room left for another full attempt
      await new Promise((r) => setTimeout(r, wait));
      res = null;
      continue;
    }
    break; // network/timeout error: don't stack another 50s wait
  }
  if (!res?.ok) return { deck: null, error: `The deck builder failed: ${lastErr || "no response"}. Try again in a minute.` };

  try {
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const jsonStr = extractFirstJson(text);
    if (!jsonStr) {
      console.error("Azure deck: no JSON in reply", text.slice(0, 300));
      return { deck: null, error: "The model replied without a deck (no JSON). Try again." };
    }
    const parsed = JSON.parse(jsonStr) as Partial<RawDeck>;
    const clean = (arr: unknown): RawDeckEntry[] =>
      Array.isArray(arr)
        ? arr
            .map((e) => ({ name: String((e as RawDeckEntry)?.name ?? "").trim(), copies: Math.max(1, Math.round(Number((e as RawDeckEntry)?.copies) || 1)) }))
            .filter((e) => e.name)
        : [];
    return {
      deck: {
        deckName: String(parsed.deckName ?? "Untitled Deck").trim().slice(0, 80) || "Untitled Deck",
        strategy: String(parsed.strategy ?? "").trim().slice(0, 800),
        mainDeck: clean(parsed.mainDeck),
        extraDeck: clean(parsed.extraDeck),
        sideDeck: clean(parsed.sideDeck),
      },
    };
  } catch (e) {
    console.error("Azure deck build failed", e);
    return { deck: null, error: `The model's reply couldn't be read (${e instanceof Error ? e.message : "parse error"}). Try again.` };
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
