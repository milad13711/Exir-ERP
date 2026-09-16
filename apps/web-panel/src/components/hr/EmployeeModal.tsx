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
  fetchCertificates,
  issueCertificate,
  deleteCertificate,
  fetchCertificateImageObjectUrl,
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
  const [editBaseSalary, setEditBaseSalary] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [kpiOpen, setKpiOpen] = useState(false);

  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [certCourseTitle, setCertCourseTitle] = useState("");
  const [certCourseTitleEn, setCertCourseTitleEn] = useState("");
  const [certDuration, setCertDuration] = useState("");
  const [certStartDate, setCertStartDate] = useState("");
  const [certEndDate, setCertEndDate] = useState("");
  const [certScore, setCertScore] = useState("");
  const [savingCert, setSavingCert] = useState(false);

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
    fetchCertificates(employeeId).then(setCertificates);
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
        departmentId: editDepartmentId || undefined,
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

  async function handleIssueCertificate(e: React.FormEvent) {
    e.preventDefault();
    if (!certCourseTitle.trim()) return;
    setSavingCert(true);
    try {
      await issueCertificate({
        employeeId,
        courseTitleFa: certCourseTitle.trim(),
        courseTitleEn: certCourseTitleEn.trim() || undefined,
        durationHours: certDuration ? Number(certDuration) : undefined,
        startDate: certStartDate || undefined,
        endDate: certEndDate || undefined,
        score: certScore ? Number(certScore) : undefined,
      });
      setCertCourseTitle("");
      setCertCourseTitleEn("");
      setCertDuration("");
      setCertStartDate("");
      setCertEndDate("");
      setCertScore("");
      reloadCertificates();
    } finally {
      setSavingCert(false);
    }
  }

  async function handleDeleteCertificate(id: string) {
    if (!window.confirm("این گواهی حذف شود؟")) return;
    await deleteCertificate(id);
    reloadCertificates();
  }

  async function handleDownloadCertificate(cert: Certificate) {
    const url = await fetchCertificateImageObjectUrl(cert.id);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certificate-${cert.code}.png`;
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

          <div>
            <div className="text-[12px] text-muted mb-2">گواهی‌نامه‌ها</div>
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
                      <div className="text-[12.5px] font-bold break-words">{c.courseTitleFa}</div>
                      <div className="text-[11px] text-muted mt-0.5" dir="ltr">
                        {c.code} · {formatJalaliDate(c.createdAt)}
                        {c.score != null ? ` · ${toPersianDigits(c.score)}/۱۰۰` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDownloadCertificate(c)}
                        className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        دانلود تصویر
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCertificate(c.id)}
                        className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1 rounded-lg cursor-pointer"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleIssueCertificate} className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <input
                  value={certCourseTitle}
                  onChange={(e) => setCertCourseTitle(e.target.value)}
                  placeholder="عنوان دوره (فارسی)"
                  className="flex-1 min-w-[140px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
                <input
                  value={certCourseTitleEn}
                  onChange={(e) => setCertCourseTitleEn(e.target.value)}
                  placeholder="عنوان دوره (انگلیسی، اختیاری)"
                  dir="ltr"
                  className="flex-1 min-w-[140px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={certDuration}
                  onChange={(e) => setCertDuration(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="مدت (ساعت)"
                  dir="ltr"
                  inputMode="numeric"
                  className="flex-1 min-w-[90px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
                <input
                  value={certStartDate}
                  onChange={(e) => setCertStartDate(e.target.value)}
                  type="date"
                  dir="ltr"
                  className="flex-1 min-w-[130px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
                <input
                  value={certEndDate}
                  onChange={(e) => setCertEndDate(e.target.value)}
                  type="date"
                  dir="ltr"
                  className="flex-1 min-w-[130px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
                <input
                  value={certScore}
                  onChange={(e) => setCertScore(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="امتیاز (از ۱۰۰)"
                  dir="ltr"
                  inputMode="numeric"
                  className="flex-1 min-w-[110px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-2 outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={savingCert || !certCourseTitle.trim()}
                className="self-stretch sm:self-end text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {savingCert ? "در حال صدور..." : "صدور گواهی"}
              </button>
            </form>
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
    </Modal>
  );
}
