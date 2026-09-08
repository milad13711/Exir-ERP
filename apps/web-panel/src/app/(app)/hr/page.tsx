"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { HrIcon, PlusIcon, SearchIcon, CheckIcon } from "@/components/icons";
import { formatToman, formatJalaliDate, toPersianDigits, toJalali } from "@/lib/persian";
import {
  fetchEmployees,
  fetchHrSummary,
  fetchAttendance,
  markAttendance,
  fetchLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
  fetchPayroll,
  generatePayroll,
  updatePayrollSlip,
  issuePayrollSlip,
  payPayrollSlip,
  openPayrollSlipPdf,
  fetchPayrollTaxSettings,
  updatePayrollTaxSettings,
  fetchOrgChart,
  type Employee,
  type HrSummary,
  type LeaveRequest,
  type PayrollSlip,
  type OrgChartEntry,
} from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_TONES,
  PAYROLL_STATUS_LABELS,
  PAYROLL_STATUS_TONES,
  JALALI_MONTH_NAMES,
} from "@/components/hr/hr-shared";
import { NewEmployeeModal } from "@/components/hr/NewEmployeeModal";
import { EmployeeModal } from "@/components/hr/EmployeeModal";
import { NewLeaveModal } from "@/components/hr/NewLeaveModal";
import { ExcelImportExportBar } from "@/components/shared/ExcelImportExportBar";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
type Tab = "employees" | "orgchart" | "attendance" | "leave" | "payroll";
const TODAY = new Date().toISOString().slice(0, 10);

export default function HrPage() {
  const [tab, setTab] = useState<Tab>("employees");
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [summary, setSummary] = useState<HrSummary | null>(null);
  const [search, setSearch] = useState("");

  const [openEmployeeId, setOpenEmployeeId] = useState<string | null>(null);
  const [newEmployeeOpen, setNewEmployeeOpen] = useState(false);
  const [newLeaveOpen, setNewLeaveOpen] = useState(false);

  function reloadCore() {
    fetchEmployees().then(setEmployees).catch(() => setEmployees([]));
    fetchHrSummary().then(setSummary).catch(() => {});
  }
  useEffect(reloadCore, []);

  const filteredEmployees = useMemo(() => {
    if (!employees) return [];
    if (!search.trim()) return employees;
    return employees.filter(
      (e) => e.fullName.includes(search) || e.employeeCode.includes(search) || e.position.includes(search),
    );
  }, [employees, search]);

  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">منابع انسانی و حقوق</h1>
            <ModuleHelp code="hr" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">پرونده پرسنلی، حضور و غیاب، مرخصی و فیش حقوقی</p>
        </div>
        <button
          onClick={() => (tab === "leave" ? setNewLeaveOpen(true) : setNewEmployeeOpen(true))}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer shrink-0"
        >
          <PlusIcon className="w-4 h-4" />
          {tab === "leave" ? "درخواست مرخصی" : "کارمند جدید"}
        </button>
      </div>

      {summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <KpiCard label="تعداد پرسنل فعال" value={summary.totalEmployees} unitSuffix="نفر" tone="primary" icon={<HrIcon />} />
          <KpiCard label="حاضر امروز" value={summary.presentToday} unitSuffix="نفر" tone="success" icon={<HrIcon />} />
          <KpiCard
            label="مرخصی در انتظار بررسی"
            value={summary.pendingLeaveCount}
            unitSuffix="درخواست"
            tone="warning"
            icon={<HrIcon />}
            note={summary.pendingLeaveCount > 0 ? "نیازمند بررسی" : undefined}
          />
          <KpiCard label="جمع حقوق پایه ماهانه" value={summary.monthlyPayrollTotal} unitSuffix="تومان" tone="accent" icon={<HrIcon />} />
        </div>
      ) : null}

      <div className="flex items-center gap-2 mt-7 border-b border-border overflow-x-auto">
        {(
          [
            ["employees", "پرسنل"],
            ["orgchart", "نمودار سازمانی"],
            ["attendance", "حضور و غیاب"],
            ["leave", "مرخصی‌ها"],
            ["payroll", "فیش حقوق"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors whitespace-nowrap",
              tab === key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink-soft",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "employees" ? (
        <>
          <div className="flex items-center gap-3 flex-wrap mt-5 mb-4">
            <div className="relative max-w-[320px] flex-1 min-w-[220px]">
              <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جستجوی نام، کد پرسنلی یا سمت..."
                className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
              />
            </div>
            <div className="mr-auto">
              <ExcelImportExportBar exportPath="/hr/employees/export" exportFilename="employees.xlsx" importPath="/hr/employees/import" onImported={reloadCore} />
            </div>
          </div>
          <Card className="p-2">
            {employees === null ? (
              <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-8 text-center text-muted text-sm">کارمندی یافت نشد</div>
            ) : (
              filteredEmployees.map((e, i) => (
                <button
                  key={e.id}
                  onClick={() => setOpenEmployeeId(e.id)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                    i < filteredEmployees.length - 1 && "border-b border-border",
                  )}
                >
                  <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0 text-[12px] font-extrabold">
                    {e.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("‌")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-bold truncate">{e.fullName}</div>
                    <div className="text-[11.5px] text-muted mt-0.5">
                      {e.position}
                      {e.department ? ` · ${e.department}` : ""}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted w-[140px] text-left shrink-0 hidden sm:block">
                    {formatToman(e.baseSalary)}
                  </div>
                </button>
              ))
            )}
          </Card>
        </>
      ) : null}

      {tab === "orgchart" ? <OrgChartTab onSelect={setOpenEmployeeId} /> : null}
      {tab === "attendance" ? <AttendanceTab /> : null}
      {tab === "leave" ? <LeaveTab /> : null}
      {tab === "payroll" ? <PayrollTab /> : null}

      {newEmployeeOpen ? (
        <NewEmployeeModal
          employees={employees ?? []}
          onClose={() => setNewEmployeeOpen(false)}
          onCreated={(employee) => {
            setEmployees((prev) => [employee, ...(prev ?? [])]);
            reloadCore();
          }}
        />
      ) : null}

      {openEmployeeId ? (
        <EmployeeModal
          employeeId={openEmployeeId}
          employees={employees ?? []}
          onClose={() => setOpenEmployeeId(null)}
          onChanged={reloadCore}
        />
      ) : null}

      {newLeaveOpen ? (
        <NewLeaveModal
          employees={employees ?? []}
          onClose={() => setNewLeaveOpen(false)}
          onCreated={() => reloadCore()}
        />
      ) : null}
    </div>
  );
}

