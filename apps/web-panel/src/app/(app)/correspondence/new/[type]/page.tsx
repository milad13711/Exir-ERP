"use client";

import { use } from "react";
import { CorrShell } from "@/components/correspondence/CorrShell";
import { LetterEditor } from "@/components/correspondence/LetterEditor";
import Link from "next/link";

export default function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params);
  const t = type === "internal" ? "INTERNAL" : "OUTGOING";
  return (
    <CorrShell active={t === "INTERNAL" ? "internal" : "outgoing"} title={t === "INTERNAL" ? "نامه‌ی داخلی جدید" : "نامه‌ی صادره‌ی جدید"}
      actions={<Link href={t === "INTERNAL" ? "/correspondence/new/outgoing" : "/correspondence/new/internal"} className="text-[12.5px] text-primary underline min-h-[40px] inline-flex items-center">{t === "INTERNAL" ? "نامه‌ی صادره" : "نامه‌ی داخلی"}</Link>}>
      <LetterEditor type={t} />
    </CorrShell>
  );
}
