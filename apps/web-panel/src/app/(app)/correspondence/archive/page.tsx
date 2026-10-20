"use client";

import { CorrShell } from "@/components/correspondence/CorrShell";
import { LetterList } from "@/components/correspondence/LetterList";

export default function Page() {
  return (
    <CorrShell active="archive" title="بایگانی نامه‌ها">
      <LetterList fixed={{ archived: "only" }} advanced bulk emptyText="نامه‌ی بایگانی‌شده‌ای نیست" />
    </CorrShell>
  );
}
