import { notFound } from "next/navigation";
import { fetchPublicSalesInvoice } from "@/lib/api";
import { PublicInvoiceClient } from "./PublicInvoiceClient";

export const revalidate = 0;

export default async function PublicInvoicePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const invoice = await fetchPublicSalesInvoice(slug, token).catch(() => null);
  if (!invoice) notFound();
  return <PublicInvoiceClient tenantSlug={slug} token={token} invoice={invoice} />;
}
