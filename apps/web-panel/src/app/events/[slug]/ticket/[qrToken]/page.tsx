import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { fetchPublicEventTicket } from "@/lib/api";
import { TicketViewClient } from "./TicketViewClient";

export const revalidate = 0;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export default async function TicketPage({ params }: { params: Promise<{ slug: string; qrToken: string }> }) {
  const { slug, qrToken } = await params;
  const ticket = await fetchPublicEventTicket(slug, qrToken).catch(() => null);
  if (!ticket) notFound();
  const origin = await siteOrigin();
  return <TicketViewClient tenantSlug={slug} ticket={ticket} shareUrl={`${origin}/events/${slug}/ticket/${qrToken}`} />;
}
