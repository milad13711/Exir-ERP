import type { ReactNode } from "react";
import { PublicCurrencyBoundary } from "@/components/PublicCurrencyBoundary";

export default async function PublicCurrencyLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicCurrencyBoundary slug={slug}>{children}</PublicCurrencyBoundary>;
}
