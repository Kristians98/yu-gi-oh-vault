import type { Attribute, Card, Condition, Frame, Rarity } from "@/lib/cards";

// Shape of an OwnedCard row with its printing + card joined in.
export type OwnedRow = {
  id: string;
  condition: string;
  quantity: number;
  forTrade: boolean;
  printingId: string;
  printing: {
    setName: string;
    setCode: string;
    rarity: string;
    card: {
      id: number;
      name: string;
      frame: string;
      attribute: string | null;
      typeLine: string;
      atk: number | null;
      def: number | null;
      level: number | null;
      desc: string;
      archetype: string | null;
      banTcg: string | null;
      banGoat: string | null;
      banEdison: string | null;
      handTrap: boolean;
      tcgDate: string | null;
    };
  };
};

/** Map a DB OwnedCard (with printing+card) into the display Card the UI renders. */
export function toDisplayCard(o: OwnedRow): Card {
  const c = o.printing.card;
  return {
    id: c.id,
    name: c.name,
    frame: c.frame as Frame,
    attribute: (c.attribute ?? undefined) as Attribute | undefined,
    typeLine: c.typeLine,
    atk: c.atk,
    def: c.def,
    level: c.level ?? undefined,
    setName: o.printing.setName,
    setCode: o.printing.setCode,
    rarity: o.printing.rarity as Rarity,
    condition: o.condition as Condition,
    quantity: o.quantity,
    forTrade: o.forTrade,
    desc: c.desc,
    archetype: c.archetype,
    banTcg: c.banTcg,
    banGoat: c.banGoat,
    banEdison: c.banEdison,
    handTrap: c.handTrap,
    tcgDate: c.tcgDate,
    ownedId: o.id,
    printingId: o.printingId,
  };
}
