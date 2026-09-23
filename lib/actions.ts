"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/notify";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

export async function searchCards(q: string) {
  const needle = (q || "").trim();
  if (needle.length < 2) return [];
  const cards = await prisma.card.findMany({
    where: { name: { contains: needle } },
    take: 16,
    orderBy: { name: "asc" },
    include: { printings: { orderBy: [{ setCode: "asc" }] } },
  });
  return cards.map((c) => ({
    id: c.id,
    name: c.name,
    frame: c.frame,
    printings: c.printings.map((p) => ({
      id: p.id,
      setName: p.setName,
      setCode: p.setCode,
      rarity: p.rarity,
    })),
  }));
}

export async function addToCollection(input: {
  printingId: string;
  condition: string;
  quantity: number;
  forTrade: boolean;
}) {
  const userId = await requireUser();
  const qty = Math.max(1, Math.floor(input.quantity) || 1);
  await prisma.ownedCard.upsert({
    where: { userId_printingId_condition: { userId, printingId: input.printingId, condition: input.condition } },
    update: { quantity: { increment: qty }, forTrade: input.forTrade },
    create: { userId, printingId: input.printingId, condition: input.condition, quantity: qty, forTrade: input.forTrade },
  });

  const printing = await prisma.cardPrinting.findUnique({ where: { id: input.printingId }, include: { card: true } });
  const meUser = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
  if (printing && meUser) {
    await logActivity(userId, "ADDED_CARD", `${meUser.displayName || meUser.username} added ${printing.card.name}`, `/u/${meUser.username}`);
  }
  revalidatePath("/");
}

export async function removeOwnedCard(ownedId: string) {
  const userId = await requireUser();
  await prisma.ownedCard.deleteMany({ where: { id: ownedId, userId } });
  revalidatePath("/");
}

export async function setForTrade(ownedId: string, forTrade: boolean) {
  const userId = await requireUser();
  await prisma.ownedCard.updateMany({ where: { id: ownedId, userId }, data: { forTrade } });
  revalidatePath("/");
}

export async function setQuantity(ownedId: string, quantity: number) {
  const userId = await requireUser();
  if (quantity <= 0) {
    await prisma.ownedCard.deleteMany({ where: { id: ownedId, userId } });
  } else {
    await prisma.ownedCard.updateMany({ where: { id: ownedId, userId }, data: { quantity: Math.floor(quantity) } });
  }
  revalidatePath("/");
}

