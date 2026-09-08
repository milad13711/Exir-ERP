import { BookingStatusClient } from "./BookingStatusClient";

export default async function EventBookingStatusPage({ params }: { params: Promise<{ slug: string; bookingId: string }> }) {
  const { slug, bookingId } = await params;
  return <BookingStatusClient tenantSlug={slug} bookingId={bookingId} />;
}
