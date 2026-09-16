"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { fetchRationAggregateReport, type RationAggregateReport } from "@/lib/api";

export default function RationAggregateReportsPage() {
  const [report, setReport] = useState<RationAggregateReport | null>(null);

  useEffect(() => {
    fetchRationAggregateReport().then(setReport).catch(() => setReport(null));
  }, []);

  return (
    <div className="p-5 lg:p-7 max-w-[720px] mx-auto">
      <h1 className="text-xl font-extrabold">گزارش تجمیعی دامداران</h1>
      <p className="text-[13.5px] text-muted mt-1">میانگین تغییر شیر هر دام، قبل و بعد از جیره‌ی پیشنهادی</p>

      {report === null ? (
        <div className="p-8 text-center text-muted text-sm mt-6">در حال بارگذاری...</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3 mt-6">
            <Card className="p-4 text-center">
              <div className="text-[11px] text-muted">کل نمونه‌ها</div>
              <div className="text-[20px] font-extrabold mt-1">{report.sampleCount}</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-[11px] text-muted">دارای پیگیری تکمیل‌شده</div>
              <div className="text-[20px] font-extrabold mt-1">{report.evaluatedCount}</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-[11px] text-muted">میانگین تغییر شیر هر دام</div>
              <div className={`text-[20px] font-extrabold mt-1 ${(report.avgChangePercent ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                {report.avgChangePercent != null ? `${report.avgChangePercent.toFixed(1)}٪` : "—"}
              </div>
            </Card>
          </div>

          {report.perSample.length > 0 ? (
            <Card className="mt-4 p-2">
              {report.perSample.map((s, i) => (
                <div
                  key={s.sampleCode}
                  className={`flex items-center justify-between px-4 py-3 ${i < report.perSample.length - 1 ? "border-b border-border" : ""}`}
                >
                  <span className="text-[13px] font-bold" dir="ltr">
                    {s.sampleCode}
                  </span>
                  <span className={`text-[13px] font-bold ${s.changePercent >= 0 ? "text-success" : "text-danger"}`}>
                    {s.changePercent >= 0 ? "+" : ""}
                    {s.changePercent.toFixed(1)}٪
                  </span>
                </div>
              ))}
            </Card>
          ) : (
            <div className="p-8 text-center text-muted text-sm mt-4">هنوز پیگیری تکمیل‌شده‌ای ثبت نشده است</div>
          )}
        </>
      )}
    </div>
  );
}
