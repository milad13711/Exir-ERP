"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Modal } from "@/components/ui/Modal";
import { toPersianDigits } from "@/lib/persian";
import { createCampaign, previewCampaignAudience, type AudienceFilter, type MarketingChannel } from "@/lib/api";

type SegmentKey = "frequent" | "inactive" | "new_leads" | "due" | "product" | "ambassadors" | "all";

const SEGMENTS: { key: SegmentKey; label: string; hint: string }[] = [
  { key: "frequent", label: "مشتریان همیشگی", hint: "کسانی که هرماهه یا بیشتر خرید می‌کنند" },
  { key: "inactive", label: "بیش از ۲ ماه خرید نکرده‌اند", hint: "فرصت یادآوری/تخفیف بازگشت" },
  { key: "new_leads", label: "سرنخ‌های ناآشنا", hint: "هنوز مشتری نشده‌اند" },
  { key: "due", label: "موعد خرید مجدد الان است", hint: "بر اساس میانگین فاصله‌ی خرید هر مشتری" },
  { key: "product", label: "خریداران یک محصول خاص", hint: "برای پیشنهاد محصول مرتبط/مشابه" },
  { key: "ambassadors", label: "سفیران برند", hint: "معرفان فعال کسب‌وکار" },
  { key: "all", label: "همه‌ی مخاطبین", hint: "بدون فیلتر خاص" },
];

const CHANNELS: { value: MarketingChannel; label: string; disabled?: boolean }[] = [
  { value: "SMS", label: "پیامک" },
  { value: "BALE", label: "بله", disabled: true },
  { value: "WHATSAPP", label: "واتساپ", disabled: true },
  { value: "INSTAGRAM_TEMPLATE", label: "تصویر پست/استوری اینستاگرام" },
];

function buildFilter(segment: SegmentKey, productQuery: string): AudienceFilter {
  switch (segment) {
    case "frequent":
      return { frequentBuyerMaxGapDays: 35 };
    case "inactive":
      return { minDaysSinceLastPurchase: 60 };
    case "new_leads":
      return { funnelStages: ["NEW_LEAD", "CONTACTED"] };
    case "due":
      return { dueForRepurchase: true };
    case "product":
      return { purchasedProductContains: productQuery };
    case "ambassadors":
      return { isBrandAmbassador: true };
    case "all":
    default:
      return {};
  }
}

export function CreateCampaignModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<MarketingChannel>("SMS");
  const [segment, setSegment] = useState<SegmentKey>("frequent");
  const [productQuery, setProductQuery] = useState("");
  const [messageText, setMessageText] = useState("");
  const [templateCode, setTemplateCode] = useState<"post-square" | "story">("post-square");
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateCta, setTemplateCta] = useState("");
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMessaging = channel === "SMS" || channel === "BALE" || channel === "WHATSAPP";

  useEffect(() => {
    if (!isMessaging || (segment === "product" && !productQuery.trim())) {
      return;
    }
    const filter = buildFilter(segment, productQuery.trim());
    previewCampaignAudience(filter)
      .then((res) => setAudienceCount(res.count))
      .catch(() => setAudienceCount(null));
  }, [segment, productQuery, isMessaging]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createCampaign({
        name: name.trim(),
        channel,
        messageText: isMessaging ? messageText.trim() : undefined,
        templateCode: channel === "INSTAGRAM_TEMPLATE" ? templateCode : undefined,
        templateTitle: channel === "INSTAGRAM_TEMPLATE" ? templateTitle.trim() : undefined,
        templateCta: channel === "INSTAGRAM_TEMPLATE" ? templateCta.trim() : undefined,
        audienceFilter: isMessaging ? buildFilter(segment, productQuery.trim()) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت کمپین با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
  const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

  return (
    <Modal title="کمپین جدید" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>نام کمپین</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} placeholder="مثلاً یادآوری تخفیف پاییزه" />
        </div>

        <div>
          <label className={labelClass}>کانال</label>
          <div className="grid grid-cols-2 gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={c.disabled}
                onClick={() => setChannel(c.value)}
                className={clsx(
                  "text-[12.5px] font-bold px-3 py-2.5 rounded-xl cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 transition-colors",
                  channel === c.value ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
                )}
              >
                {c.label}
                {c.disabled ? <span className="block text-[10px] font-normal mt-0.5">به‌زودی</span> : null}
              </button>
            ))}
          </div>
        </div>

        {isMessaging ? (
          <>
            <div>
              <label className={labelClass}>مخاطبین هدف</label>
              <div className="grid grid-cols-1 gap-1.5">
                {SEGMENTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSegment(s.key)}
                    className={clsx(
                      "text-right px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors",
                      segment === s.key ? "bg-primary-soft border border-primary/30" : "bg-slate-50 border border-transparent",
                    )}
                  >
                    <div className="text-[12.5px] font-bold">{s.label}</div>
                    <div className="text-[11px] text-muted mt-0.5">{s.hint}</div>
                  </button>
                ))}
              </div>
              {segment === "product" ? (
                <input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="نام محصول یا بخشی از آن"
                  className={clsx(inputClass, "mt-2")}
                />
              ) : null}
              <div className="text-[12px] font-semibold mt-2.5 text-ink-soft">
                {audienceCount === null ? "—" : `${toPersianDigits(audienceCount)} نفر واجد شرایط`}
              </div>
            </div>

            <div>
              <label className={labelClass}>متن پیام</label>
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={4}
                required
                className={inputClass}
                placeholder="متن پیامک کمپین..."
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>قالب</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateCode("post-square")}
                  className={clsx(
                    "flex-1 text-[12.5px] font-bold px-3 py-2.5 rounded-xl cursor-pointer",
                    templateCode === "post-square" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
                  )}
                >
                  پست مربعی
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateCode("story")}
                  className={clsx(
                    "flex-1 text-[12.5px] font-bold px-3 py-2.5 rounded-xl cursor-pointer",
                    templateCode === "story" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft",
                  )}
                >
                  استوری
                </button>
              </div>
            </div>
            <div>
              <label className={labelClass}>عنوان روی تصویر</label>
              <input value={templateTitle} onChange={(e) => setTemplateTitle(e.target.value)} className={inputClass} placeholder="مثلاً ۲۰٪ تخفیف ویژه" />
            </div>
            <div>
              <label className={labelClass}>توضیح (اختیاری)</label>
              <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={2} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>متن دکمه/فراخوان</label>
              <input value={templateCta} onChange={(e) => setTemplateCta(e.target.value)} className={inputClass} placeholder="مثلاً همین حالا سفارش بده" />
            </div>
          </>
        )}

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {submitting ? "در حال ثبت..." : "ثبت کمپین"}
        </button>
      </form>
    </Modal>
  );
}
