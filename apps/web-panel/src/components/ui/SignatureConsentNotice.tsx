/** اطلاعیه‌ی رضایت: کنار هر دکمه‌ی امضا/تأیید نمایش داده شود. */
export function SignatureConsentNotice({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-xl bg-primary-soft/60 px-3 py-2 text-[11px] leading-6 text-ink-soft ${className}`}
      role="note"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-1 shrink-0 text-primary" aria-hidden>
        <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
      <span>برای اعتبار حقوقی امضا، آی‌پی، مشخصات دستگاه، زمان و موقعیت مکانی شما ثبت می‌شود.</span>
    </p>
  );
}
