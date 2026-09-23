/** Cron routes accept Vercel Cron's `Authorization: Bearer <CRON_SECRET>` or a manual
 *  `x-cron-secret` header. With no CRON_SECRET configured every call is refused. */
export function cronAuthed(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}` || req.headers.get("x-cron-secret") === secret;
}
