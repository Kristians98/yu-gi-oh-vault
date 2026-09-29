// Client-safe: how hard the deck AI should think. Maps to `reasoning_effort` in lib/deck-ai.ts.
// Measured on gpt-5.6 with a 600-card pool: fast ≈ 6s, careful ≈ 50s (close to the 60s limit
// a Vercel Hobby function gets, so careful can time out on a bad day).

export type Thinking = "fast" | "careful";

export const THINKING: Record<Thinking, { label: string; blurb: string }> = {
  fast: { label: "Fast", blurb: "No visible reasoning — a deck in a few seconds. Good enough for most builds." },
  careful: { label: "Careful", blurb: "Lets the model reason before answering — better synergy, but ~10x slower and may hit the 60s limit." },
};

export const normalizeThinking = (t: unknown): Thinking => (t === "careful" ? "careful" : "fast");
