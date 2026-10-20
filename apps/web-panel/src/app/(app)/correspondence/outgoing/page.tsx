"use client";

import { CorrShell } from "@/components/correspondence/CorrShell";
import { LetterList } from "@/components/correspondence/LetterList";

export default function Page() {
  return (
    <CorrShell active="outgoing">
      <LetterList fixed={{ type: "OUTGOING" }} emptyText="نامه‌ای ثبت نشده است" />
    </CorrShell>
  );
}
