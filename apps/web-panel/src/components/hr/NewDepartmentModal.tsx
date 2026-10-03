import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { createDepartment, ApiError, type Department, type Employee } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewDepartmentModal({
  employees,
  onClose,
  onCreated,
}: {
  employees: Employee[];
  onClose: () => void;
  onCreated: (department: Department) => void;
}) {
  const [name, setName] = useState("");
  const [managerId, setManagerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const department = await createDepartment({ name: name.trim(), managerId: managerId || undefined });
      onCreated(department);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="واحد سازمانی جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نام واحد</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً مالی" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>مدیر واحد (اختیاری)</label>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={`${inputClass} bg-slate-50`}>
            <option value="">بدون مدیر</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} — {e.position}
              </option>
            ))}
          </select>
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "افزودن واحد"}
        </button>
      </form>
    </Modal>
  );
}