function AttendanceTab() {
  const [rows, setRows] = useState<Array<{ employee: Employee; record: { status: string; checkIn: string | null; checkOut: string | null } | null }> | null>(
    null,
  );

  function reload() {
    fetchAttendance(TODAY).then(setRows as never).catch(() => setRows([]));
  }
  useEffect(reload, []);

  async function checkIn(employeeId: string) {
    await markAttendance({ employeeId, date: TODAY, status: "PRESENT", checkIn: new Date().toISOString() });
    reload();
  }
  async function checkOut(employeeId: string) {
    await markAttendance({ employeeId, date: TODAY, status: "PRESENT", checkOut: new Date().toISOString() });
    reload();
  }
  async function markAbsent(employeeId: string) {
    await markAttendance({ employeeId, date: TODAY, status: "ABSENT" });
    reload();
  }

  return (
    <Card className="mt-5 p-2">
      <div className="px-4 py-3 text-[12px] text-muted border-b border-border">
        حضور و غیاب امروز — {formatJalaliDate(TODAY)}
      </div>
      {rows === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-muted text-sm">کارمند فعالی یافت نشد</div>
      ) : (
        rows.map(({ employee, record }, i) => (
          <div
            key={employee.id}
            className={clsx(
              "flex items-center gap-3 px-4 py-3.5 flex-wrap",
              i < rows.length - 1 && "border-b border-border",
            )}
          >
            <div className="flex-1 min-w-[160px]">
              <div className="text-[13px] font-bold">{employee.fullName}</div>
              <div className="text-[11px] text-muted mt-0.5">{employee.position}</div>
            </div>
            {record ? (
              <div className="text-[11.5px] text-ink-soft flex items-center gap-3" dir="ltr">
                {record.checkIn ? <span>ورود {new Date(record.checkIn).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}</span> : null}
                {record.checkOut ? <span>خروج {new Date(record.checkOut).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}</span> : null}
              </div>
            ) : null}
            {record?.status === "ABSENT" ? (
              <Badge tone="danger">غایب</Badge>
            ) : record?.checkIn && !record?.checkOut ? (
              <Badge tone="success">حاضر</Badge>
            ) : record?.checkOut ? (
              <Badge tone="neutral">پایان کار</Badge>
            ) : (
              <Badge tone="neutral">ثبت‌نشده</Badge>
            )}
            <div className="flex items-center gap-2 shrink-0">
              {!record?.checkIn ? (
                <button
                  onClick={() => checkIn(employee.id)}
                  className="text-[11.5px] font-bold text-success bg-success-soft px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  ثبت ورود
                </button>
              ) : !record?.checkOut ? (
                <button
                  onClick={() => checkOut(employee.id)}
                  className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  ثبت خروج
                </button>
              ) : null}
              {!record ? (
                <button
                  onClick={() => markAbsent(employee.id)}
                  className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  غایب
                </button>
              ) : null}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

function LeaveTab() {
  const [leaves, setLeaves] = useState<LeaveRequest[] | null>(null);

  function reload() {
    fetchLeaveRequests().then(setLeaves).catch(() => setLeaves([]));
  }
  useEffect(reload, []);

  async function handleApprove(id: string) {
    await approveLeaveRequest(id);
    reload();
  }
  async function handleReject(id: string) {
    await rejectLeaveRequest(id);
    reload();
  }

  return (
    <Card className="mt-5 p-2">
      {leaves === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : leaves.length === 0 ? (
        <div className="p-8 text-center text-muted text-sm">درخواست مرخصی‌ای ثبت نشده است</div>
      ) : (
        leaves.map((l, i) => (
          <div
            key={l.id}
            className={clsx(
              "flex items-center gap-3 px-4 py-3.5 flex-wrap",
              i < leaves.length - 1 && "border-b border-border",
            )}
          >
            <div className="flex-1 min-w-[200px]">
              <div className="text-[13px] font-bold">{l.employee.fullName}</div>
              <div className="text-[11.5px] text-muted mt-0.5">
                {LEAVE_TYPE_LABELS[l.type]} · {formatJalaliDate(l.startDate)} تا {formatJalaliDate(l.endDate)} ·{" "}
                {toPersianDigits(l.daysCount)} روز
              </div>
              {l.reason ? <div className="text-[11.5px] text-muted mt-0.5">{l.reason}</div> : null}
            </div>
            <Badge tone={LEAVE_STATUS_TONES[l.status]}>{LEAVE_STATUS_LABELS[l.status]}</Badge>
            {l.status === "PENDING" ? (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleApprove(l.id)}
                  className="text-[11.5px] font-bold text-success bg-success-soft px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  تأیید
                </button>
                <button
                  onClick={() => handleReject(l.id)}
                  className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  رد
                </button>
              </div>
            ) : null}
          </div>
        ))
      )}
    </Card>
  );
}

function PayrollTab() {
  const nowJalali = toJalali(new Date());
  const [year, setYear] = useState(nowJalali.year);
  const [month, setMonth] = useState(nowJalali.month);
  const [slips, setSlips] = useState<PayrollSlip[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [taxSettingsOpen, setTaxSettingsOpen] = useState(false);

  function reload() {
    fetchPayroll(year, month).then(setSlips).catch(() => setSlips([]));
  }
  useEffect(reload, [year, month]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const generated = await generatePayroll(year, month);
      setSlips(generated);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2.5 mb-4 flex-wrap">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="text-[13px] bg-surface border border-border rounded-xl px-3 py-2.5 outline-none"
        >
          {JALALI_MONTH_NAMES.map((name, idx) => (
            <option key={name} value={idx + 1}>
              {name}
            </option>
          ))}
        </select>
        <input
          value={year}
          onChange={(e) => setYear(Number(e.target.value.replace(/[^0-9]/g, "")) || year)}
          className="text-[13px] bg-surface border border-border rounded-xl px-3 py-2.5 outline-none w-24"
          dir="ltr"
        />
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-[12.5px] font-bold text-primary bg-primary-soft px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
        >
          {generating ? "در حال تولید..." : "تولید فیش‌های این ماه"}
        </button>
        <button
          onClick={() => setTaxSettingsOpen(true)}
          className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-4 py-2.5 rounded-xl cursor-pointer"
        >
          تنظیمات مالیات و بیمه
        </button>
      </div>

      <Card className="p-2">
        {slips === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : slips.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            فیشی برای این ماه صادر نشده — دکمه «تولید فیش‌های این ماه» را بزنید
          </div>
        ) : (
          slips.map((s, i) => (
            <PayrollRow key={s.id} slip={s} isLast={i === slips.length - 1} onChanged={reload} />
          ))
        )}
      </Card>

      {taxSettingsOpen ? <PayrollTaxSettingsModal onClose={() => setTaxSettingsOpen(false)} /> : null}
    </div>
  );
}

function PayrollTaxSettingsModal({ onClose }: { onClose: () => void }) {
  const [insuranceEmployeeRate, setInsuranceEmployeeRate] = useState("7");
  const [taxExemptionMonthly, setTaxExemptionMonthly] = useState("0");
  const [taxRate, setTaxRate] = useState("10");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPayrollTaxSettings().then((s) => {
      setInsuranceEmployeeRate(String(s.insuranceEmployeeRate));
      setTaxExemptionMonthly(String(s.taxExemptionMonthly));
      setTaxRate(String(s.taxRate));
      setLoaded(true);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await updatePayrollTaxSettings({
        insuranceEmployeeRate: Number(insuranceEmployeeRate) || 0,
        taxExemptionMonthly: Number(taxExemptionMonthly) || 0,
        taxRate: Number(taxRate) || 0,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="تنظیمات مالیات و بیمه‌ی حقوق" onClose={onClose}>
      {!loaded ? (
        <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <p className="text-[12px] text-muted">
            این نرخ‌ها روی فیش‌های جدید و ویرایش فیش‌های پیش‌نویس اعمال می‌شوند. سقف معافیت مالیاتی هرساله طبق قانون
            بودجه تغییر می‌کند — لازم است دستی به‌روز شود. محاسبه‌ی مالیات در این نسخه تک‌پله‌ای است، نه جدول تصاعدی
            کامل قانون مالیات مستقیم.
          </p>
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">سهم بیمه‌ی کارمند (٪ از حقوق ناخالص)</label>
            <input
              value={insuranceEmployeeRate}
              onChange={(e) => setInsuranceEmployeeRate(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">سقف معافیت مالیاتی ماهانه (تومان)</label>
            <input
              value={taxExemptionMonthly}
              onChange={(e) => setTaxExemptionMonthly(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-ink-soft mb-1.5 block">نرخ مالیات بر مازاد سقف معافیت (٪)</label>
            <input
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value.replace(/[^0-9]/g, ""))}
              dir="ltr"
              className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function PayrollRow({ slip, isLast, onChanged }: { slip: PayrollSlip; isLast: boolean; onChanged: () => void }) {
  const [allowances, setAllowances] = useState(String(slip.allowances));
  const [deductions, setDeductions] = useState(String(slip.deductions));
  const [busy, setBusy] = useState(false);
  const net =
    slip.baseSalary + Number(allowances || 0) - Number(deductions || 0) - slip.insuranceAmount - slip.taxAmount;
  const editable = slip.status === "DRAFT";

  async function saveAmounts() {
    setBusy(true);
    try {
      await updatePayrollSlip(slip.id, Number(allowances || 0), Number(deductions || 0));
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function handleIssue() {
    setBusy(true);
    try {
      await issuePayrollSlip(slip.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function handlePay() {
    setBusy(true);
    try {
      await payPayrollSlip(slip.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={clsx("flex items-center gap-3 px-4 py-3.5 flex-wrap", !isLast && "border-b border-border")}>
      <div className="flex-1 min-w-[160px]">
        <div className="text-[13px] font-bold">{slip.employee.fullName}</div>
        <div className="text-[11px] text-muted mt-0.5">{slip.employee.position}</div>
      </div>
      {editable ? (
        <div className="flex items-center gap-2 text-[11.5px]">
          <input
            value={allowances}
            onChange={(e) => setAllowances(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={saveAmounts}
            placeholder="مزایا"
            className="w-24 bg-slate-50 border border-border rounded-lg px-2 py-1.5 outline-none"
            dir="ltr"
          />
          <input
            value={deductions}
            onChange={(e) => setDeductions(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={saveAmounts}
            placeholder="کسورات"
            className="w-24 bg-slate-50 border border-border rounded-lg px-2 py-1.5 outline-none"
            dir="ltr"
          />
        </div>
      ) : null}
      <div className="text-[10.5px] text-muted shrink-0" dir="rtl">
        بیمه: {formatToman(slip.insuranceAmount)} · مالیات: {formatToman(slip.taxAmount)}
      </div>
      <div className="text-[13px] font-extrabold w-[130px] text-left shrink-0">{formatToman(net)}</div>
      <Badge tone={PAYROLL_STATUS_TONES[slip.status]}>{PAYROLL_STATUS_LABELS[slip.status]}</Badge>
      {slip.status === "DRAFT" ? (
        <button
          onClick={handleIssue}
          disabled={busy}
          className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
        >
          صدور فیش
        </button>
      ) : slip.status === "ISSUED" ? (
        <button
          onClick={handlePay}
          disabled={busy}
          className="flex items-center gap-1 text-[11.5px] font-bold text-success bg-success-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
        >
          <CheckIcon className="w-3.5 h-3.5" />
          ثبت پرداخت
        </button>
      ) : null}
      {slip.status !== "DRAFT" ? (
        <button
          onClick={() => openPayrollSlipPdf(slip.id)}
          className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer shrink-0"
        >
          PDF
        </button>
      ) : null}
    </div>
  );
}

function OrgChartTab({ onSelect }: { onSelect: (id: string) => void }) {
  const [entries, setEntries] = useState<OrgChartEntry[] | null>(null);

  useEffect(() => {
    fetchOrgChart().then(setEntries).catch(() => setEntries([]));
  }, []);

  if (entries === null) {
    return <div className="mt-5 p-8 text-center text-muted text-sm">در حال بارگذاری...</div>;
  }
  if (entries.length === 0) {
    return <div className="mt-5 p-8 text-center text-muted text-sm">هنوز کارمندی ثبت نشده است</div>;
  }

  const roots = entries.filter((e) => !e.managerId || !entries.some((x) => x.id === e.managerId));
  const childrenOf = (id: string) => entries.filter((e) => e.managerId === id);

  return (
    <Card className="mt-5 p-4">
      <div className="flex flex-col gap-1">
        {roots.map((r) => (
          <OrgChartNode key={r.id} entry={r} depth={0} childrenOf={childrenOf} onSelect={onSelect} />
        ))}
      </div>
    </Card>
  );
}

function OrgChartNode({
  entry,
  depth,
  childrenOf,
  onSelect,
}: {
  entry: OrgChartEntry;
  depth: number;
  childrenOf: (id: string) => OrgChartEntry[];
  onSelect: (id: string) => void;
}) {
  const children = childrenOf(entry.id);
  return (
    <div>
      <button
        onClick={() => onSelect(entry.id)}
        className="w-full flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-slate-50 cursor-pointer text-right"
        style={{ paddingRight: `${depth * 28 + 10}px` }}
      >
        <div className="w-7 h-7 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0 text-[11px] font-extrabold">
          {entry.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("‌")}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold truncate">{entry.fullName}</div>
          <div className="text-[11px] text-muted truncate">
            {entry.position}
            {entry.department ? ` · ${entry.department}` : ""}
          </div>
        </div>
      </button>
      {children.length > 0 ? (
        <div className="border-r border-border mr-[23px]">
          {children.map((c) => (
            <OrgChartNode key={c.id} entry={c} depth={depth + 1} childrenOf={childrenOf} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
