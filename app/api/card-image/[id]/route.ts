import type { NextRequest } from "next/server";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Proxy + disk-cache for YGOPRODeck card art, so the browser never hot-links
// their CDN (their API policy) and repeat loads are served locally.
const DIR = join(process.cwd(), ".cache", "cards");

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response("bad id", { status: 400 });
  const small = req.nextUrl.searchParams.get("s") === "1";
  const file = join(DIR, `${id}${small ? "_s" : ""}.jpg`);

  try {
    let buf: Buffer;
    if (existsSync(file)) {
      buf = await readFile(file);
    } else {
      const url = `https://images.ygoprodeck.com/images/cards${small ? "_small" : ""}/${id}.jpg`;
      const res = await fetch(url);
      if (!res.ok) return new Response("not found", { status: res.status });
      buf = Buffer.from(await res.arrayBuffer());
      await mkdir(DIR, { recursive: true }).catch(() => {});
      await writeFile(file, buf).catch(() => {});
    }
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable" },
    });
  } catch {
    return new Response("error", { status: 500 });
  }
}
