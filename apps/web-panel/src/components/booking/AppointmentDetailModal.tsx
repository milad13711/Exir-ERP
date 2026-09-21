import { useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { copyToClipboard } from "@/lib/clipboard";
import { formatJalaliDateTime, formatToman } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import { deleteAppointment, sendAppointmentDetails, ApiError, type Appointment } from "@/lib/api";

const STATUS_LABEL: Record<Appointment["status"], string> = {
  PENDING_COORDINATION: "در انتظار هماهنگی",
  SCHEDULED: "ثبت‌شده",
  CONFIRMED: "تأیید شده",
  COMPLETED: "انجام شده",
  CANCELLED: "لغو شده",
  NO_SHOW: "عدم حضور",
};
const METHOD_LABEL: Record<string, string> = { ZARINPAL: "درگاه آنلاین", CASH: "نقد", CARD: "کارت‌خوان", TRANSFER: "کارت‌به‌کارت / انتقال" };

/** مشاهده‌ی کامل یک نوبت (در هر وضعیتی، از جمله لغوشده) + ویرایش، بازگشایی، ثبت پرداخت، ارسال جزئیات و حذف. */
export function AppointmentDetailModal({
  appointment: a,
  onClose,
  onEdit,
  onReopen,
  onPay,
  onChanged,
}: {
  appointment: Appointment;
  onClose: () => void;
  onEdit: () => void;
  onReopen: () => void;
  onPay: () => void;
  onChanged: () => void;
}) {
  const { me } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const closedStatus = a.status === "CANCELLED" || a.status === "NO_SHOW";

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "انجام عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function copy(path: string) {
    const ok = await copyToClipboard(`${window.location.origin}${path}`);
    setMsg(ok ? "لینک کپی شد ✓" : "کپی ناموفق بود");
  }

  return (
    <Modal title={`نوبت — ${a.customerName}`} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={a.status === "CANCELLED" || a.status === "NO_SHOW" ? "danger" : a.status === "COMPLETED" ? "success" : "primary"}>{STATUS_LABEL[a.status]}</Badge>
          {a.paymentStatus === "PAID" && <Badge tone="success">{a.isFullPayment ? "پرداخت کامل" : "بیعانه"} پرداخت‌شده</Badge>}
          {a.paymentStatus === "PENDING" && <Badge tone="warning">در انتظار پرداخت</Badge>}
        </div>

        <div className="border border-border rounded-xl overflow-hidden text-[12.5px]">
          <Row label="مشتری" value={a.customerName} />
          <Row label="تلفن" value={a.customerPhone ?? "—"} ltr />
          {a.contact && (
            <div className="flex border-b border-border">
              <div className="w-[120px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">مخاطب CRM</div>
              <div className="flex-1 px-3 py-2.5">
                <Link href="/crm" className="text-primary font-bold">{a.contact.name}</Link>
              </div>
            </div>
          )}
          <Row label="خدمت" value={`${a.serviceType.name} · ${a.serviceType.durationMinutes} دقیقه · ${formatToman(a.serviceType.price)}`} />
          <Row label="زمان" value={`${formatJalaliDateTime(a.startAt)}`} />
          <Row label="کارشناس" value={a.provider ? `${a.provider.name}${a.provider.phone ? ` — ${a.provider.phone}` : ""}` : "بدون تخصیص"} />
          {a.location && <Row label="آدرس اختصاصی" value={a.location} />}
          {a.notes && <Row label="یادداشت" value={a.notes} />}
          {a.cancelReason && <Row label="دلیل لغو" value={a.cancelReason} />}
          {a.paymentStatus === "PAID" && (
            <Row
              label="پرداخت"
              value={`${formatToman(a.depositAmount ?? 0)} · ${METHOD_LABEL[a.paymentMethod ?? ""] ?? a.paymentMethod ?? "—"}${a.paymentRefId ? ` · کد پیگیری ${a.paymentRefId}` : ""}${a.paidAt ? ` · ${formatJalaliDateTime(a.paidAt)}` : ""}`}
            />
          )}
          {a.mentoringSession && (
            <div className="flex border-b border-border last:border-b-0">
              <div className="w-[120px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">جلسه‌ی مشاوره</div>
              <div className="flex-1 px-3 py-2.5">
                <Link href="/mentoring" className="text-primary font-bold">مشاهده‌ی جلسه و صورتجلسه ←</Link>
              </div>
            </div>
          )}
        </div>

        {msg && <div className="text-[12.5px] font-semibold text-ink-soft">{msg}</div>}

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onEdit} className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-2 rounded-lg cursor-pointer">ویرایش{closedStatus ? " اطلاعات" : " / جابه‌جایی"}</button>
          {closedStatus && (
            <button onClick={onReopen} className="text-[12px] font-bold text-success bg-success-soft px-3 py-2 rounded-lg cursor-pointer">بازگشایی با زمان جدید</button>
          )}
          {a.paymentStatus !== "PAID" && (a.status === "SCHEDULED" || a.status === "CONFIRMED") && (
            <button onClick={onPay} className="text-[12px] font-bold text-accent bg-accent-soft px-3 py-2 rounded-lg cursor-pointer">ثبت پرداخت</button>
          )}
          {a.customerPhone && a.status !== "CANCELLED" && (
            <button disabled={busy} onClick={() => run(() => sendAppointmentDetails(a.id), "پیام جزئیات ارسال شد ✓")} className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50">ارسال جزئیات به مشتری</button>
          )}
          <button onClick={() => copy(`/book/${me?.tenant.slug}/a/${a.publicToken}`)} className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer">کپی لینک مشتری</button>
          {a.providerToken && (
            <button onClick={() => copy(`/book/${me?.tenant.slug}/s/${a.providerToken}`)} className="text-[12px] font-bold text-ink-soft bg-slate-100 px-3 py-2 rounded-lg cursor-pointer">کپی لینک متخصص</button>
          )}
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm("این نوبت برای همیشه حذف شود؟")) run(async () => { await deleteAppointment(a.id); onClose(); }, "حذف شد");
            }}
            className="text-[12px] font-bold text-danger bg-danger-soft px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 mr-auto"
          >
            حذف
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex border-b border-border last:border-b-0">
      <div className="w-[120px] shrink-0 bg-slate-50 text-[11.5px] font-bold text-muted px-3 py-2.5">{label}</div>
      <div className="flex-1 px-3 py-2.5 whitespace-pre-wrap" dir={ltr ? "ltr" : undefined}>{value}</div>
    </div>
  );
}
