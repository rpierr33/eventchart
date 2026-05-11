import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { subscribe } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return new Response("Unauthorized", { status: 401 }); }
  const ev = await db.event.findUnique({ where: { id }, select: { hostUserId: true } });
  if (!ev || ev.hostUserId !== userId) return new Response("Not found", { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      send({ type: "hello" });

      const interval = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 25000);

      const unsubscribe = subscribe(id, (payload) => send(payload));

      const close = () => {
        clearInterval(interval);
        unsubscribe();
        try { controller.close(); } catch { /* */ }
      };

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
