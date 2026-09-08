"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { toPersianDigits } from "@/lib/persian";
import { updateCampaign, previewCampaignAudience, type AudienceFilter, type MarketingCampaign } from "@/lib/api";
import { AudienceFilterBuilder } from "./AudienceFilterBuilder";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export function EditCampaignModal({
  campaign,
  onClose,
  onUpdated,
}: {
  campaign: MarketingCampaign;
  onClose: () => void;
  onUpdated: (c: MarketingCampaign) => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [filter, setFilter] = useState<AudienceFilter>(campaign.audienceFilter ?? {});
  const [messageText, setMessageText] = useState(campaign.messageText ?? "");
  const [templateTitle, setTemplateTitle] = useState(campaign.templateTitle ?? "");
  const [templateCta, setTemplateCta] = useState(campaign.templateCta ?? "");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMessaging = campaign.channel !== "INSTAGRAM_TEMPLATE";

  useEffect(() => {
    if (!isMessaging) return;
    previewCampaignAudience(filter)
      .then((res) => setAudienceCount(res.count))
      .catch(() => setAudienceCount(null));
  }, [filter, isMessaging]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateCampaign(campaign.id, {
        name: name.trim(),
        messageText: isMessaging ? messageText.trim() : undefined,
        templateTitle: !isMessaging ? templateTitle.trim() : undefined,
        templateCta: !isMessaging ? templateCta.trim() : undefined,
        audienceFilter: isMessaging ? filter : undefined,
      });
      onUpdated(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ویرایش کمپین با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="ویرایش کمپین" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>نام کمپین</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
        </div>

        {isMessaging ? (
          <>
            <div>
              <label className={labelClass}>مخاطبین هدف</label>
              <AudienceFilterBuilder value={filter} onChange={setFilter} />
              <div className="text-[12px] font-semibold mt-2.5 text-ink-soft">
                {audienceCount === null ? "—" : `${toPersianDigits(audienceCount)} نفر واجد شرایط`}
              </div>
            </div>
            <div>
              <label className={labelClass}>متن پیام</label>
              <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={4} required className={inputClass} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>عنوان روی تصویر</label>
              <input value={templateTitle} onChange={(e) => setTemplateTitle(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>توضیح (اختیاری)</label>
              <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={2} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>متن دکمه/فراخوان</label>
              <input value={templateCta} onChange={(e) => setTemplateCta(e.target.value)} className={inputClass} />
            </div>
          </>
        )}

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button type="submit" disabled={submitting} className="w-full py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50">
          {submitting ? "در حال ذخیره..." : "ذخیره‌ی تغییرات"}
        </button>
      </form>
    </Modal>
  );
}
