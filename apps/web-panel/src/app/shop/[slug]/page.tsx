import type { Metadata } from "next";
import { headers } from "next/headers";
import { fetchPublicStoreInfo, fetchPublicStoreProducts } from "@/lib/api";
import { StorefrontClient } from "./StorefrontClient";

export const revalidate = 0;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const info = await fetchPublicStoreInfo(slug).catch(() => null);
  if (!info) return {};
  const title = `فروشگاه ${info.name}`;
  const description = `خرید آنلاین از ${info.name} — مشاهده و سفارش محصولات به‌سادگی.`;
  const origin = await siteOrigin();
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: info.logoUrl ? [{ url: info.logoUrl }] : undefined,
      url: `${origin}/shop/${slug}`,
    },
  };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [info, products] = await Promise.all([
    fetchPublicStoreInfo(slug).catch(() => null),
    fetchPublicStoreProducts(slug).catch(() => []),
  ]);

  const origin = await siteOrigin();
  const productsWithImageUrls = products.map((p) => ({
    ...p,
    images: p.images.map((_, i) => `${origin}/api/public/store/${slug}/products/${p.slug}/image/${i}`),
  }));

  return <StorefrontClient slug={slug} info={info} products={productsWithImageUrls} />;
}
