import { WarningIcon } from "@/components/icons";

export function LicenseBlockedScreen({ reason }: { reason: string }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-[420px] w-full bg-surface border border-border rounded-2xl p-7 text-center">
        <div className="w-14 h-14 rounded-2xl bg-danger-soft text-danger flex items-center justify-center mx-auto">
          <WarningIcon className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-extrabold mt-4">دسترسی به سامانه مسدود است</h1>
        <p className="text-[13.5px] text-ink-soft leading-7 mt-2">{reason}</p>
        <p className="text-[12.5px] text-muted mt-5">
          برای تمدید یا رفع مشکل لایسنس، با پشتیبانی اکسیر تماس بگیرید.
        </p>
      </div>
    </div>
  );
}
