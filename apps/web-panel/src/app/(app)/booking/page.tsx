"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CalendarIcon, PlusIcon, ChevronDownIcon, SettingsIcon, PhoneIcon } from "@/components/icons";
import { toPersianDigits, formatToman, toJalali, toGregorian, JALALI_MONTHS } from "@/lib/persian";
import {
  fetchAppointments,
  fetchServiceTypes,
  confirmAppointment,
  completeAppointment,
  noShowAppointment,
  cancelAppointment,
  type Appointment,
  type AppointmentStatus,
  type ServiceType,
} from "@/lib/api";
import { NewAppointmentModal } from "@/components/booking/NewAppointmentModal";
import { ServiceTypesModal } from "@/components/booking/ServiceTypesModal";

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: "رزروشده",
  CONFIRMED: "تأییدشده",
  COMPLETED: "انجام‌شده",
  CANCELLED: "لغوشده",
  NO_SHOW: "عدم‌حضور",
};

const STATUS_TONES: Record<AppointmentStatus, "primary" | "success" | "neutral" | "danger" | "warning"> = {
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

export default function BookingPage() {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [serviceTypesOpen, setServiceTypesOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    const { from, to } = dayBounds(selectedDate);
    fetchAppointments({ from: from.toISOString(), to: to.toISOString() })
      .then(setAppointments)
      .catch(() => setAppointments([]));
  }
  useEffect(reload, [selectedDate]);
  useEffect(() => {
    fetchServiceTypes().then(setServiceTypes).catch(() => setServiceTypes([]));
  }, []);

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
          <h1 className="text-xl font-extrabold">رزرو نوبت</h1>
          <p className="text-[13.5px] text-muted mt-1">مدیریت نوبت‌های دریافت خدمات و جلوگیری از تداخل زمانی</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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

      <div className="flex items-center justify-between gap-3 mt-6 mb-4">
        <button
          onClick={() => shiftDay(1)}
          className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-ink-soft cursor-pointer"
          aria-label="روز بعد"
        >
          <ChevronDownIcon className="w-4 h-4 rotate-90" />
        </button>
        <div className="flex items-center gap-2.5">
          <CalendarIcon className="w-4 h-4 text-muted" />
          <div className="text-[14px] font-bold">
            {toPersianDigits(jalali.day)} {JALALI_MONTHS[jalali.month - 1]} {toPersianDigits(jalali.year)}
            {isToday ? <span className="text-primary text-[11.5px] font-bold mr-2">(امروز)</span> : null}
          </div>
        </div>
        <button
          onClick={() => shiftDay(-1)}
          className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-ink-soft cursor-pointer"
          aria-label="روز قبل"
        >
          <ChevronDownIcon className="w-4 h-4 -rotate-90" />
        </button>
      </div>

      <Card className="p-2">
        {appointments === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : appointments.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">نوبتی برای این روز ثبت نشده</div>
        ) : (
          appointments.map((a, i) => {
            const isBusy = busyId === a.id;
            return (
              <div
                key={a.id}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3.5 flex-wrap",
                  i < appointments.length - 1 && "border-b border-border",
                )}
              >
                <div className="text-[13px] font-extrabold w-[70px] shrink-0" dir="ltr">
                  {new Date(a.startAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-[13px] font-bold">{a.customerName}</div>
                  <div className="text-[11.5px] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{a.serviceType.name}</span>
                    {a.provider ? <span>· {a.provider.name}</span> : null}
                    {a.customerPhone ? (
                      <span className="flex items-center gap-1" dir="ltr">
                        <PhoneIcon className="w-3 h-3" />
                        {a.customerPhone}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-[11.5px] text-muted hidden sm:block">{formatToman(a.serviceType.price)}</div>
                <Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
                <div className="flex items-center gap-1.5 shrink-0">
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
      {serviceTypesOpen ? (
        <ServiceTypesModal
          onClose={() => setServiceTypesOpen(false)}
          onChanged={() => fetchServiceTypes().then(setServiceTypes).catch(() => {})}
        />
      ) : null}
    </div>
  );
}
