import type { Metadata } from "next";
import { PublicProjectClient } from "./PublicProjectClient";

export const metadata: Metadata = {
  title: "پیگیری پروژه",
  robots: { index: false, follow: false },
};

/** داده از مرورگر مشتری خوانده می‌شود (نه در سرور Next) — مثل صفحه‌ی عمومی پروپوزال. */
export default async function PublicProjectPage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  return <PublicProjectClient slug={slug} token={token} />;
}
