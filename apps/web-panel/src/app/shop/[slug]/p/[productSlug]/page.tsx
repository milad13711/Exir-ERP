import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { fetchPublicStoreProduct, fetchPublicStoreInfo, fetchPublicStoreProducts } from "@/lib/api";
import { ProductClient } from "./ProductClient";
import { serializeJsonLd } from "@/lib/json-ld";

export const revalidate = 0;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}): Promise<Metadata> {
  const { slug, productSlug } = await params;
  const product = await fetchPublicStoreProduct(slug, productSlug).catch(() => null);
  if (!product) return {};
  const origin = await siteOrigin();
  const imageUrls = product.images.map((_, i) => `${origin}/api/public/store/${slug}/products/${productSlug}/image/${i}`);
  const description = (product.description ?? product.name).slice(0, 155);
  return {
    title: product.name,
    description,
    openGraph: {
      title: product.name,
      description,
      type: "website",
      url: `${origin}/shop/${slug}/p/${productSlug}`,
      images: imageUrls.length > 0 ? imageUrls.map((url) => ({ url, width: 1080, height: 1080 })) : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; productSlug: string }> }) {
  const { slug, productSlug } = await params;
  const [product, info, allProducts] = await Promise.all([
    fetchPublicStoreProduct(slug, productSlug).catch(() => null),
    fetchPublicStoreInfo(slug).catch(() => null),
    fetchPublicStoreProducts(slug).catch(() => []),
  ]);
  if (!product) notFound();

  const origin = await siteOrigin();
  const imageUrls = product.images.map((_, i) => `${origin}/api/public/store/${slug}/products/${productSlug}/image/${i}`);

  const relatedProducts = allProducts
    .filter((p) => p.slug !== productSlug && p.category && p.category === product.category)
    .slice(0, 4)
    .map((p) => ({ ...p, images: p.images.map((_, i) => `${origin}/api/public/store/${slug}/products/${p.slug}/image/${i}`) }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description ?? product.name,
    image: imageUrls,
    offers: {
      "@type": "Offer",
      price: product.price * 10,
      priceCurrency: "IRR",
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <ProductClient
        slug={slug}
        storeName={info?.name ?? "فروشگاه"}
        product={{ ...product, images: imageUrls }}
        relatedProducts={relatedProducts}
      />
    </>
  );
}
