"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { fetchCounters, fetchInbox, fetchOverdueReport, type Counters, type LetterListItem } from "@/lib/correspondence-api";
import { Empty, ErrorBox, LetterRow, Loading, errText, fa } from "./corr-ui";
import Link from "next/link";

type TabKey = "signature" | "review" | "referrals" | "overdue" | "drafts" | "report";
const TABS: { key: TabKey; label: string; counter?: keyof Counters }[] = [
  { key: "signature", label: "منتظر امضای من", counter: "pendingSignature" },
  { key: "review", label: "منتظر بازبینی من", counter: "pendingReview" },
  { key: "referrals", label: "ارجاع به من", counter: "referralsToMe" },
  { key: "overdue", label: "ارجاع‌های معوق", counter: "overdueReferrals" },
  { key: "drafts", label: "پیش‌نویس‌های من", counter: "drafts" },
  { key: "report", label: "گزارش تأخیر" },
];

export function InboxView() {
  const [tab, setTab] = useState<TabKey>("referrals");
  const [counters, setCounters] = useState<Counters | null>(null);
  const [items, setItems] = useState<LetterListItem[] | null>(null);
  const [report, setReport] = useState<Awaited<ReturnType<typeof fetchOverdueReport>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCounters().then(setCounters).catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(null);
    setError(null);
    if (tab === "report") fetchOverdueReport().then((r) => alive && setReport(r)).catch((e) => alive && setError(errText(e)));
    else fetchInbox(tab).then((r) => alive && setItems(r.items)).catch((e) => alive && setError(errText(e)));
    return () => {
      alive = false;
    };
  }, [tab]);

  return (
    <div className="flex flex-col gap-3">
      {counters ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { l: "وارده‌ی بدون پاسخ", v: counters.awaitingIncoming, tone: "text-primary" },
            { l: "مهلت پاسخ گذشته", v: counters.overdueResponses, tone: "text-danger" },
            { l: "ارجاع معوق من", v: counters.overdueReferrals, tone: "text-danger" },
            { l: "پیش‌نویس‌های من", v: counters.drafts, tone: "text-ink" },
          ].map((c) => (
            <Card key={c.l} className="p-3.5">
              <div className={clsx("text-xl font-extrabold", c.tone)}>{fa(c.v)}</div>
              <div className="text-[11.5px] text-muted mt-0.5">{c.l}</div>
            </Card>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const n = t.counter && counters ? counters[t.counter] : 0;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={clsx("shrink-0 text-[12.5px] font-semibold px-3.5 py-2 min-h-[40px] rounded-[10px] border cursor-pointer", tab === t.key ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft")}>
              {t.label}{n > 0 ? ` (${fa(n)})` : ""}
            </button>
          );
        })}
      </div>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {tab === "report" ? (
        report === null && !error ? <Loading /> : report ? (
          <div className="flex flex-col gap-3">
            <Card className="overflow-hidden">
              <div className="px-4 py-3 text-[13px] font-extrabold border-b border-border">وارده‌های بدون پاسخ پس از مهلت</div>
              {report.letters.length === 0 ? <Empty>موردی نیست</Empty> : report.letters.map((l) => <LetterRow key={l.id} l={l} />)}
            </Card>
            <Card className="overflow-hidden">
              <div className="px-4 py-3 text-[13px] font-extrabold border-b border-border">ارجاع‌های معوق</div>
              {report.referrals.length === 0 ? <Empty>موردی نیست</Empty> : report.referrals.map((r) => (
                <Link key={r.id} href={`/correspondence/${r.letter.id}`} className="block px-4 py-3 border-b border-border last:border-0 hover:bg-primary-soft/40">
                  <div className="text-[13px] font-bold break-words">{r.letter.subject}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">به: {r.toName ?? "—"} · {r.instruction || "بدون دستور"}</div>
                </Link>
              ))}
            </Card>
          </div>
        ) : null
      ) : (
        <Card className="overflow-hidden">
          {items === null && !error ? <Loading /> : items && items.length === 0 ? <Empty>مورد باز و منتظری در این بخش نیست</Empty> : items?.map((l) => <LetterRow key={`${l.id}-${l.referral?.id ?? ""}`} l={l} />)}
        </Card>
      )}
    </div>
  );
}
