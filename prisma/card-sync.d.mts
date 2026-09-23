import type { PrismaClient } from "@prisma/client";

export interface SyncSummary {
  fetched: number;
  newCards: number;
  newPrintings: number;
  tagUpdates: number;
  sampleNewCards: string[];
  ms: number;
}

export function fetchCards(opts?: { since?: string }): Promise<unknown[]>;
export function syncCards(
  prisma: PrismaClient,
  opts?: { data?: unknown[]; since?: string; log?: (msg: string) => void },
): Promise<SyncSummary>;
