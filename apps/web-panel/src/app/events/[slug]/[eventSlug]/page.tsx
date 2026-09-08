import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { fetchPublicEvent, publicEventCoverImageUrl, type PublicEventItem } from "@/lib/api";
import { EventDetailClient } from "./EventDetailClient";

function computeRegistrationStatus(event: PublicEventItem): "open" | "not_open" | "closed" {
  const now = Date.now();
  const opensAt = event.registrationOpensAt ? new Date(event.registrationOpensAt).getTime() : null;
  const closesAt = event.registrationClosesAt ? new Date(event.registrationClosesAt).getTime() : null;
  if (opensAt != null && now < opensAt) return "not_open";
  if (closesAt != null && now > closesAt) return "closed";
  return "open";
}

export const revalidate = 0;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; eventSlug: string }> }): Promise<Metadata> {
  const { slug, eventSlug } = await params;
  const event = await fetchPublicEvent(slug, eventSlug).catch(() => null);
  if (!event) return {};
  const description = event.description?.slice(0, 200) ?? `رزرو بلیط رویداد ${event.title}`;
  const origin = await siteOrigin();
  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      type: "website",
      images: event.coverImage ? [{ url: publicEventCoverImageUrl(slug, eventSlug) }] : undefined,
      url: `${origin}/events/${slug}/${eventSlug}`,
    },
  };
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string; eventSlug: string }> }) {
  const { slug, eventSlug } = await params;
  const event = await fetchPublicEvent(slug, eventSlug).catch(() => null);
  if (!event) notFound();
  const origin = await siteOrigin();
  const registrationStatus = computeRegistrationStatus(event);

  return (
    <EventDetailClient tenantSlug={slug} event={event} shareUrl={`${origin}/events/${slug}/${eventSlug}`} registrationStatus={registrationStatus} />
  );
}
