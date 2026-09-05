import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatToman, toPersianDigits } from "@/lib/persian";
import { fetchAppointmentsReport, type AppointmentReportRow } from "@/lib/api";

function defaultFrom(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AppointmentsReportModal({ onClose }: { onClose: () => void }) {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [rows, setRows] = useState<AppointmentReportRow[] | null>(null);

  function reload() {
    setRows(null);
    fetchAppointmentsReport(from, to)
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(reload, [from, to]);

  return (
    <Modal title="گزارش نوبت‌ها به تفکیک خدمت و کارشناس" onClose={onClose} width="max-w-[640px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">از تاریخ</label>
            <JalaliDateInput
              value={from}
              onChange={setFrom}
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2.5"
            />
          </div>
          <div className="flex-1">
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">تا تاریخ</label>
            <JalaliDateInput
              value={to}
              onChange={setTo}
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-lg px-3 py-2.5"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {rows === null ? (
            <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">در این بازه نوبتی ثبت نشده</div>
          ) : (
            <table className="w-full text-[12.5px] min-w-[520px]">
              <thead>
                <tr className="text-right text-muted border-b border-border">
                  <th className="py-2 font-semibold">خدمت</th>
                  <th className="py-2 font-semibold">کارشناس</th>
                  <th className="py-2 font-semibold">کل</th>
                  <th className="py-2 font-semibold">انجام‌شده</th>
                  <th className="py-2 font-semibold">لغوشده</th>
                  <th className="py-2 font-semibold">عدم‌حضور</th>
                  <th className="py-2 font-semibold">درآمد</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="py-2 font-bold">{r.serviceName}</td>
                    <td className="py-2">{r.providerName}</td>
                    <td className="py-2">{toPersianDigits(r.total)}</td>
                    <td className="py-2 text-success">{toPersianDigits(r.completed)}</td>
                    <td className="py-2 text-danger">{toPersianDigits(r.cancelled)}</td>
                    <td className="py-2 text-warning">{toPersianDigits(r.noShow)}</td>
                    <td className="py-2 font-extrabold">{formatToman(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