/** Search products/sets by name → distinct set names with their card counts. */
export async function searchSets(q: string) {
  const needle = (q || "").trim();
  if (needle.length < 2) return [];
  const groups = await prisma.cardPrinting.groupBy({
    by: ["setName"],
    where: { setName: { contains: needle } },
    _count: { _all: true },
  });
  return groups
    .map((g) => ({ setName: g.setName, count: g._count._all }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/** Add one of every card in a product/set to the collection. */
export async function addSet(setName: string) {
  const userId = await requireUser();
  const printings = await prisma.cardPrinting.findMany({ where: { setName }, select: { id: true } });
  if (printings.length === 0) return { added: 0, setName };
  // Add one copy of every card; STACK quantity on cards already owned, so a product
  // can be added multiple times (own 2 decks → 2 of each). SQLite createMany has no
  // upsert, so split: bump existing, create the rest.
  const ids = printings.map((p) => p.id);
  const existing = await prisma.ownedCard.findMany({ where: { userId, condition: "NM", printingId: { in: ids } }, select: { printingId: true } });
  const have = new Set(existing.map((e) => e.printingId));
  const toCreate = ids.filter((id) => !have.has(id));
  const toBump = ids.filter((id) => have.has(id));
  if (toBump.length) {
    await prisma.ownedCard.updateMany({ where: { userId, condition: "NM", printingId: { in: toBump } }, data: { quantity: { increment: 1 } } });
  }
  if (toCreate.length) {
    await prisma.ownedCard.createMany({ data: toCreate.map((id) => ({ userId, printingId: id, condition: "NM", quantity: 1, forTrade: false })) });
  }
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
  if (me) await logActivity(userId, "ADDED_SET", `${me.displayName || me.username} added ${setName} (${ids.length} cards)`, `/u/${me.username}`);
  revalidatePath("/");
  return { added: ids.length, setName };
}

// ---- CSV import (mirrors the binder's Export columns) ----

const IMPORT_CONDITIONS = new Set(["NM", "LP", "MP", "HP", "DMG"]);

function normRarityLabel(s: string): string {
  const x = (s || "").toLowerCase();
  if (x.includes("quarter")) return "QUARTER_CENTURY_SECRET_RARE";
  if (x.includes("starlight")) return "STARLIGHT_RARE";
  if (x.includes("ghost")) return "GHOST_RARE";
  if (x.includes("ultimate")) return "ULTIMATE_RARE";
  if (x.includes("secret")) return "SECRET_RARE";
  if (x.includes("ultra")) return "ULTRA_RARE";
  if (x.includes("super")) return "SUPER_RARE";
  if (x.includes("rare")) return "RARE";
  if (x.includes("common")) return "COMMON";
  return "";
}

// Minimal RFC-4180 CSV parser (quoted fields, escaped "" quotes, CR/LF).
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export type ImportResult = { imported: number; updated: number; skipped: number; errors: string[] };

/** Import a collection CSV (the format the binder's Export button produces). Resolves each
 *  row to a printing by Set Code (+rarity) then card name, and SETS the owned quantity —
 *  so re-importing the same file is idempotent (no double-counting). */
export async function importCollection(csv: string): Promise<ImportResult> {
  const userId = await requireUser();
  const rows = parseCsvRows(csv || "");
  if (rows.length < 2) return { imported: 0, updated: 0, skipped: 0, errors: ["No rows found in the file."] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col("name"), iQty = col("qty"), iCode = col("set code"), iRar = col("rarity"), iCond = col("condition"), iTrade = col("for trade");
  if (iName < 0) return { imported: 0, updated: 0, skipped: 0, errors: ['CSV is missing a "Name" column.'] };

  type Rec = { name: string; qty: number; setCode: string; rarity: string; condition: string; forTrade: boolean };
  const records: Rec[] = [];
  for (let r = 1; r < rows.length; r++) {
    const c = rows[r];
    if (!c.length || !c.join("").trim()) continue;
    const name = (c[iName] || "").trim();
    if (!name) continue;
    let condition = (iCond >= 0 ? c[iCond] || "" : "").trim().toUpperCase();
    if (!IMPORT_CONDITIONS.has(condition)) condition = "NM";
    records.push({
      name,
      qty: Math.max(1, Math.round(Number(iQty >= 0 ? c[iQty] : 1) || 1)),
      setCode: iCode >= 0 ? (c[iCode] || "").trim() : "",
      rarity: iRar >= 0 ? normRarityLabel(c[iRar] || "") : "",
      condition,
      forTrade: iTrade >= 0 ? /^(y|yes|true|1)$/i.test((c[iTrade] || "").trim()) : false,
    });
  }
  if (!records.length) return { imported: 0, updated: 0, skipped: 0, errors: ["No card rows found."] };

  // Batch-resolve printings (one query, not one per row).
  const codes = [...new Set(records.map((r) => r.setCode).filter(Boolean))];
  const names = [...new Set(records.map((r) => r.name))];
  const printings = await prisma.cardPrinting.findMany({
    where: { OR: [{ setCode: { in: codes } }, { card: { name: { in: names } } }] },
    select: { id: true, setCode: true, rarity: true, card: { select: { name: true } } },
  });
  const byCodeRar = new Map<string, string>(), byCode = new Map<string, string>(), byNameRar = new Map<string, string>(), byName = new Map<string, string>();
  for (const p of printings) {
    const nl = p.card.name.toLowerCase();
    if (p.setCode) { byCodeRar.set(`${p.setCode}|${p.rarity}`, p.id); if (!byCode.has(p.setCode)) byCode.set(p.setCode, p.id); }
    byNameRar.set(`${nl}|${p.rarity}`, p.id);
    if (!byName.has(nl)) byName.set(nl, p.id);
  }
  const resolve = (r: Rec): string | undefined => {
    if (r.setCode) {
      if (r.rarity && byCodeRar.has(`${r.setCode}|${r.rarity}`)) return byCodeRar.get(`${r.setCode}|${r.rarity}`);
      if (byCode.has(r.setCode)) return byCode.get(r.setCode);
    }
    const nl = r.name.toLowerCase();
    if (r.rarity && byNameRar.has(`${nl}|${r.rarity}`)) return byNameRar.get(`${nl}|${r.rarity}`);
    return byName.get(nl);
  };

  const existing = await prisma.ownedCard.findMany({ where: { userId }, select: { id: true, printingId: true, condition: true } });
  const ownedKey = new Map<string, string>();
  for (const o of existing) ownedKey.set(`${o.printingId}|${o.condition}`, o.id);

  const errors: string[] = [];
  let skipped = 0;
  const toCreate = new Map<string, { userId: string; printingId: string; condition: string; quantity: number; forTrade: boolean }>();
  const toUpdate = new Map<string, { id: string; quantity: number; forTrade: boolean }>();
  for (const r of records) {
    const printingId = resolve(r);
    if (!printingId) { skipped++; if (errors.length < 12) errors.push(`Couldn't match "${r.name}"${r.setCode ? ` (${r.setCode})` : ""}.`); continue; }
    const key = `${printingId}|${r.condition}`;
    const existingId = ownedKey.get(key);
    if (existingId) toUpdate.set(key, { id: existingId, quantity: r.qty, forTrade: r.forTrade });
    else toCreate.set(key, { userId, printingId, condition: r.condition, quantity: r.qty, forTrade: r.forTrade });
  }

  const creates = [...toCreate.values()];
  for (let i = 0; i < creates.length; i += 500) await prisma.ownedCard.createMany({ data: creates.slice(i, i + 500) });
  const updates = [...toUpdate.values()];
  for (let i = 0; i < updates.length; i += 25) {
    await Promise.all(updates.slice(i, i + 25).map((u) => prisma.ownedCard.update({ where: { id: u.id }, data: { quantity: u.quantity, forTrade: u.forTrade } })));
  }

  revalidatePath("/");
  return { imported: creates.length, updated: updates.length, skipped, errors };
}
