"use client";

import { CorrShell } from "@/components/correspondence/CorrShell";
import { LetterList } from "@/components/correspondence/LetterList";

export default function Page() {
  return (
    <CorrShell active="search" title="جست‌وجوی پیشرفته">
      <LetterList fixed={{}} advanced bulk />
    </CorrShell>
  );
}
