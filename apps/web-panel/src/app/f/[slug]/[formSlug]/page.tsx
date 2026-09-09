import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { fetchPublicForm, publicFormCoverImageUrl } from "@/lib/api";
import { FormFillClient } from "./FormFillClient";

export const revalidate = 0;

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; formSlug: string }> }): Promise<Metadata> {
  const { slug, formSlug } = await params;
  const form = await fetchPublicForm(slug, formSlug).catch(() => null);
  if (!form) return {};
  const description = form.description?.slice(0, 200) ?? form.title;
  const origin = await siteOrigin();
  return {
    title: form.title,
    description,
    openGraph: {
      title: form.title,
      description,
      type: "website",
      images: form.coverImage ? [{ url: publicFormCoverImageUrl(slug, formSlug) }] : undefined,
      url: `${origin}/f/${slug}/${formSlug}`,
    },
  };
}

export default async function PublicFormPage({ params }: { params: Promise<{ slug: string; formSlug: string }> }) {
  const { slug, formSlug } = await params;
  const form = await fetchPublicForm(slug, formSlug).catch(() => null);
  if (!form) notFound();
  return <FormFillClient tenantSlug={slug} formSlug={formSlug} form={form} />;
}
