"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CalendarIcon, PlusIcon, ChevronDownIcon, SettingsIcon, PhoneIcon, SendIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import {
  toPersianDigits,
  formatToman,
  formatJalaliDateTime,
  toJalali,
  toGregorian,
  JALALI_MONTHS,
  WEEKDAYS_SHORT_FA,
} from "@/lib/persian";
import {
  fetchAppointments,
  fetchServiceTypes,
  confirmAppointment,
  completeAppointment,
  noShowAppointment,
  cancelAppointment,
  approveCoordination,
  sendAppointmentDetails,
  rejectCoordination,
  type Appointment,
  type AppointmentStatus,
  type ServiceType,
} from "@/lib/api";
import { NewAppointmentModal } from "@/components/booking/NewAppointmentModal";
import { AppointmentDetailModal } from "@/components/booking/AppointmentDetailModal";
import { ManualPaymentModal } from "@/components/booking/ManualPaymentModal";
import { ServiceTypesModal } from "@/components/booking/ServiceTypesModal";
import { StaffAvailabilityModal } from "@/components/booking/StaffAvailabilityModal";
import { AppointmentsReportModal } from "@/components/booking/AppointmentsReportModal";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING_COORDINATION: "در انتظار هماهنگی",
  SCHEDULED: "رزروشده",
  CONFIRMED: "تأییدشده",
  COMPLETED: "انجام‌شده",
  CANCELLED: "لغوشده",
  NO_SHOW: "عدم‌حضور",
};

const STATUS_TONES: Record<AppointmentStatus, "primary" | "success" | "neutral" | "danger" | "warning"> = {
  PENDING_COORDINATION: "warning",
  SCHEDULED: "primary",
  CONFIRMED: "success",
  COMPLETED: "neutral",
  CANCELLED: "danger",
  NO_SHOW: "warning",
};

function dayBounds(date: Date) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

