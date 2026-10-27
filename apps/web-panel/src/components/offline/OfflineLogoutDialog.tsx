"use client";

import { Modal } from "@/components/ui/Modal";
import { toPersianDigits } from "@/lib/persian";

export type LogoutChoice = "sync" | "keep" | "discard" | "cancel";

/** پیش از خروج، اگر موارد همگام‌نشده هست: همگام‌سازی / نگه‌داشتن رمزنگاری‌شده برای ورود بعدی همین کاربر / دور انداختن. */
export function OfflineLogoutDialog({ pending, online, wipeDefault = true, onChoose }: { pending: number; online: boolean; wipeDefault?: boolean; onChoose: (c: LogoutChoice) => void }) {
  return (
    <Modal title="موارد همگام‌نشده" onClose={() => onChoose("cancel")}>
      <p className="text-[13px] text-ink-soft mb-4">
        {toPersianDigits(pending)} مورد هنوز به سرور ارسال نشده است. با خروج چه شود؟
      </p>
      <div className="flex flex-col gap-2">
        <button type="button" disabled={!online} onClick={() => onChoose("sync")} className="min-h-[44px] rounded-lg bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          همگام‌سازی و خروج {online ? "" : "(نیازمند اتصال)"}
        </button>
        {wipeDefault ? (
          <p className="text-[11.5px] text-muted">سیاست سازمان: داده‌ی آفلاین هنگام خروج پاک می‌شود، مگر خودتان «نگه‌داشتن» را انتخاب کنید.</p>
        ) : null}
          <button type="button" onClick={() => onChoose("keep")} className="min-h-[44px] rounded-lg border border-border text-[13px] font-bold">
            نگه‌داشتن رمزنگاری‌شده روی همین دستگاه (فقط برای ورود بعدی خودم)
          </button>
        <button type="button" onClick={() => onChoose("discard")} className="min-h-[44px] rounded-lg border border-danger text-danger text-[13px] font-bold">
          دور انداختن موارد و خروج
        </button>
        <button type="button" onClick={() => onChoose("cancel")} className="min-h-[44px] rounded-lg text-[13px]">
          انصراف
        </button>
      </div>
    </Modal>
  );
}
