export const YGOPRODECK_API: string;
export function normRarity(s: string | null | undefined): string;
export function normFrame(frameType?: string | null, race?: string | null, type?: string | null): string;
export function buildTypeLine(card: { race?: string | null }, frame: string): string;
export function printingKey(cardId: number, setCode: string, rarity: string): string;
