"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Badge } from "@/components/ui/Badge";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { REFERRAL_STATUS_TONE } from "@/components/referrals/ReferralPanel";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { ApiError, fetchReferralCounts, fetchReferralInbox, respondReferral, type DocumentReferral, type ReferralCounts } from "@/lib/api";

const TABS = [
  { key: "active", label: "در انتظار / در جریان" },
  { key: "done", label: "پایان‌یافته" },
  { key: "sent", label: "ارجاع‌های من به دیگران" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function ReferralsPage() {
  const [tab, setTab] = useState<TabKey>("active");
  const [items, setItems] = useState<DocumentReferral[] | null>(null);
  const [counts, setCounts] = useState<ReferralCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchReferralInbox(tab)
      .then(setItems)
      .catch(() => setItems([]));
    fetchReferralCounts().then(setCounts).catch(() => undefined);
  }, [tab]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(null);
    load();
  }, [load]);

  async function act(id: string, action: "accept" | "complete") {
    setBusyId(id);
    setError(null);
    try {
      await respondReferral(id, action);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "عملیات ناموفق بود");
    } finally {
      setBusyId(null);
    }
  }

  const count = (key: TabKey) => (key === "active" && counts ? counts.active : key === "sent" && counts ? counts.sentActive : null);

  return (
    <div className="p-5 lg:p-7 max-w-[860px] mx-auto">
      <div className="flex items-center gap-1.5 mb-1">
        <h1 className="text-xl font-extrabold">ارجاع‌های من</h1>
        <ModuleHelp code="referrals" />
      </div>
      <p className="text-[13.5px] text-muted mb-4">اسنادی (فاکتور، پیش‌فاکتور، سفارش خرید، گزارش و ...) که برای پیگیری به شما ارجاع شده‌اند؛ از همه‌ی بخش‌ها یک‌جا</p>

      {counts ? (
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <Stat label="در انتظار پذیرش" value={counts.pending} tone="text-warning" />
          <Stat label="در جریان" value={counts.accepted} tone="text-primary" />
          <Stat label="دیرکرد" value={counts.overdue} tone="text-danger" />
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={clsx("text-[12.5px] font-bold px-3.5 py-1.5 rounded-lg cursor-pointer", tab === t.key ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}>
            {t.label}
            {count(t.key) ? ` (${toPersianDigits(count(t.key)!)})` : ""}
          </button>
        ))}
      </div>

      {error ? <div className="text-[12px] text-danger font-semibold mb-2">{error}</div> : null}

      {items === null ? (
        <div className="text-[13px] text-muted py-8 text-center">در حال بارگذاری...</div>
      ) : items.length === 0 ? (
        <div className="text-[13px] text-muted py-10 text-center bg-slate-50 border border-border rounded-xl">موردی وجود ندارد</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((r) => (
            <div key={r.id} className="bg-white border border-border rounded-xl p-3.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13.5px] font-bold">{r.entityLabel ?? r.noun}</span>
                <Badge tone={r.overdue ? "danger" : REFERRAL_STATUS_TONE[r.status]}>{r.overdue ? "دیرکرد" : r.statusLabel}</Badge>
              </div>
              <div className="text-[12px] text-muted">
                {tab === "sent" ? `به: ${r.toName ?? "—"}` : `از: ${r.fromName ?? "سیستم"}`} · {formatJalaliDateTime(r.createdAt)}
                {r.dueAt ? ` · موعد: ${formatJalaliDateTime(r.dueAt)}` : ""}
              </div>
              {r.note ? <div className="text-[12.5px] text-ink-soft">یادداشت: {r.note}</div> : null}
              {r.resolvedNote ? <div className="text-[12px] text-muted">نتیجه: {r.resolvedNote}</div> : null}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {r.link ? (
                  <Link href={r.link} className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg">
                    مشاهده‌ی سند
                  </Link>
                ) : null}
                {tab !== "sent" && r.status === "PENDING" ? (
                  <button disabled={busyId === r.id} onClick={() => act(r.id, "accept")} className="text-[11.5px] font-bold bg-primary text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
                    پذیرش
                  </button>
                ) : null}
                {tab !== "sent" && (r.status === "PENDING" || r.status === "ACCEPTED") ? (
                  <button disabled={busyId === r.id} onClick={() => act(r.id, "complete")} className="text-[11.5px] font-bold bg-success text-white px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50">
                    انجام شد
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-white border border-border rounded-xl px-3 py-2.5 text-center">
      <div className={clsx("text-xl font-extrabold", tone)}>{toPersianDigits(value)}</div>
      <div className="text-[11.5px] text-muted">{label}</div>
    </div>
  );
}
