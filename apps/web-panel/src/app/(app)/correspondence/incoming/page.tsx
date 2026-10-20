"use client";

import { CorrShell } from "@/components/correspondence/CorrShell";
import { LetterList } from "@/components/correspondence/LetterList";

export default function Page() {
  return (
    <CorrShell active="incoming">
      <LetterList fixed={{ type: "INCOMING" }} emptyText="نامه‌ای ثبت نشده است" />
    </CorrShell>
  );
}
