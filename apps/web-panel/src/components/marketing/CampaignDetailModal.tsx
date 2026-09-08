"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { toPersianDigits, formatToman, formatJalaliDateTime } from "@/lib/persian";
import { ApiError, fetchCampaignImageObjectUrl, sendCampaign, type MarketingCampaign } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = { DRAFT: "پیش‌نویس", SENDING: "در حال ارسال", SENT: "ارسال‌شده", FAILED: "ناموفق" };
const STATUS_TONES: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  SENDING: "warning",
  SENT: "success",
  FAILED: "danger",
};

export function CampaignDetailModal({
  campaign,
  onClose,
  onUpdated,
}: {
  campaign: MarketingCampaign;
  onClose: () => void;
  onUpdated: (c: MarketingCampaign) => void;
}) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    if (campaign.channel !== "INSTAGRAM_TEMPLATE") return;
    let revoke: string | null = null;
    fetchCampaignImageObjectUrl(campaign.id)
      .then((url) => {
        revoke = url;
        setImageUrl(url);
      })
      .catch(() => setImageError("ساخت تصویر ناموفق بود"));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [campaign.id, campaign.channel]);

  async function handleSend() {
    setSending(true);
    setSendError(null);
    try {
      const updated = await sendCampaign(campaign.id);
      onUpdated(updated);
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "ارسال کمپین با خطا مواجه شد");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={campaign.name} onClose={onClose} width="max-w-[520px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONES[campaign.status]}>{STATUS_LABELS[campaign.status]}</Badge>
          {campaign.sentAt ? <span className="text-[11.5px] text-muted">{formatJalaliDateTime(new Date(campaign.sentAt))}</span> : null}
        </div>

        {campaign.channel === "INSTAGRAM_TEMPLATE" ? (
          <div className="flex flex-col items-center gap-3">
            {imageError ? (
              <div className="text-[12.5px] text-danger">{imageError}</div>
            ) : imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={campaign.name} className="w-full rounded-xl border border-border" />
            ) : (
              <div className="text-[12.5px] text-muted py-10">در حال ساخت تصویر...</div>
            )}
            {imageUrl ? (
              <a href={imageUrl} download={`${campaign.name}.png`} className="text-[12.5px] font-bold text-primary">
                دانلود تصویر برای انتشار در اینستاگرام ←
              </a>
            ) : null}
          </div>
        ) : (
          <>
            {campaign.messageText ? <p className="text-[13px] text-ink-soft leading-relaxed bg-slate-50 rounded-xl p-3.5">{campaign.messageText}</p> : null}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <div className="text-lg font-extrabold">{toPersianDigits(campaign.recipientCount)}</div>
                <div className="text-[11px] text-muted mt-0.5">مخاطب</div>
              </div>
              <div className="bg-success-soft rounded-xl p-3 text-center">
                <div className="text-lg font-extrabold text-success">{toPersianDigits(campaign.sentCount)}</div>
                <div className="text-[11px] text-success/80 mt-0.5">ارسال‌شده</div>
              </div>
              <div className="bg-danger-soft rounded-xl p-3 text-center">
                <div className="text-lg font-extrabold text-danger">{toPersianDigits(campaign.failedCount)}</div>
                <div className="text-[11px] text-danger/80 mt-0.5">ناموفق</div>
              </div>
            </div>

            {campaign.status === "SENT" ? (
              <div className="bg-primary-soft rounded-xl p-3.5">
                <div className="text-[12.5px] font-bold text-primary mb-1">عملکرد کمپین (۷ روز پس از ارسال)</div>
                <div className="text-[12px] text-ink-soft">
                  {toPersianDigits(campaign.attributedOrderCount)} سفارش — {formatToman(campaign.attributedRevenue)}
                </div>
              </div>
            ) : null}

            {campaign.status === "DRAFT" ? (
              <>
                {sendError ? <div className="text-[12px] text-danger">{sendError}</div> : null}
                <button
                  onClick={handleSend}
                  disabled={sending || campaign.recipientCount === 0}
                  className="w-full py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
                >
                  {sending ? "در حال ارسال..." : "ارسال کمپین"}
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
