"use client";

import { use } from "react";
import Link from "next/link";
import { CorrShell } from "@/components/correspondence/CorrShell";
import { LetterDetailView } from "@/components/correspondence/LetterDetailView";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <CorrShell active="none" title="نامه" actions={<Link href="/correspondence" className="text-[12.5px] text-primary underline min-h-[40px] inline-flex items-center">بازگشت به کارتابل</Link>}>
      <LetterDetailView id={id} />
    </CorrShell>
  );
}
