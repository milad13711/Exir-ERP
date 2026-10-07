"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { DocsIcon } from "@/components/icons";
import { toPersianDigits } from "@/lib/persian";
import { fetchFormsInboxSummary, type FormsInboxSummary } from "@/lib/api";
import { timeAgoFa } from "@/components/forms/forms-ui";

/**
 * ویجت داشبورد «درخواست‌های جدید فرم‌ها» — به تفکیک هر فرم، تعداد پاسخ‌های دیده‌نشده و چند پاسخ آخر.
 * فقط وقتی ماژول فرم‌ساز نصب است رندر می‌شود (در dashboard/page)؛ اگر کاربر دسترسی مشاهده ندارد
 * (۴۰۳ از سرور) یا خطایی رخ دهد، ویجت بی‌صدا پنهان می‌ماند. با برگشت به تب تازه می‌شود.
 */
export function FormsInboxWidget() {
  const [data, setData] = useState<FormsInboxSummary | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    fetchFormsInboxSummary()
      .then((d) => {
        setData(d);
        setHidden(false);
      })
      .catch(() => setHidden(true));
  }, []);

  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  if (hidden || !data) return null;

  return (
    <Card className="p-5 mb-5" data-testid="forms-inbox-widget">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-bold">درخواست‌های جدید فرم‌ها</span>
          {data.totalNew > 0 && (
            <span className="text-[11px] font-extrabold bg-primary text-white rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center">{toPersianDigits(data.totalNew)}</span>
          )}
        </div>
        <Link href="/forms?filter=new" className="text-[12px] font-bold text-primary">
          مشاهده‌ی همه
        </Link>
      </div>

      {data.forms.length === 0 ? (
        <div className="text-[12.5px] text-muted py-3">درخواست جدیدی نیست.</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.forms.map((f) => (
            <div key={f.formId} className="border border-border rounded-xl p-3">
              <Link href={`/forms?formId=${f.formId}`} className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
                  <DocsIcon className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-bold flex-1 truncate">{f.title}</span>
                <span className="text-[11px] font-extrabold bg-primary text-white rounded-full min-w-6 h-6 px-1.5 flex items-center justify-center shrink-0">{toPersianDigits(f.newCount)}</span>
              </Link>
              <div className="flex flex-col">
                {f.latest.map((s) => (
                  <Link
                    key={s.id}
                    href={`/forms?formId=${f.formId}&submissionId=${s.id}`}
                    className="flex items-center justify-between gap-2 text-[12px] py-1.5 border-t border-border hover:bg-slate-50 rounded"
                  >
                    <span className="truncate font-semibold">
                      {s.respondentName || (s.respondentPhone ? toPersianDigits(s.respondentPhone) : null) || s.preview || "بدون‌نام"}
                      {s.respondentName && s.respondentPhone && <span className="text-muted font-normal mr-1.5">{toPersianDigits(s.respondentPhone)}</span>}
                    </span>
                    <span className="text-muted shrink-0">{timeAgoFa(s.submittedAt)}</span>
                  </Link>
                ))}
                {f.newCount > f.latest.length && (
                  <Link href={`/forms?formId=${f.formId}`} className="text-[11.5px] font-bold text-primary pt-1.5 border-t border-border">
                    و {toPersianDigits(f.newCount - f.latest.length)} مورد دیگر
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
