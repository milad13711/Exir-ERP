import { useEffect, useState } from "react";
import { safeHref } from "@/lib/safe-url";
import { deleteEmployee } from "@/lib/api";
import { DeleteRecordButton } from "@/components/ui/DeleteRecordButton";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import {
  fetchEmployee,
  assignManager,
  addEmployeeDocument,
  deleteEmployeeDocument,
  updateEmployee,
  terminateEmployee,
  reactivateEmployee,
  fetchCertificates,
  fetchCertificateImageObjectUrl,
  fetchCertificatePdfObjectUrl,
  fetchRewards,
  createReward,
  deleteReward,
  fetchPenalties,
  createPenalty,
  deletePenalty,
  fetchDepartments,
  type EmployeeDetail,
  type Employee,
  type EmployeeDocumentType,
  type Certificate,
  type PersonnelActionEntry,
  type Department,
} from "@/lib/api";
import { EmployeeKpiModal } from "./EmployeeKpiModal";
import { NewCertificateModal } from "@/components/certificates/NewCertificateModal";
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
  const [editDepartmentId, setEditDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editNationalId, setEditNationalId] = useState("");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [editBaseSalary, setEditBaseSalary] = useState("");
  const [editHireDate, setEditHireDate] = useState("");
  const [editDetailsOpen, setEditDetailsOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [kpiOpen, setKpiOpen] = useState(false);

  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [issueCertOpen, setIssueCertOpen] = useState(false);

  const [rewards, setRewards] = useState<PersonnelActionEntry[]>([]);
  const [penalties, setPenalties] = useState<PersonnelActionEntry[]>([]);
  const [actionTitle, setActionTitle] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionAmount, setActionAmount] = useState("");
  const [actionKind, setActionKind] = useState<"REWARD" | "PENALTY">("REWARD");
  const [savingAction, setSavingAction] = useState(false);

  function reload() {
    fetchEmployee(employeeId).then((e) => {
      setEmployee(e);
      setManagerId(e.managerId ?? "");
    });
  }
  function reloadCertificates() {
    // ماژول گواهی‌نامه‌ها اختیاری است — اگر برای این محیط کاری فعال نباشد،
    // این درخواست ۴۰۳ می‌گیرد؛ به‌جای خطای کنسول، فقط فهرست را خالی نشان بده.
    fetchCertificates({ employeeId })
      .then(setCertificates)
      .catch(() => setCertificates([]));
  }
  function reloadActions() {
    fetchRewards(employeeId).then(setRewards);
    fetchPenalties(employeeId).then(setPenalties);
  }
  useEffect(reload, [employeeId]);
  useEffect(reloadCertificates, [employeeId]);
  useEffect(reloadActions, [employeeId]);
  useEffect(() => {
    fetchDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  async function handleManagerChange(value: string) {
    setManagerId(value);
    await assignManager(employeeId, value || null);
    reload();
  }

  function startEdit() {
    if (!employee) return;
    setEditFullName(employee.fullName);
    setEditPosition(employee.position);
    setEditDepartmentId(employee.department?.id ?? "");
    setEditPhone(employee.phone ?? "");
    setEditEmail(employee.email ?? "");
    setEditNationalId(employee.nationalId ?? "");
    setEditBirthDate(employee.birthDate ? employee.birthDate.slice(0, 10) : "");
    setEditBaseSalary(String(employee.baseSalary));
    setEditHireDate(employee.hireDate.slice(0, 10));
    setEditDetailsOpen(Boolean(employee.phone || employee.email || employee.nationalId || employee.birthDate));
    setEditing(true);
  }

  async function saveEdit() {
    if (!editFullName.trim() || !editPosition.trim() || !editHireDate) return;
    setSavingEdit(true);
    try {
      await updateEmployee(employeeId, {
        fullName: editFullName.trim(),
        position: editPosition.trim(),
        // null = پاک‌کردن فیلد (undefined یعنی بدون تغییر)
        departmentId: editDepartmentId || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        nationalId: editNationalId.trim() || null,
        birthDate: editBirthDate || null,
        baseSalary: Number(editBaseSalary) || 0,
        hireDate: editHireDate,
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

  async function handleDeleteDocument(id: string) {
    if (!window.confirm("این مدرک حذف شود؟")) return;
    await deleteEmployeeDocument(employeeId, id);
    reload();
  }

  async function handleDownloadCertificate(cert: Certificate, kind: "png" | "pdf") {
    const url = kind === "png" ? await fetchCertificateImageObjectUrl(cert.id) : await fetchCertificatePdfObjectUrl(cert.id);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certificate-${cert.code}.${kind}`;
    a.click();
  }

  async function handleAddAction(e: React.FormEvent) {
    e.preventDefault();
    if (!actionTitle.trim()) return;
    setSavingAction(true);
    try {
      const payload = {
        employeeId,
        title: actionTitle.trim(),
        description: actionDescription.trim() || undefined,
        amount: actionAmount ? Number(actionAmount) : undefined,
      };
      if (actionKind === "REWARD") await createReward(payload);
      else await createPenalty(payload);
      setActionTitle("");
      setActionDescription("");
      setActionAmount("");
      reloadActions();
    } finally {
      setSavingAction(false);
    }
  }

  async function handleDeleteReward(id: string) {
    if (!window.confirm("این پاداش حذف شود؟")) return;
    await deleteReward(id);
    reloadActions();
  }

  async function handleDeletePenalty(id: string) {
    if (!window.confirm("این جریمه حذف شود؟")) return;
    await deletePenalty(id);
    reloadActions();
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
                <select
                  value={editDepartmentId}
                  onChange={(e) => setEditDepartmentId(e.target.value)}
                  className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                >
                  <option value="">بدون واحد سازمانی</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-1">حقوق پایه</label>
                <input
                  value={editBaseSalary}
                  onChange={(e) => setEditBaseSalary(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="حقوق پایه"
                  dir="ltr"
                  inputMode="numeric"
                  className="w-full text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-1">تاریخ استخدام</label>
                <JalaliDateInput
                  value={editHireDate}
                  onChange={setEditHireDate}
                  className="text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2 w-full"
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
                  disabled={savingEdit || !editFullName.trim() || !editPosition.trim() || !editHireDate}
                  className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {savingEdit ? "در حال ذخیره..." : "ذخیره"}
                </button>
              </div>
              <details className="text-[12.5px]" open={editDetailsOpen}>
                <summary className="cursor-pointer text-primary font-bold">جزئیات بیشتر</summary>
                <div className="flex flex-col gap-2.5 mt-2.5">
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
                  </div>
                  <div className="flex gap-2.5">
                    <input
                      value={editNationalId}
                      onChange={(e) => setEditNationalId(e.target.value.replace(/[^0-9]/g, ""))}
                      placeholder="کد ملی"
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={10}
                      className="flex-1 text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2"
                    />
                    <div className="flex-1">
                      <JalaliDateInput
                        value={editBirthDate}
                        onChange={setEditBirthDate}
                        placeholder="تاریخ تولد"
                        className="text-[13px] outline-none bg-surface border border-border rounded-lg px-2.5 py-2 w-full"
                      />
                    </div>
                  </div>
                </div>
              </details>
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
                    {employee.department ? ` · ${employee.department.name}` : ""}
                  </div>
                  <div className="text-[11px] text-muted mt-1" dir="ltr">
                    {employee.employeeCode}
                  </div>
                  {employee.status === "TERMINATED" && employee.terminationReason ? (
                    <div className="text-[11.5px] text-danger mt-1">دلیل: {employee.terminationReason}</div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  type="button"
                  onClick={() => setKpiOpen(true)}
                  className="text-[11px] font-bold text-accent bg-accent-soft px-2.5 py-1 rounded-lg cursor-pointer"
                >
                  KPI
                </button>
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

          {kpiOpen && <EmployeeKpiModal employeeId={employeeId} onClose={() => setKpiOpen(false)} />}

          {issueCertOpen && employee ? (
            <NewCertificateModal
              presetRecipient={{ type: "EMPLOYEE", employee }}
              onClose={() => setIssueCertOpen(false)}
              onCreated={() => reloadCertificates()}
            />
          ) : null}

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
            {employee.nationalId ? (
              <div>
                <div className="text-[11px] text-muted">کد ملی</div>
                <div className="text-[13px] font-bold mt-0.5" dir="ltr">{employee.nationalId}</div>
              </div>
            ) : null}
            {employee.birthDate ? (
              <div>
                <div className="text-[11px] text-muted">تاریخ تولد</div>
                <div className="text-[13px] font-bold mt-0.5">{formatJalaliDate(employee.birthDate)}</div>
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
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <a href={safeHref(d.fileUrl, { allowData: true })} target="_blank" rel="noreferrer" className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                      <div className="text-[12.5px] font-bold">{d.title}</div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {DOC_TYPE_LABELS[d.type]} · {formatJalaliDate(d.uploadedAt)}
                        {d.expiresAt ? ` · انقضا: ${formatJalaliDate(d.expiresAt)}` : ""}
                      </div>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDeleteDocument(d.id)}
                      className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1 rounded-lg cursor-pointer shrink-0"
                    >
                      حذف
                    </button>
                  </div>
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

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] text-muted">گواهی‌های صادرشده</div>
              {employee ? (
                <button
                  type="button"
                  onClick={() => setIssueCertOpen(true)}
                  className="text-[11.5px] font-bold text-primary cursor-pointer"
                >
                  + صدور گواهی برای این پرسنل
                </button>
              ) : null}
            </div>
            {certificates.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border mb-3">
                گواهی‌ای صادر نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 mb-3">
                {certificates.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-bold break-words">{c.titleFa}</div>
                      <div className="text-[11px] text-muted mt-0.5" dir="ltr">
                        {c.code} · {formatJalaliDate(c.createdAt)}
                        {c.score != null ? ` · ${toPersianDigits(c.score)}/۱۰۰` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDownloadCertificate(c, "png")}
                        className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        دانلود تصویر
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadCertificate(c, "pdf")}
                        className="text-[11px] font-bold text-accent bg-accent-soft px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        دانلود PDF
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[12px] text-muted mb-2">پاداش‌ها و جریمه‌ها</div>
            {rewards.length === 0 && penalties.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border mb-3">
                موردی ثبت نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 mb-3">
                {rewards.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone="success">پاداش</Badge>
                        <span className="text-[12.5px] font-bold break-words">{r.title}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 break-words">
                        {formatJalaliDate(r.date)}
                        {r.amount ? ` · ${formatToman(r.amount)}` : ""}
                        {r.description ? ` · ${r.description}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteReward(r.id)}
                      className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1 rounded-lg cursor-pointer shrink-0"
                    >
                      حذف
                    </button>
                  </div>
                ))}
                {penalties.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge tone="danger">جریمه</Badge>
                        <span className="text-[12.5px] font-bold break-words">{p.title}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 break-words">
                        {formatJalaliDate(p.date)}
                        {p.amount ? ` · ${formatToman(p.amount)}` : ""}
                        {p.description ? ` · ${p.description}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeletePenalty(p.id)}
                      className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1 rounded-lg cursor-pointer shrink-0"
                    >
                      حذف
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddAction} className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <select
                  value={actionKind}
                  onChange={(e) => setActionKind(e.target.value as "REWARD" | "PENALTY")}
                  className="text-[12px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                >
                  <option value="REWARD">پاداش</option>
                  <option value="PENALTY">جریمه</option>
                </select>
                <input
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  placeholder="عنوان"
                  className="flex-1 min-w-[120px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
                <input
                  value={actionAmount}
                  onChange={(e) => setActionAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="مبلغ (تومان، اختیاری)"
                  dir="ltr"
                  inputMode="numeric"
                  className="flex-1 min-w-[140px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={actionDescription}
                  onChange={(e) => setActionDescription(e.target.value)}
                  placeholder="توضیحات (اختیاری)"
                  className="flex-1 min-w-[140px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
                <button
                  type="submit"
                  disabled={savingAction || !actionTitle.trim()}
                  className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  افزودن
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <DeleteRecordButton confirmText="این پرسنل حذف شود؟ اگر فیش حقوقی، مرخصی یا سوابق دیگری دارد حذف نمی‌شود و باید «خاتمه‌ی همکاری» ثبت کنید." onDelete={() => deleteEmployee(employeeId)} onDeleted={() => { onChanged?.(); onClose(); }} />
    </Modal>
  );
}
