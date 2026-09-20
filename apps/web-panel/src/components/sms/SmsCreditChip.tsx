"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-context";
import { fetchSmsPanelStatus, type SmsPanelStatus } from "@/lib/api";
import { toPersianDigits } from "@/lib/persian";
import { SmsPackagePicker } from "./SmsPackagePicker";

const EXIRSMS_URL = "https://exirsms.ir";

/** مانده‌ی اعتبار پیامک در هدر (فقط مدیران) — با کلیک، شارژ مستقیم: بسته‌ی پنل سیستمی یا رفتن به پنل اختصاصی. */
export function SmsCreditChip() {
  const { me } = useWorkspace();
  const isManager = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";
  const [status, setStatus] = useState<SmsPanelStatus | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isManager) return;
    fetchSmsPanelStatus().then(setStatus).catch(() => setStatus(null));
  }, [isManager]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!isManager || !status) return null;

  const label =
    status.mode === "NONE"
      ? "پیامک: متصل نشده"
      : status.mode === "LEGACY"
        ? "پیامک: پنل اصلی"
      : status.smsCount === null
        ? "پیامک"
        : `پیامک: ${toPersianDigits(status.smsCount.toLocaleString("en-US"))}`;
  const low = status.mode !== "NONE" && status.smsCount !== null && status.smsCount < 50;

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-10 px-3 rounded-xl border text-[12px] font-bold cursor-pointer ${
          status.mode === "NONE" || low ? "border-warning text-warning bg-warning-soft" : "border-border text-ink-soft bg-white"
        }`}
        aria-label="اعتبار پیامک"
      >
        {label}
      </button>
      {open && (
        <div className="absolute end-0 top-12 z-50 w-[300px] bg-white border border-border rounded-2xl shadow-xl p-4 flex flex-col gap-3" dir="rtl">
          {status.mode === "SYSTEM" && (
            <>
              <div className="text-[12.5px] font-bold">شارژ بسته‌ی پیامکی (پنل سیستمی)</div>
              <SmsPackagePicker />
            </>
          )}
          {status.mode === "OWN" && (
            <>
              <div className="text-[12.5px] font-bold">پنل پیامکی اختصاصی شما</div>
              {status.error && <div className="text-[12px] text-danger">{status.error}</div>}
              <a href={EXIRSMS_URL} target="_blank" rel="noreferrer" className="text-center text-[12.5px] font-bold py-2.5 rounded-xl bg-primary text-white">
                ورود به پنل و شارژ
              </a>
            </>
          )}
          {status.mode === "LEGACY" && (
            <div className="text-[12.5px] leading-6">پیامک‌ها هنوز از پنل اصلی اکسیر می‌رود. برای ادامه، پنل اختصاصی وصل کنید یا بسته بخرید.</div>
          )}
          {status.mode === "NONE" && (
            <>
              <div className="text-[12.5px] leading-6">پیامک‌های ماژول‌ها (مصاحبه، نوبت، یادآورها و ...) فقط بعد از اتصال یک پنل پیامکی ارسال می‌شود.</div>
              <a href={EXIRSMS_URL} target="_blank" rel="noreferrer" className="text-center text-[12.5px] font-bold py-2.5 rounded-xl bg-primary text-white">
                ساخت رایگان پنل در exirsms.ir
              </a>
            </>
          )}
          <Link href="/settings/sms" onClick={() => setOpen(false)} className="text-center text-[12px] font-bold text-ink-soft">
            تنظیمات پنل پیامکی
          </Link>
        </div>
      )}
    </div>
  );
}