/** هفته‌ی ایرانی از شنبه شروع می‌شود — تاریخ شنبه‌ی همان هفته را برمی‌گرداند. */
function startOfWeek(date: Date) {
  const d = new Date(date);
  const diff = (d.getDay() + 1) % 7; // فاصله تا شنبه (getDay: 0=یکشنبه..6=شنبه)
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** کلید محلی yyyy-mm-dd (نه UTC) — toISOString برای منطقه‌ی زمانی ایران می‌تواند به روز قبل لغزش کند. */
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ViewMode = "day" | "upcoming" | "history";

function CoordinationCard({ a, onChanged }: { a: Appointment; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function handleApprove() {
    setBusy(true);
    try {
      await approveCoordination(a.id, {});
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "تأیید ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rejectCoordination(a.id, reason.trim() || undefined);
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "رد درخواست ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-warning-soft border border-warning/20 rounded-xl p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[13px] font-bold">{a.customerName}</div>
          <div className="text-[11.5px] text-muted mt-0.5">
            {a.serviceType.name} · زمان پیشنهادی: {formatJalaliDateTime(a.startAt)}
            {a.customerPhone ? ` · ${a.customerPhone}` : ""}
          </div>
        </div>
        {!rejecting && (
          <div className="flex items-center gap-1.5">
            <button
              disabled={busy}
              onClick={handleApprove}
              className="text-[11px] font-bold text-white bg-primary px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
            >
              تأیید با همین زمان
            </button>
            <button
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="text-[11px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
            >
              رد درخواست
            </button>
          </div>
        )}
      </div>
      {rejecting && (
        <form onSubmit={handleReject} className="flex items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="دلیل رد (اختیاری)"
            className="flex-1 text-[12px] outline-none bg-white border border-border rounded-lg px-2.5 py-1.5"
          />
          <button type="submit" disabled={busy} className="text-[11px] font-bold text-white bg-danger px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
            تأیید رد
          </button>
          <button type="button" onClick={() => setRejecting(false)} className="text-[11px] font-bold text-ink-soft">
            انصراف
          </button>
        </form>
      )}
    </div>
  );
}

export default function BookingPage() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [pending, setPending] = useState<Appointment[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [reopening, setReopening] = useState<Appointment | null>(null);
  const [viewing, setViewing] = useState<Appointment | null>(null);
  const [payingFor, setPayingFor] = useState<Appointment | null>(null);
  const [serviceTypesOpen, setServiceTypesOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [weekCounts, setWeekCounts] = useState<Record<string, number>>({});
  const { me } = useWorkspace();

  async function copyBookingLink() {
    if (!me) return;
    const url = `${window.location.origin}/book/${me.tenant.publicKey ?? me.tenant.slug}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  function reload() {
    fetchAppointments({ status: "PENDING_COORDINATION" })
      .then(setPending)
      .catch(() => setPending([]));

    if (viewMode === "day") {
      const { from, to } = dayBounds(selectedDate);
      fetchAppointments({ from: from.toISOString(), to: to.toISOString() })
        .then((list) => setAppointments(list.filter((a) => a.status !== "PENDING_COORDINATION")))
        .catch(() => setAppointments([]));
    } else if (viewMode === "upcoming") {
      fetchAppointments({ from: new Date().toISOString() })
        .then((list) => setAppointments(list.filter((a) => a.status !== "PENDING_COORDINATION" && a.status !== "CANCELLED")))
        .catch(() => setAppointments([]));
    } else {
      fetchAppointments({ to: new Date().toISOString() })
        .then((list) => setAppointments(list.slice().reverse()))
        .catch(() => setAppointments([]));
    }
  }
  useEffect(reload, [selectedDate, viewMode]);
  useEffect(() => {
    fetchServiceTypes().then(setServiceTypes).catch(() => setServiceTypes([]));
  }, []);

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)),
    [weekStart],
  );

  useEffect(() => {
    if (viewMode !== "day") return;
    const from = weekStart;
    const to = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
    fetchAppointments({ from: from.toISOString(), to: to.toISOString() })
      .then((list) => {
        const counts: Record<string, number> = {};
        for (const a of list) {
          if (a.status === "PENDING_COORDINATION" || a.status === "CANCELLED") continue;
          const k = dateKey(new Date(a.startAt));
          counts[k] = (counts[k] ?? 0) + 1;
        }
        setWeekCounts(counts);
      })
      .catch(() => setWeekCounts({}));
  }, [weekStart, viewMode]);

  function shiftDay(delta: number) {
    const { year, month, day } = toJalali(selectedDate);
    setSelectedDate(toGregorian(year, month, day + delta));
  }

  const jalali = useMemo(() => toJalali(selectedDate), [selectedDate]);
  const isToday = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t.getTime() === selectedDate.getTime();
  }, [selectedDate]);

  async function runAction(fn: () => Promise<unknown>, id: string) {
    setBusyId(id);
    try {
      await fn();
      reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "عملیات ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1000px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">رزرو نوبت</h1>
            <ModuleHelp code="booking" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">مدیریت نوبت‌های دریافت خدمات و جلوگیری از تداخل زمانی</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setReportOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            گزارش
          </button>
          <button
            onClick={() => setAvailabilityOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            وقت‌های آزاد من
          </button>
          <button
            onClick={copyBookingLink}
            disabled={!me}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            <SendIcon className="w-4 h-4" />
            {linkCopied ? "لینک کپی شد" : "لینک رزرو آنلاین"}
          </button>
          <button
            onClick={() => setServiceTypesOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SettingsIcon className="w-4 h-4" />
            انواع خدمت
          </button>
          <button
            onClick={() => setNewOpen(true)}
            disabled={serviceTypes.length === 0}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            <PlusIcon className="w-4 h-4" />
            نوبت جدید
          </button>
        </div>
      </div>

      {serviceTypes.length === 0 ? (
        <Card className="mt-6 p-5 text-[13px] text-ink-soft">
          هنوز نوع خدمتی تعریف نکرده‌اید. از «انواع خدمت» یکی اضافه کنید تا بتوانید نوبت ثبت کنید.
        </Card>
      ) : null}

      {pending.length > 0 && (
        <div className="mt-6">
          <div className="text-[13px] font-bold mb-2.5 flex items-center gap-2">
            درخواست‌های در انتظار هماهنگی
            <Badge tone="warning">{toPersianDigits(pending.length)}</Badge>
          </div>
          <div className="flex flex-col gap-2.5">
            {pending.map((a) => (
              <CoordinationCard key={a.id} a={a} onChanged={reload} />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 mt-6 w-fit">
        {(["day", "upcoming", "history"] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setViewMode(v)}
            className={clsx(
              "text-[12px] font-bold px-3.5 py-2 rounded-lg cursor-pointer",
              viewMode === v ? "bg-white text-primary shadow-sm" : "text-muted",
            )}
          >
            {v === "day" ? "روز" : v === "upcoming" ? "پیش رو" : "تاریخچه"}
          </button>
        ))}
      </div>

      {viewMode === "day" && (
        <div className="mt-4 mb-4">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => shiftDay(-7)}
              className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-ink-soft cursor-pointer shrink-0"
              aria-label="هفته قبل"
            >
              <ChevronDownIcon className="w-4 h-4 -rotate-90" />
            </button>
            <div className="flex items-center gap-2.5">
              <CalendarIcon className="w-4 h-4 text-muted" />
              <div className="text-[14px] font-bold">
                {toPersianDigits(jalali.day)} {JALALI_MONTHS[jalali.month - 1]} {toPersianDigits(jalali.year)}
                {isToday ? <span className="text-primary text-[11.5px] font-bold mr-2">(امروز)</span> : null}
              </div>
            </div>
            <button
              onClick={() => shiftDay(7)}
              className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-ink-soft cursor-pointer shrink-0"
              aria-label="هفته بعد"
            >
              <ChevronDownIcon className="w-4 h-4 rotate-90" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1.5 mt-3">
            {weekDays.map((d) => {
              const k = dateKey(d);
              const dj = toJalali(d);
              const count = weekCounts[k] ?? 0;
              const selected = dateKey(d) === dateKey(selectedDate);
              const today = dateKey(d) === dateKey(new Date());
              return (
                <button
                  key={k}
                  onClick={() => setSelectedDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()))}
                  className={clsx(
                    "flex flex-col items-center gap-1 rounded-xl py-2.5 cursor-pointer border transition-colors",
                    selected ? "bg-primary border-primary text-white" : "bg-surface border-border text-ink-soft hover:border-primary/40",
                  )}
                >
                  <span className="text-[10.5px] font-semibold opacity-80">{WEEKDAYS_SHORT_FA[d.getDay()]}</span>
                  <span className={clsx("text-[13px] font-extrabold", today && !selected && "text-primary")}>
                    {toPersianDigits(dj.day)}
                  </span>
                  <span
                    className={clsx(
                      "w-1.5 h-1.5 rounded-full",
                      count > 0 ? (selected ? "bg-white" : "bg-primary") : "bg-transparent",
                    )}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Card className={clsx("p-2", viewMode !== "day" && "mt-4")}>
        {appointments === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : appointments.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            {viewMode === "day" ? "نوبتی برای این روز ثبت نشده" : viewMode === "upcoming" ? "نوبت پیش‌رویی ثبت نشده" : "تاریخچه‌ای وجود ندارد"}
          </div>
        ) : (
          appointments.map((a, i) => {
            const isBusy = busyId === a.id;
            return (
              <div
                key={a.id}
                onClick={() => setViewing(a)}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3.5 flex-wrap cursor-pointer hover:bg-slate-50",
                  i < appointments.length - 1 && "border-b border-border",
                )}
              >
                <div className="text-[13px] font-extrabold w-[70px] shrink-0" dir="ltr">
                  {viewMode === "day"
                    ? new Date(a.startAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })
                    : ""}
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-[13px] font-bold">{a.customerName}</div>
                  <div className="text-[11.5px] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                    {viewMode !== "day" && <span>{formatJalaliDateTime(a.startAt)}</span>}
                    <span>{a.serviceType.name}</span>
                    {a.provider ? <span>· {a.provider.name}</span> : null}
                    {a.customerPhone ? (
                      <span className="flex items-center gap-1" dir="ltr">
                        <PhoneIcon className="w-3 h-3" />
                        {a.customerPhone}
                      </span>
                    ) : null}
                    {a.paymentStatus === "PENDING" ? <span className="text-warning font-semibold">{a.isFullPayment ? "در انتظار پرداخت کامل" : "در انتظار پرداخت بیعانه"}</span> : null}
                    {a.paymentStatus === "PAID" ? <span className="text-success font-semibold">{a.isFullPayment ? "پرداخت کامل شده" : "بیعانه پرداخت‌شده"}</span> : null}
                    {a.mentoringSession ? (
                      <a href="/mentoring" className="text-primary font-semibold">
                        · جلسه‌ی مشاوره (صورتجلسه)
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="text-[11.5px] text-muted hidden sm:block">{formatToman(a.serviceType.price)}</div>
                <Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  {(a.status === "SCHEDULED" || a.status === "CONFIRMED" || a.status === "PENDING_COORDINATION") ? (
                    <button
                      disabled={isBusy}
                      onClick={() => setEditing(a)}
                      className="text-[11px] font-bold text-ink-soft bg-slate-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      ویرایش / جابه‌جایی
                    </button>
                  ) : null}
                  {a.paymentStatus !== "PAID" && (a.status === "SCHEDULED" || a.status === "CONFIRMED") ? (
                    <button
                      disabled={isBusy}
                      onClick={() => setPayingFor(a)}
                      className="text-[11px] font-bold text-accent bg-accent-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      ثبت پرداخت
                    </button>
                  ) : null}
                  {a.customerPhone && a.status !== "CANCELLED" ? (
                    <button
                      disabled={isBusy}
                      onClick={() => runAction(() => sendAppointmentDetails(a.id), a.id)}
                      className="text-[11px] font-bold text-ink-soft bg-slate-100 px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      ارسال جزئیات
                    </button>
                  ) : null}
                  {a.status === "SCHEDULED" ? (
                    <button
                      disabled={isBusy}
                      onClick={() => runAction(() => confirmAppointment(a.id), a.id)}
                      className="text-[11px] font-bold text-primary bg-primary-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      تأیید
                    </button>
                  ) : null}
                  {(a.status === "SCHEDULED" || a.status === "CONFIRMED") ? (
                    <>
                      <button
                        disabled={isBusy}
                        onClick={() => runAction(() => completeAppointment(a.id), a.id)}
                        className="text-[11px] font-bold text-success bg-success-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        انجام شد
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => runAction(() => noShowAppointment(a.id), a.id)}
                        className="text-[11px] font-bold text-warning bg-warning-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        عدم‌حضور
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => runAction(() => cancelAppointment(a.id), a.id)}
                        className="text-[11px] font-bold text-danger bg-danger-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        لغو
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </Card>

      {newOpen ? (
        <NewAppointmentModal
          serviceTypes={serviceTypes}
          defaultStart={selectedDate}
          onClose={() => setNewOpen(false)}
          onCreated={reload}
        />
      ) : null}
      {viewing ? (
        <AppointmentDetailModal
          appointment={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
          onReopen={() => {
            setReopening(viewing);
            setViewing(null);
          }}
          onPay={() => {
            setPayingFor(viewing);
            setViewing(null);
          }}
          onChanged={reload}
        />
      ) : null}
      {reopening ? (
        <NewAppointmentModal serviceTypes={serviceTypes} defaultStart={selectedDate} appointment={reopening} reopen onClose={() => setReopening(null)} onCreated={reload} />
      ) : null}
      {editing ? (
        <NewAppointmentModal
          serviceTypes={serviceTypes}
          defaultStart={selectedDate}
          appointment={editing}
          onClose={() => setEditing(null)}
          onCreated={reload}
        />
      ) : null}
      {payingFor ? (
        <ManualPaymentModal
          appointment={payingFor}
          onClose={() => setPayingFor(null)}
          onDone={() => {
            setPayingFor(null);
            reload();
          }}
        />
      ) : null}
      {serviceTypesOpen ? (
        <ServiceTypesModal
          onClose={() => setServiceTypesOpen(false)}
          onChanged={() => fetchServiceTypes().then(setServiceTypes).catch(() => {})}
        />
      ) : null}
      {availabilityOpen ? <StaffAvailabilityModal onClose={() => setAvailabilityOpen(false)} /> : null}
      {reportOpen ? <AppointmentsReportModal onClose={() => setReportOpen(false)} /> : null}
    </div>
  );
}
