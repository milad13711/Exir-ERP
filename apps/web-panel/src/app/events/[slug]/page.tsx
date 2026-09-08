import type { Metadata } from "next";
import { headers } from "next/headers";
import { fetchPublicEvents } from "@/lib/api";
import { EventsLandingClient } from "./EventsLandingClient";

export const revalidate = 0;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const events = await fetchPublicEvents(slug).catch(() => null);
  if (!events) return {};
  const title = "رویدادهای پیش رو";
  const description = `${events.length} رویداد پیش رو — مشاهده جزئیات و رزرو بلیط آنلاین.`;
  const origin = await siteOrigin();
  return {
    title,
    description,
    openGraph: { title, description, type: "website", url: `${origin}/events/${slug}` },
  };
}

export default async function EventsLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const events = await fetchPublicEvents(slug).catch(() => []);
  return <EventsLandingClient tenantSlug={slug} events={events} />;
}
