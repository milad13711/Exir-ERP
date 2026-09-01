import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { createEmployee, type Employee } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function NewEmployeeModal({
  employees,
  onClose,
  onCreated,
}: {
  employees: Employee[];
  onClose: () => void;
  onCreated: (employee: Employee) => void;
}) {
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [phone, setPhone] = useState("");
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [baseSalary, setBaseSalary] = useState("");
  const [managerId, setManagerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeCode.trim() || !fullName.trim() || !position.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const employee = await createEmployee({
        employeeCode: employeeCode.trim(),
        fullName: fullName.trim(),
        position: position.trim(),
        department: department.trim() || undefined,
        phone: phone.trim() || undefined,
        hireDate,
        baseSalary: baseSalary ? Number(baseSalary) : undefined,
        managerId: managerId || undefined,
      });
      onCreated(employee);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="کارمند جدید" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>کد پرسنلی</label>
            <input
              autoFocus
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
              placeholder="E-100"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label className={labelClass}>نام و نام خانوادگی</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>سمت شغلی</label>
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="مثلاً کارشناس فروش"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>واحد سازمانی</label>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>مدیر بالادستی</label>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className={`${inputClass} bg-slate-50`}>
            <option value="">بدون مدیر بالادستی</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} — {emp.position}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>شماره تماس</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} dir="ltr" />
          </div>
          <div>
            <label className={labelClass}>تاریخ استخدام</label>
            <JalaliDateInput value={hireDate} onChange={setHireDate} />
          </div>
          <div>
            <label className={labelClass}>حقوق پایه</label>
            <input
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value.replace(/[^0-9]/g, ""))}
              className={inputClass}
              dir="ltr"
              inputMode="numeric"
              placeholder="۰"
            />
          </div>
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button
          type="submit"
          disabled={submitting || !employeeCode.trim() || !fullName.trim() || !position.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "افزودن کارمند"}
        </button>
      </form>
    </Modal>
  );
}
