"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { useConnectivity } from "@/lib/offline/useConnectivity";
import { listPending, type QueuedRequest } from "@/lib/offline/db";
import { flushQueue } from "@/lib/offline/queue";
import { getToken, API_URL } from "@/lib/api";

export default function OfflineSyncSettingsPage() {
  const { online, pendingCount } = useConnectivity();
  const [items, setItems] = useState<QueuedRequest[] | null>(null);
  const [syncing, setSyncing] = useState(false);

  function reload() {
    listPending().then(setItems);
  }
  useEffect(reload, [pendingCount]);

  async function handleSyncNow() {
    setSyncing(true);
    try {
      await flushQueue(getToken, API_URL);
      reload();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-extrabold text-ink">همگام‌سازی آفلاین</h1>
        <p className="text-[12.5px] text-muted mt-1">
          وقتی اتصال اینترنت قطع باشد، تغییراتی که ثبت می‌کنید (مثل افزودن مخاطب یا صدور فاکتور) به‌جای خطا دادن، در همین
          دستگاه ذخیره می‌شوند و به‌محض اتصال مجدد، خودکار و به همان ترتیب ثبت، برای سرور ارسال می‌شوند.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <Badge tone={online ? "success" : "danger"}>{online ? "آنلاین" : "آفلاین"}</Badge>
            <span className="text-[13px] text-ink-soft">
              {pendingCount > 0
                ? `${toPersianDigits(pendingCount)} مورد در صف انتظار ارسال`
                : "چیزی در صف انتظار نیست"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing || !online || pendingCount === 0}
            className="text-[12.5px] font-bold text-white bg-primary px-3.5 py-2 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {syncing ? "در حال همگام‌سازی..." : "همگام‌سازی الان"}
          </button>
        </div>
      </Card>

      <div>
        <div className="text-[12px] text-muted mb-2">موارد در صف</div>
        {items === null ? (
          <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
            در حال بارگذاری...
          </div>
        ) : items.length === 0 ? (
          <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
            موردی در صف نیست — همه‌چیز همگام است
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
              >
                <span className="text-[12.5px] font-semibold min-w-0 break-words">{item.description}</span>
                <span className="text-[11px] text-muted shrink-0">{formatJalaliDateTime(item.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
