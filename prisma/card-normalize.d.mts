export const YGOPRODECK_API: string;
export function normRarity(s: string | null | undefined): string;
export function normFrame(frameType?: string | null, race?: string | null, type?: string | null): string;
export function buildTypeLine(card: { race?: string | null }, frame: string): string;
export function printingKey(cardId: number, setCode: string, rarity: string): string;

export interface CardRow {
  id: number; name: string; frame: string; attribute: string | null; typeLine: string; race: string | null;
  atk: number | null; def: number | null; level: number | null; desc: string;
  archetype: string | null; banTcg: string | null; banGoat: string | null; banEdison: string | null;
  handTrap: boolean; tcgDate: string | null; linkval: number | null; isTuner: boolean;
}
export interface PrintingRow { cardId: number; setName: string; setCode: string; rarity: string }
export function toCardRow(c: unknown): CardRow;
export function toPrintingRows(c: unknown): PrintingRow[];
