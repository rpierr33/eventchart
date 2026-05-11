import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import GuestLookupClient from "./GuestLookupClient";

export default async function GuestEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ qr?: string }>;
}) {
  const { slug } = await params;
  const { qr } = await searchParams;

  const event = await db.event.findUnique({
    where: { publicSlug: slug },
    select: {
      id: true,
      name: true,
      venueName: true,
      status: true,
      lookupPrivacy: true,
      allowWalkIns: true,
      walkInMode: true,
      publicSlug: true,
      eventCode: true,
      layout: {
        select: {
          sourceImageUrl: true,
          sourceImageWidth: true,
          sourceImageHeight: true,
          tables: {
            select: {
              id: true,
              label: true,
              capacity: true,
              xPct: true,
              yPct: true,
              directionsText: true,
            },
          },
        },
      },
      qrCodes: qr ? {
        where: { id: qr },
        select: { id: true, label: true, scanOriginXPct: true, scanOriginYPct: true },
      } : undefined,
    },
  });
  if (!event) notFound();

  const qrInfo = qr && event.qrCodes ? event.qrCodes[0] : null;

  return (
    <GuestLookupClient
      slug={event.publicSlug}
      event={{
        name: event.name,
        venueName: event.venueName,
        status: event.status,
        lookupPrivacy: event.lookupPrivacy,
        allowWalkIns: event.allowWalkIns,
        walkInMode: event.walkInMode,
      }}
      qr={qrInfo}
      layout={event.layout}
    />
  );
}
