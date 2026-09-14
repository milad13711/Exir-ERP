import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import {
  fetchEmployee,
  assignManager,
  addEmployeeDocument,
  updateEmployee,
  terminateEmployee,
  reactivateEmployee,
  type EmployeeDetail,
  type Employee,
  type EmployeeDocumentType,
} from "@/lib/api";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_TONES,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_TONES,
  JALALI_MONTH_NAMES,
} from "./hr-shared";

const DOC_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  CONTRACT: "قرارداد",
  NATIONAL_ID: "کارت ملی",
  DEGREE_CERTIFICATE: "مدرک تحصیلی",
  OTHER: "سایر",
};

export function EmployeeModal({
  employeeId,
  employees,
  onClose,
  onChanged,
}: {
  employeeId: string;
  employees: Employee[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [managerId, setManagerId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState<EmployeeDocumentType>("CONTRACT");
  const [docUrl, setDocUrl] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editBaseSalary, setEditBaseSalary] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);

  function reload() {
    fetchEmployee(employeeId).then((e) => {
      setEmployee(e);
      setManagerId(e.managerId ?? "");
    });
  }
  useEffect(reload, [employeeId]);

  async function handleManagerChange(value: string) {
    setManagerId(value);
    await assignManager(employeeId, value || null);
    reload();
  }

  function startEdit() {
    if (!employee) return;
    setEditFullName(employee.fullName);
    setEditPosition(employee.position);
    setEditDepartment(employee.department ?? "");
    setEditPhone(employee.phone ?? "");
    setEditEmail(employee.email ?? "");
    setEditBaseSalary(String(employee.baseSalary));
    setEditing(true);
  }

  async function saveEdit() {
    if (!editFullName.trim() || !editPosition.trim()) return;
    setSavingEdit(true);
    try {
      await updateEmployee(employeeId, {
        fullName: editFullName.trim(),
        position: editPosition.trim(),
        department: editDepartment.trim() || undefined,
        phone: editPhone.trim() || undefined,
        email: editEmail.trim() || undefined,
        baseSalary: Number(editBaseSalary) || 0,
      });
      setEditing(false);
      reload();
      onChanged?.();
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggleStatus() {
    if (!employee) return;
    const terminating = employee.status === "ACTIVE";
    let reason: string | undefined;
    if (terminating) {
      const input = window.prompt("دلیل پایان همکاری را وارد کنید (اختیاری):");
      if (input === null) return; // انصراف
      reason = input.trim() || undefined;
    }
    setTogglingStatus(true);
    try {
      if (terminating) await terminateEmployee(employeeId, reason);
      else await reactivateEmployee(employeeId);
      reload();
      onChanged?.();
    } finally {
      setTogglingStatus(false);
    }
  }

  async function handleAddDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!docTitle.trim() || !docUrl.trim()) return;
    setSavingDoc(true);
    try {
      await addEmployeeDocument(employeeId, { type: docType, title: docTitle.trim(), fileUrl: docUrl.trim() });
      setDocTitle("");
      setDocUrl("");
      reload();
    } finally {
      setSavingDoc(false);
    }
  }

  return (
    <Modal title="پرونده پرسنلی" onClose={onClose} width="max-w-[600px]">
      {!employee ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-5">
          {editing ? (
            <div className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
              <input
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                placeholder="نام و نام خانوادگی"
                className="text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
              />
              <div className="flex gap-2.5">
                <input
                  value={editPosition}
                  onChange={(e) => setEditPosition(e.target.value)}
                  placeholder="سمت"
                  className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                />
                <input
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  placeholder="واحد (اختیاری)"
                  className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                />
              </div>
              <div className="flex gap-2.5">
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="شماره تماس"
                  dir="ltr"
                  className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                />
                <input
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="ایمیل"
                  dir="ltr"
                  className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                />
                <input
                  value={editBaseSalary}
                  onChange={(e) => setEditBaseSalary(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="حقوق پایه"
                  dir="ltr"
                  inputMode="numeric"
                  className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={savingEdit || !editFullName.trim() || !editPosition.trim()}
                  className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {savingEdit ? "در حال ذخیره..." : "ذخیره"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary-soft text-primary flex items-center justify-center shrink-0 text-[14px] font-extrabold">
                  {employee.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("‌")}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-[15px] font-extrabold">{employee.fullName}</div>
                    {employee.status === "TERMINATED" ? <Badge tone="danger">پایان همکاری</Badge> : null}
                  </div>
                  <div className="text-[12.5px] text-ink-soft mt-0.5">
                    {employee.position}
                    {employee.department ? ` · ${employee.department}` : ""}
                  </div>
                  <div className="text-[11px] text-muted mt-1" dir="ltr">
                    {employee.employeeCode}
                  </div>
                  {employee.status === "TERMINATED" && employee.terminationReason ? (
                    <div className="text-[11.5px] text-danger mt-1">دلیل: {employee.terminationReason}</div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={startEdit}
                  className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg cursor-pointer"
                >
                  ویرایش
                </button>
                <button
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={togglingStatus}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer disabled:opacity-50 ${
                    employee.status === "ACTIVE" ? "text-danger bg-danger-soft" : "text-success bg-success-soft"
                  }`}
                >
                  {employee.status === "ACTIVE" ? "پایان همکاری" : "فعال‌سازی مجدد"}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
            <div>
              <div className="text-[11px] text-muted">تاریخ استخدام</div>
              <div className="text-[13px] font-bold mt-0.5">{formatJalaliDate(employee.hireDate)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">حقوق پایه ماهانه</div>
              <div className="text-[13px] font-bold mt-0.5">{formatToman(employee.baseSalary)}</div>
            </div>
            {employee.phone ? (
              <div>
                <div className="text-[11px] text-muted">شماره تماس</div>
                <div className="text-[13px] font-bold mt-0.5" dir="ltr">{employee.phone}</div>
              </div>
            ) : null}
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">جایگاه در نمودار سازمانی</div>
            <div className="bg-slate-50 border border-border rounded-xl p-3.5 flex flex-col gap-3">
              <div>
                <label className="text-[11.5px] text-muted block mb-1.5">مدیر بالادستی</label>
                <select
                  value={managerId}
                  onChange={(e) => handleManagerChange(e.target.value)}
                  className="w-full text-[12.5px] bg-white border border-border rounded-lg px-2.5 py-2 outline-none"
                >
                  <option value="">بدون مدیر بالادستی</option>
                  {employees
                    .filter((e) => e.id !== employeeId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} — {e.position}
                      </option>
                    ))}
                </select>
              </div>
              {employee.directReports.length > 0 ? (
                <div>
                  <div className="text-[11.5px] text-muted mb-1.5">افراد زیردست</div>
                  <div className="flex flex-wrap gap-1.5">
                    {employee.directReports.map((r) => (
                      <Badge key={r.id} tone="neutral">
                        {r.fullName}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">آخرین وضعیت حضور و غیاب</div>
            {employee.attendance.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
                هنوز رکوردی ثبت نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto">
                {employee.attendance.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-[12px] px-1">
                    <span className="text-ink-soft">{formatJalaliDate(a.date)}</span>
                    <Badge tone={ATTENDANCE_STATUS_TONES[a.status]}>{ATTENDANCE_STATUS_LABELS[a.status]}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">درخواست‌های مرخصی</div>
            {employee.leaveRequests.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
                درخواستی ثبت نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {employee.leaveRequests.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <div>
                      <div className="text-[12.5px] font-bold">
                        {LEAVE_TYPE_LABELS[l.type]} · {toPersianDigits(l.daysCount)} روز
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {formatJalaliDate(l.startDate)} تا {formatJalaliDate(l.endDate)}
                      </div>
                    </div>
                    <Badge tone={LEAVE_STATUS_TONES[l.status]}>{LEAVE_STATUS_LABELS[l.status]}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">فیش‌های حقوقی</div>
            {employee.payrollSlips.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">
                فیشی صادر نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {employee.payrollSlips.slice(0, 6).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-[12px] px-1">
                    <span className="text-ink-soft">
                      {JALALI_MONTH_NAMES[s.periodMonth - 1]} {toPersianDigits(s.periodYear)}
                    </span>
                    <span className="font-bold">
                      {formatToman(s.baseSalary + s.allowances - s.deductions)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">قرارداد و مدارک</div>
            {employee.documents.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border mb-3">
                مدرکی ثبت نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 mb-3">
                {employee.documents.map((d) => (
                  <a
                    key={d.id}
                    href={d.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 hover:bg-slate-100 transition-colors"
                  >
                    <div>
                      <div className="text-[12.5px] font-bold">{d.title}</div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {DOC_TYPE_LABELS[d.type]} · {formatJalaliDate(d.uploadedAt)}
                        {d.expiresAt ? ` · انقضا: ${formatJalaliDate(d.expiresAt)}` : ""}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
            <form onSubmit={handleAddDocument} className="flex flex-wrap items-center gap-2">
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as EmployeeDocumentType)}
                className="text-[12px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
              >
                {Object.entries(DOC_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="عنوان مدرک"
                className="flex-1 min-w-[100px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
              />
              <input
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder="لینک فایل"
                dir="ltr"
                className="flex-1 min-w-[120px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
              />
              <button
                type="submit"
                disabled={savingDoc || !docTitle.trim() || !docUrl.trim()}
                className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
              >
                افزودن
              </button>
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
}
