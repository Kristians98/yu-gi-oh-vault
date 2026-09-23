// Server-only: Azure AI (gpt-4o-mini) vision — reads a Yu-Gi-Oh! card photo and returns
// everything it can see about the card. Imported only by server actions. Credentials come
// from env (never shipped to the client). Matching against the DB happens in lib/scan.ts
// using lib/fuzzy.ts — the model is only asked to *read*, not to *decide*.

import type { ScanGuess } from "@/lib/fuzzy";

const ENDPOINT = process.env.AZURE_AI_ENDPOINT?.replace(/\/$/, "");
const KEY = process.env.AZURE_AI_KEY;
const DEPLOYMENT = process.env.AZURE_AI_DEPLOYMENT;
const API_VERSION = process.env.AZURE_AI_API_VERSION || "2024-05-01-preview";

export function aiConfigured(): boolean {
  return Boolean(ENDPOINT && KEY && DEPLOYMENT);
}

const SYSTEM = [
  "You read Yu-Gi-Oh! Trading Card Game cards from a photo. Report only what is visibly printed; never guess from memory.",
  "Respond with ONLY compact JSON, no markdown, with these keys:",
  '"name": the card name printed at the top, exactly as spelled (string).',
  '"nameConfidence": 0..1 — how clearly you could read the name (1 = every letter sharp, 0.3 = partly obscured/blurry).',
  '"frame": the card\'s border colour class: "normal" (yellow monster), "effect" (orange), "ritual" (blue), "fusion" (purple), "synchro" (white), "xyz" (black), "link" (dark blue with arrows), "spell" (green), "trap" (pink/magenta), or "" if unsure.',
  '"attribute": the attribute icon at the top right for monsters — one of DARK, LIGHT, WATER, FIRE, EARTH, WIND, DIVINE — or "" (spells/traps).',
  '"race": the first word(s) in the [brackets] of the type line, e.g. "Dragon", "Spellcaster", "Warrior"; for spells/traps the icon kind: "Normal", "Quick-Play", "Continuous", "Equip", "Field", "Ritual", "Counter"; "" if unreadable.',
  '"level": number of level/rank stars (or link rating) as an integer, or null.',
  '"atk" and "def": integers from the ATK/DEF line, or null (Link monsters have no DEF).',
  '"passcode": the 8-digit number at the bottom-left, digits only, "" if unreadable. Do not fill in a passcode you cannot read.',
  '"setCode": the code at the bottom-right such as LOB-EN001, "" if unreadable.',
].join(" ");

export async function identifyCardFromImage(dataUrl: string): Promise<ScanGuess | null> {
  if (!aiConfigured()) return null;
  const url = `${ENDPOINT}/models/chat/completions?api-version=${API_VERSION}`;
  const body = {
    model: DEPLOYMENT,
    temperature: 0,
    max_tokens: 300,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this Yu-Gi-Oh! card. JSON only." },
          // "high" detail lets the model resolve the small passcode/set-code print.
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": KEY as string },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Azure vision HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]) as Record<string, unknown>;
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");
    const int = (k: string) => {
      const n = typeof p[k] === "number" ? p[k] : parseInt(String(p[k] ?? ""), 10);
      return Number.isFinite(n) ? (n as number) : null;
    };
    const digits = str("passcode").replace(/\D/g, "");
    const conf = typeof p.nameConfidence === "number" ? Math.max(0, Math.min(1, p.nameConfidence)) : undefined;
    return {
      name: str("name") || undefined,
      nameConfidence: conf,
      frame: str("frame").toLowerCase() || undefined,
      attribute: str("attribute").toUpperCase() || undefined,
      race: str("race") || undefined,
      level: int("level"),
      atk: int("atk"),
      def: int("def"),
      passcode: /^\d{8}$/.test(digits) ? Number(digits) : undefined,
      setCode: str("setCode").toUpperCase() || undefined,
    };
  } catch (e) {
    console.error("Azure vision failed", e);
    return null;
  }
}
