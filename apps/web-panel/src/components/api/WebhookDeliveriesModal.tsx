import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchWebhookDeliveries, type WebhookDelivery } from "@/lib/api";
import { WEBHOOK_EVENT_LABELS } from "./webhook-labels";

export function WebhookDeliveriesModal({ webhookId, onClose }: { webhookId: string; onClose: () => void }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);

  useEffect(() => {
    fetchWebhookDeliveries(webhookId).then(setDeliveries);
  }, [webhookId]);

  return (
    <Modal title="تاریخچه ارسال" onClose={onClose} width="max-w-[520px]">
      {deliveries === null ? (
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : deliveries.length === 0 ? (
        <div className="py-8 text-center text-muted text-sm">هنوز رویدادی برای این وب‌هوک ارسال نشده است</div>
      ) : (
        <div className="flex flex-col gap-2">
          {deliveries.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
            >
              <div>
                <div className="text-[12.5px] font-bold">{WEBHOOK_EVENT_LABELS[d.event] ?? d.event}</div>
                <div className="text-[11px] text-muted mt-0.5">
                  {formatJalaliDate(d.createdAt)}
                  {d.responseStatus ? ` · HTTP ${toPersianDigits(d.responseStatus)}` : ""}
                  {d.error ? ` · ${d.error}` : ""}
                </div>
              </div>
              <Badge tone={d.status === "SUCCESS" ? "success" : "danger"}>
                {d.status === "SUCCESS" ? "موفق" : "ناموفق"}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
