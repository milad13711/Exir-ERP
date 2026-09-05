import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { AttachmentsSection } from "@/components/shared/AttachmentsSection";
import { toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import {
  fetchMatchCandidates,
  sendShipmentOffers,
  cancelShipment,
  deliverShipment,
  type Shipment,
  type ShipmentStatus,
  type ShipmentOfferStatus,
  type MatchCandidate,
} from "@/lib/api";

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: "ثبت‌شده",
  OFFERED: "در حال پیشنهاد به راننده‌ها",
  ACCEPTED: "پذیرفته‌شده",
  DELIVERED: "تحویل‌شده",
  CANCELLED: "لغوشده",
};
const STATUS_TONES: Record<ShipmentStatus, "primary" | "success" | "warning" | "neutral" | "danger"> = {
  DRAFT: "neutral",
  OFFERED: "warning",
  ACCEPTED: "primary",
  DELIVERED: "success",
  CANCELLED: "danger",
};
const OFFER_STATUS_LABELS: Record<ShipmentOfferStatus, string> = {
  SCHEDULED: "در نوبت ارسال",
  PENDING: "ارسال‌شده — منتظر پاسخ",
  ACCEPTED: "پذیرفته شد",
  EXPIRED: "منقضی‌شده",
};

export function ShipmentDetailModal({
  shipment,
  onClose,
  onChanged,
}: {
  shipment: Shipment;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);
  const [matchOpen, setMatchOpen] = useState(false);

  useEffect(() => {
    if (!matchOpen) return;
    fetchMatchCandidates(shipment.id)
      .then((list) => {
        setCandidates(list);
        setSelectedDriverIds(list.filter((c) => c.score > -100).map((c) => c.driver.id));
      })
      .catch(() => setCandidates([]));
  }, [matchOpen, shipment.id]);

  async function handleSendOffers(auto: boolean) {
    setBusy(true);
    setError(null);
    try {
      await sendShipmentOffers(shipment.id, auto ? undefined : selectedDriverIds);
      setMatchOpen(false);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ارسال پیشنهاد ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "عملیات ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  function toggleCandidate(id: string) {
    setSelectedDriverIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <Modal title={`بار شماره ${toPersianDigits(shipment.shipmentNo)}`} onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold">{shipment.cargoType}</div>
            <div className="text-[12.5px] text-muted mt-1">
              {toPersianDigits(shipment.quantity)}
              {shipment.unit ? ` ${shipment.unit}` : ""}
              {shipment.contact ? ` · ${shipment.contact.name}` : ""}
            </div>
          </div>
          <Badge tone={STATUS_TONES[shipment.status]}>{STATUS_LABELS[shipment.status]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">آدرس تحویل</div>
            <div className="text-[12.5px] font-bold">{shipment.deliveryAddress}</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">زمان بارگیری</div>
            <div className="text-[12.5px] font-bold">{formatJalaliDateTime(shipment.pickupAt)}</div>
          </div>
        </div>

        {shipment.driver && (
          <div className="bg-success-soft rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">راننده</div>
            <div className="text-[13px] font-bold">{shipment.driver.name}</div>
            <div className="text-[12px] text-ink-soft mt-0.5" dir="ltr">
              {shipment.driver.phone}
              {shipment.driver.plateNumber ? ` · ${shipment.driver.plateNumber}` : ""}
            </div>
          </div>
        )}

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        {shipment.status === "DRAFT" && !matchOpen && (
          <button
            onClick={() => setMatchOpen(true)}
            className="py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer"
          >
            تطبیق و ارسال پیشنهاد به راننده‌ها
          </button>
        )}

        {matchOpen && (
          <div className="bg-slate-50 border border-border rounded-xl p-3.5">
            <div className="text-[12px] font-semibold text-ink-soft mb-2">
              راننده‌های پیشنهادی (به‌ترتیب اولویت) — می‌توانید تیک هرکدام را بردارید
            </div>
            {candidates === null ? (
              <div className="text-center text-muted text-sm py-4">در حال محاسبه...</div>
            ) : candidates.length === 0 ? (
              <div className="text-center text-muted text-sm py-4">راننده‌ی فعالی وجود ندارد</div>
            ) : (
              <div className="flex flex-col gap-1.5 mb-3">
                {candidates.map((c) => (
                  <label
                    key={c.driver.id}
                    className="flex items-center gap-2.5 bg-white border border-border rounded-lg px-3 py-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDriverIds.includes(c.driver.id)}
                      onChange={() => toggleCandidate(c.driver.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-bold">{c.driver.name}</div>
                      <div className="text-[10.5px] text-muted">{c.reasons.join(" · ")}</div>
                    </div>
                    <div className="text-[11px] font-bold text-muted">{toPersianDigits(c.score)}</div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSendOffers(false)}
                disabled={busy || selectedDriverIds.length === 0}
                className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-bold cursor-pointer disabled:opacity-50"
              >
                ارسال با همین انتخاب
              </button>
              <button
                onClick={() => handleSendOffers(true)}
                disabled={busy}
                className="flex-1 py-2 rounded-lg border border-border text-ink-soft text-[12px] font-bold cursor-pointer disabled:opacity-50"
              >
                ارسال خودکار (همه)
              </button>
              <button onClick={() => setMatchOpen(false)} className="text-[11.5px] font-bold text-ink-soft">
                انصراف
              </button>
            </div>
          </div>
        )}

        {shipment.offers.length > 0 && (
          <div>
            <div className="text-[12px] font-semibold text-ink-soft mb-1.5">وضعیت پیشنهادها</div>
            <div className="flex flex-col gap-1.5">
              {shipment.offers.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2">
                  <span className="text-[12px] font-semibold">
                    {toPersianDigits(o.rank)}. {o.driver.name}
                  </span>
                  <span className="text-[11px] text-muted">{OFFER_STATUS_LABELS[o.status]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {shipment.survey && (
          <div className="bg-slate-50 rounded-xl p-3">
            <div className="text-[11px] text-muted mb-1">نظرسنجی مشتری</div>
            {shipment.survey.submittedAt ? (
              <div className="text-[12.5px]">
                امتیاز راننده: {shipment.survey.driverRating ?? "—"} · امتیاز محصول: {shipment.survey.productRating ?? "—"}
                {shipment.survey.note && <div className="text-[11.5px] text-ink-soft mt-1">{shipment.survey.note}</div>}
              </div>
            ) : (
              <div className="text-[12px] text-muted">{shipment.survey.sentAt ? "پیامک ارسال شد — منتظر پاسخ مشتری" : "لینک نظرسنجی هنوز ارسال نشده"}</div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          {shipment.status === "ACCEPTED" && (
            <button
              onClick={() => runAction(() => deliverShipment(shipment.id))}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl bg-success text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              ثبت تحویل بار
            </button>
          )}
          {(shipment.status === "DRAFT" || shipment.status === "OFFERED" || shipment.status === "ACCEPTED") && (
            <button
              onClick={() => runAction(() => cancelShipment(shipment.id))}
              disabled={busy}
              className="flex-1 py-2.5 rounded-xl border border-danger/30 text-danger text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
            >
              لغو بار
            </button>
          )}
        </div>

        <AttachmentsSection entityType="Shipment" entityId={shipment.id} />
      </div>
    </Modal>
  );
}
