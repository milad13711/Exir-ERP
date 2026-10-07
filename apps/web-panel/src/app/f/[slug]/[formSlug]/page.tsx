import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { fetchPublicForm, publicFormCoverImageUrl } from "@/lib/api";
import { FormFillClient, type EmbedOptions } from "./FormFillClient";

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

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** query ورودی حالت جاسازی را (که اسکریپت embed می‌سازد) به گزینه‌های امن تبدیل می‌کند. */
function parseEmbed(sp: SP): EmbedOptions {
  const enabled = first(sp.embed) === "1";
  const theme = first(sp.theme);
  const lang = first(sp.lang);
  const primary = (first(sp.primary) ?? "").match(/^[0-9a-fA-F]{3,8}$/)?.[0] ?? null;
  const http = (v: string | undefined) => (v && /^https?:\/\//i.test(v) ? v.slice(0, 500) : null);
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = first(sp[k]);
    if (v) utm[k] = v.slice(0, 200);
  }
  return {
    enabled,
    theme: theme === "dark" || theme === "auto" ? theme : "light",
    lang: lang === "en" ? "en" : "fa",
    primary: enabled ? primary : null,
    successMessage: enabled ? (first(sp.sm)?.slice(0, 300) ?? null) : null,
    hideTitle: enabled && first(sp.hideTitle) === "1",
    sourceUrl: enabled ? http(first(sp.src)) : null,
    referrer: enabled ? http(first(sp.ref)) : null,
    utm: enabled ? utm : {},
  };
}

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ slug: string; formSlug: string }>; searchParams: Promise<SP> }) {
  const { slug, formSlug } = await params;
  const embed = parseEmbed(await searchParams);
  const form = await fetchPublicForm(slug, formSlug).catch(() => null);
  if (!form) notFound();
  return <FormFillClient tenantSlug={slug} formSlug={formSlug} form={form} embed={embed} />;
}
