import { auth } from "@/auth";
import { subscribe } from "@/lib/events";

export const dynamic = "force-dynamic";

// Server-Sent Events: one long-lived stream per signed-in user. The client
// (components/realtime.tsx) refreshes when anything is published to their channel.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("unauthorized", { status: 401 });
  const userId = session.user.id;
  const enc = new TextEncoder();
  let unsub = () => {};
  let keepalive: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* closed */
        }
      };
      send({ type: "hello" });
      unsub = subscribe(userId, send);
      keepalive = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ka\n\n"));
        } catch {
          /* closed */
        }
      }, 25000);
      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(keepalive);
      unsub();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
