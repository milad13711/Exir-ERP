"use client";

import { CorrShell } from "@/components/correspondence/CorrShell";
import { IncomingRegisterForm } from "@/components/correspondence/IncomingRegisterForm";

export default function Page() {
  return (
    <CorrShell active="incoming" title="ثبت نامه‌ی وارده">
      <IncomingRegisterForm />
    </CorrShell>
  );
}
