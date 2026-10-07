"use client";

import { ActivityLogsView } from "@/components/logs/ActivityLogsView";

export default function LogsPage() {
  return (
    <div>
      <h1 className="text-xl font-extrabold">لاگ‌ها</h1>
      <p className="text-[13.5px] text-muted mt-1">
        ثبت همه‌ی فعالیت‌های دستی و خودکار در همه‌ی ماژول‌ها، ارسال پیامک‌ها و ساعت ثبت گزارش کار روزانه. مدیران فعالیت همه را می‌بینند؛ سایر کاربران فقط فعالیت خودشان را (مگر مدیر دسترسی «مشاهده‌ی همه» بدهد).
      </p>
      <ActivityLogsView />
    </div>
  );
}
