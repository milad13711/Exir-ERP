"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";

const KEY = "exir_offline_onboarded";

/** کارت معرفی اولین استفاده: چه کارهایی آفلاین ممکن است و چه کارهایی نه. */
export function OfflineOnboarding() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setShow(window.localStorage.getItem(KEY) !== "1");
      } catch {
        setShow(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <Card className="p-4 border-primary/30">
      <div className="text-[14px] font-extrabold mb-2">کار آفلاین چطور کار می‌کند؟</div>
      <ul className="text-[12.5px] text-ink-soft leading-6 list-disc ps-5">
        <li>بدون اینترنت می‌توانید حضور و غیاب، چک‌لیست، وظایف، مخاطبان، یادآورها، پیش‌نویس فاکتور و پیش‌فاکتور، نوبت، نامه‌ی وارده و یادداشت پروژه را ثبت کنید.</li>
        <li>هر ثبت روی همین دستگاه رمزنگاری و ذخیره می‌شود و با آنلاین‌شدن به‌ترتیب و بدون ثبت تکراری ارسال می‌شود.</li>
        <li>شماره‌ی سند (فاکتور، نامه، وظیفه) را سرور پس از همگام‌سازی می‌دهد.</li>
        <li>امضا، تأیید، پرداخت، حسابداری، مالیات و مدیریت کاربران فقط آنلاین کار می‌کند.</li>
        <li>اگر همان رکورد در این مدت روی دستگاه دیگری تغییر کرده باشد، برای انتخاب نسخه از شما می‌پرسیم.</li>
        <li>پیش از خروج از حساب، ثبت‌های ارسال‌نشده را همگام کنید؛ در غیر این صورت همچنان رمزنگاری‌شده می‌مانند.</li>
      </ul>
      <button
        type="button"
        className="mt-3 min-h-[40px] px-4 rounded-lg bg-primary text-white text-[13px] font-bold"
        onClick={() => {
          try {
            window.localStorage.setItem(KEY, "1");
          } catch {
            /* */
          }
          setShow(false);
        }}
      >
        متوجه شدم
      </button>
    </Card>
  );
}
