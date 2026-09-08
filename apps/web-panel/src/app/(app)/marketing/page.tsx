"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon, MegaphoneIcon } from "@/components/icons";
import { toPersianDigits, formatToman, formatJalaliDateTime } from "@/lib/persian";
import { fetchCampaigns, type MarketingCampaign } from "@/lib/api";
import { CreateCampaignModal } from "@/components/marketing/CreateCampaignModal";
import { CampaignDetailModal } from "@/components/marketing/CampaignDetailModal";

const STATUS_LABELS: Record<string, string> = { DRAFT: "پیش‌نویس", SENDING: "در حال ارسال", SENT: "ارسال‌شده", FAILED: "ناموفق" };
const STATUS_TONES: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral",
  SENDING: "warning",
  SENT: "success",
  FAILED: "danger",
};
const CHANNEL_LABELS: Record<string, string> = {
  SMS: "پیامک",
  BALE: "بله",
  WHATSAPP: "واتساپ",
  INSTAGRAM_TEMPLATE: "تصویر اینستاگرام",
};

export default function MarketingPage() {
  const [campaigns, setCampaigns] = useState<MarketingCampaign[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<MarketingCampaign | null>(null);

  function reload() {
    fetchCampaigns()
      .then(setCampaigns)
      .catch(() => setCampaigns([]));
  }

  useEffect(reload, []);

  return (
    <div className="p-5 lg:p-7 max-w-[900px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">بازاریابی و کمپین</h1>
          <p className="text-[13.5px] text-muted mt-1">ثبت، اجرا و مقایسه‌ی کمپین‌های پیامکی و محتوای اینستاگرام</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
        >
          <PlusIcon className="w-4 h-4" />
          کمپین جدید
        </button>
      </div>

      {campaigns === null ? (
        <div className="text-center text-muted text-sm py-16">در حال بارگذاری...</div>
      ) : campaigns.length === 0 ? (
        <div className="text-center text-muted text-sm py-16 flex flex-col items-center gap-3">
          <MegaphoneIcon className="w-8 h-8 text-border" />
          هنوز کمپینی ثبت نشده است
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 mt-6">
          {campaigns.map((c) => (
            <button key={c.id} onClick={() => setActive(c)} className="text-right w-full cursor-pointer">
              <Card className="p-4 flex items-center justify-between gap-3 hover:border-primary/30 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold truncate">{c.name}</span>
                    <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1 flex items-center gap-3">
                    <span>{CHANNEL_LABELS[c.channel]}</span>
                    {c.channel !== "INSTAGRAM_TEMPLATE" ? <span>{toPersianDigits(c.recipientCount)} مخاطب</span> : null}
                    {c.sentAt ? <span>{formatJalaliDateTime(new Date(c.sentAt))}</span> : null}
                  </div>
                </div>
                {c.status === "SENT" && c.channel !== "INSTAGRAM_TEMPLATE" ? (
                  <div className="text-left shrink-0">
                    <div className="text-[13px] font-extrabold text-success">{formatToman(c.attributedRevenue)}</div>
                    <div className="text-[10.5px] text-muted">{toPersianDigits(c.attributedOrderCount)} سفارش نسبت‌داده‌شده</div>
                  </div>
                ) : null}
              </Card>
            </button>
          ))}
        </div>
      )}

      {creating ? (
        <CreateCampaignModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      ) : null}

      {active ? (
        <CampaignDetailModal
          campaign={active}
          onClose={() => {
            setActive(null);
            reload();
          }}
          onUpdated={(updated) => setActive(updated)}
        />
      ) : null}
    </div>
  );
}
