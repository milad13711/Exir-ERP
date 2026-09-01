import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { createLeaveRequest, type Employee, type LeaveRequest, type LeaveType } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewLeaveModal({
  employees,
  onClose,
  onCreated,
}: {
  employees: Employee[];
  onClose: () => void;
  onCreated: (leave: LeaveRequest) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [type, setType] = useState<LeaveType>("ANNUAL");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setSubmitting(true);
    setError(null);
    try {
      const leave = await createLeaveRequest({
        employeeId,
        type,
        startDate,
        endDate,
        reason: reason.trim() || undefined,
      });
      onCreated(leave);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="درخواست مرخصی جدید" onClose={onClose}>
      {employees.length === 0 ? (
        <div className="text-[13px] text-muted text-center py-6">ابتدا باید حداقل یک کارمند ثبت کنید.</div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div>
            <label className={labelClass}>کارمند</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} — {e.position}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>نوع مرخصی</label>
            <select value={type} onChange={(e) => setType(e.target.value as LeaveType)} className={inputClass}>
              <option value="ANNUAL">استحقاقی</option>
              <option value="SICK">استعلاجی</option>
              <option value="UNPAID">بدون حقوق</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>از تاریخ</label>
              <JalaliDateInput value={startDate} onChange={setStartDate} />
            </div>
            <div>
              <label className={labelClass}>تا تاریخ</label>
              <JalaliDateInput value={endDate} onChange={setEndDate} />
            </div>
          </div>
          <div>
            <label className={labelClass}>دلیل (اختیاری)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </div>
          {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          <button
            type="submit"
            disabled={submitting || !employeeId}
            className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {submitting ? "در حال ثبت..." : "ثبت درخواست"}
          </button>
        </form>
      )}
    </Modal>
  );
}
