/** Case-insensitive `contains` filter that works on both datasources.
 *  SQLite's LIKE is already case-insensitive and its Prisma client rejects `mode`;
 *  Postgres is case-sensitive unless `mode: "insensitive"` is passed. */
export function containsCI(needle: string): { contains: string; mode?: "insensitive" } {
  const postgres = /^postgres/i.test(process.env.DATABASE_URL ?? "");
  return postgres ? { contains: needle, mode: "insensitive" } : { contains: needle };
}

/** `in` filter, case-insensitive on Postgres (mode: "insensitive"); exact on SQLite, whose client rejects `mode`. */
export function inCI(values: string[]): { in: string[]; mode?: "insensitive" } {
  const postgres = /^postgres/i.test(process.env.DATABASE_URL ?? "");
  return postgres ? { in: values, mode: "insensitive" } : { in: values };
}
