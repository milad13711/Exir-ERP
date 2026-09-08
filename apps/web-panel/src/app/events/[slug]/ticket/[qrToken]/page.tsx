import { notFound } from "next/navigation";
import { fetchPublicEventTicket } from "@/lib/api";
import { TicketViewClient } from "./TicketViewClient";

export const revalidate = 0;

export default async function TicketPage({ params }: { params: Promise<{ slug: string; qrToken: string }> }) {
  const { slug, qrToken } = await params;
  const ticket = await fetchPublicEventTicket(slug, qrToken).catch(() => null);
  if (!ticket) notFound();
  return <TicketViewClient tenantSlug={slug} ticket={ticket} />;
}
