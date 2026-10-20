"use client";

import { CorrShell } from "@/components/correspondence/CorrShell";
import { CorrSettingsView } from "@/components/correspondence/CorrSettingsView";

export default function Page() {
  return (
    <CorrShell active="settings" title="تنظیمات مکاتبات">
      <CorrSettingsView />
    </CorrShell>
  );
}
