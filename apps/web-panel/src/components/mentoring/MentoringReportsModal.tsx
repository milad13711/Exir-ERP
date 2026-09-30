import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatToman, toPersianDigits } from "@/lib/persian";
import { fetchMentoringClientLifetime, fetchMentoringByAdvisor, type MentoringClientLifetimeRow, type MentoringAdvisorRow } from "@/lib/api";

export function MentoringReportsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"lifetime" | "advisor">("lifetime");
  const [lifetime, setLifetime] = useState<MentoringClientLifetimeRow[] | null>(null);
  const [byAdvisor, setByAdvisor] = useState<MentoringAdvisorRow[] | null>(null);

  useEffect(() => {
    fetchMentoringClientLifetime().then(setLifetime).catch(() => setLifetime([]));
    fetchMentoringByAdvisor().then(setByAdvisor).catch(() => setByAdvisor([]));
  }, []);

  return (
    <Modal title="گزارش‌های منتورینگ" onClose={onClose} width="max-w-[680px]">
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("lifetime")}
          className={`text-[12.5px] font-bold px-3.5 py-2 rounded-xl border cursor-pointer ${tab === "lifetime" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
        >
          طول عمر مشتریان
        </button>
        <button
          onClick={() => setTab("advisor")}
          className={`text-[12.5px] font-bold px-3.5 py-2 rounded-xl border cursor-pointer ${tab === "advisor" ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
        >
          عملکرد مشاوران
        </button>
      </div>

      {tab === "lifetime" && (
        <div className="overflow-x-auto">
          {lifetime === null ? (
            <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : lifetime.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">هنوز داده‌ای ثبت نشده</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-muted text-[11.5px] border-b border-border">
                  <th className="text-right font-semibold py-2">مشتری</th>
                  <th className="text-right font-semibold py-2">طول عمر</th>
                  <th className="text-right font-semibold py-2">جلسات</th>
                  <th className="text-right font-semibold py-2">درآمد</th>
                </tr>
              </thead>
              <tbody>
                {lifetime.map((row) => (
                  <tr key={row.contactId} className="border-b border-border last:border-0">
                    <td className="py-2.5 font-bold">{row.contactName}</td>
                    <td className="py-2.5">{toPersianDigits(row.tenureDays)} روز</td>
                    <td className="py-2.5">
                      {toPersianDigits(row.completedSessions)} از {toPersianDigits(row.totalSessions)}
                    </td>
                    <td className="py-2.5 font-bold">{formatToman(row.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "advisor" && (
        <div className="overflow-x-auto">
          {byAdvisor === null ? (
            <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : byAdvisor.length === 0 ? (
            <div className="p-6 text-center text-muted text-sm">هنوز داده‌ای ثبت نشده</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-muted text-[11.5px] border-b border-border">
                  <th className="text-right font-semibold py-2">مشاور</th>
                  <th className="text-right font-semibold py-2">کل جلسات</th>
                  <th className="text-right font-semibold py-2">عدم حضور</th>
                  <th className="text-right font-semibold py-2">رضایت مشتری</th>
                  <th className="text-right font-semibold py-2">درآمد</th>
                </tr>
              </thead>
              <tbody>
                {byAdvisor.map((row) => (
                  <tr key={row.advisorUserId} className="border-b border-border last:border-0">
                    <td className="py-2.5 font-bold">{row.advisorName}</td>
                    <td className="py-2.5">{toPersianDigits(row.total)}</td>
                    <td className="py-2.5">{toPersianDigits(row.noShow)}</td>
                    <td className="py-2.5">
                      {row.avgSatisfaction != null ? (
                        <>
                          {toPersianDigits(row.avgSatisfaction)} از ۵
                          <span className="text-muted"> ({toPersianDigits(row.surveyResponseCount)})</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2.5 font-bold">{formatToman(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}
