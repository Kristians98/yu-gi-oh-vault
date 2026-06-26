// Server-only: Azure AI (gpt-4o-mini) vision — reads a Yu-Gi-Oh! card photo and
// returns its name + printed passcode + set code. Imported only by server actions.
// Credentials come from env (never shipped to the client).

const ENDPOINT = process.env.AZURE_AI_ENDPOINT?.replace(/\/$/, "");
const KEY = process.env.AZURE_AI_KEY;
const DEPLOYMENT = process.env.AZURE_AI_DEPLOYMENT;
const API_VERSION = process.env.AZURE_AI_API_VERSION || "2024-05-01-preview";

export function aiConfigured(): boolean {
  return Boolean(ENDPOINT && KEY && DEPLOYMENT);
}

export type AiCardGuess = { name?: string; passcode?: number; setCode?: string };

const SYSTEM = [
  "You identify Yu-Gi-Oh! Trading Card Game cards from a photo.",
  'Respond with ONLY compact JSON: {"name": string, "passcode": string, "setCode": string}.',
  "name: the card's English name as printed at the top.",
  "passcode: the 8-digit number at the bottom-left of the card (digits only; empty string if unreadable).",
  "setCode: the code at the bottom-right, e.g. LOB-EN001 (empty string if unreadable).",
  "Do not add commentary or markdown — JSON only.",
].join(" ");

export async function identifyCardFromImage(dataUrl: string): Promise<AiCardGuess | null> {
  if (!aiConfigured()) return null;
  const url = `${ENDPOINT}/models/chat/completions?api-version=${API_VERSION}`;
  const body = {
    model: DEPLOYMENT,
    temperature: 0,
    max_tokens: 200,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Identify this Yu-Gi-Oh! card. JSON only." },
          { type: "image_url", image_url: { url: dataUrl } },
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
    const parsed = JSON.parse(match[0]) as { name?: string; passcode?: string; setCode?: string };
    const digits = String(parsed.passcode ?? "").replace(/\D/g, "");
    return {
      name: parsed.name?.trim() || undefined,
      passcode: /^\d{6,8}$/.test(digits) ? Number(digits) : undefined,
      setCode: parsed.setCode?.trim() || undefined,
    };
  } catch (e) {
    console.error("Azure vision failed", e);
    return null;
  }
}
