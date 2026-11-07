"use client";

import { use } from "react";
import { ReleaseDetailView } from "@/components/releases/ReleaseDetailView";

export default function ReleaseDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <ReleaseDetailView code={code} />;
}
