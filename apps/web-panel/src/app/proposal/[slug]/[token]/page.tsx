import type { Metadata } from "next";
import { PublicProposalClient } from "./PublicProposalClient";

export const metadata: Metadata = {
  title: "پروپوزال",
  robots: { index: false, follow: false },
};

/**
 * داده‌ی پروپوزال عمداً از مرورگر مشتری خوانده می‌شود (نه در سرور Next): هم IP/مرورگر واقعی بازدید ثبت می‌شود و هم
 * ربات‌های پیش‌نمایش لینک (پیام‌رسان‌ها) که JS اجرا نمی‌کنند «بازدید مشتری» حساب نمی‌شوند.
 */
export default async function PublicProposalPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  return <PublicProposalClient slug={slug} token={token} />;
}
