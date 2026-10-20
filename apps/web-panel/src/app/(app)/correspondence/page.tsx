"use client";

import { CorrShell } from "@/components/correspondence/CorrShell";
import { InboxView } from "@/components/correspondence/InboxView";

export default function CorrespondencePage() {
  return (
    <CorrShell active="inbox">
      <InboxView />
    </CorrShell>
  );
}
