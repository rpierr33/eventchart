import { db } from "@/lib/db";
import { subscribe } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public SSE stream — no auth. Drives live updates on the guest lookup view
// so a guest who scanned and saw T7 sees T3 the moment the planner moves them.
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({ where: { publicSlug: slug }, select: { id: true } });
  if (!event) return new Response("Not found", { status: 404 });

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

      const unsubscribe = subscribe(event.id, (payload) => send(payload));

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
