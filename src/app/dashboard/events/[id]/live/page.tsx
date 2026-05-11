import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import LiveView from "./LiveView";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) redirect("/login");

  const { id } = await params;
  const event = await db.event.findUnique({
    where: { id },
    select: { id: true, name: true, hostUserId: true, status: true, publicSlug: true },
  });
  if (!event || event.hostUserId !== userId) notFound();

  return <LiveView eventId={event.id} eventName={event.name} publicSlug={event.publicSlug} initialStatus={event.status} />;
}
