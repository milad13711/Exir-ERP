"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { formatJalaliDate, formatJalaliDateTime } from "@/lib/persian";
import {
  ApiError,
  downloadUserActivityCsv,
  fetchUserActivity,
  fetchUserActivitySummary,
  type ActivityFilters,
  type ActivityTimelineItem,
  type UserActivitySummary,
} from "@/lib/api";

const ACTION_OPTIONS: Array<[string, string]> = [
  ["", "همه‌ی اقدام‌ها"], ["create", "ایجاد"], ["update", "ویرایش"], ["delete", "حذف"], ["login", "ورود"], ["approve", "تأیید"],
  ["reject", "رد"], ["cancel", "لغو"], ["send", "ارسال"], ["status", "تغییر وضعیت"], ["sign", "امضا"], ["other", "سایر"],
];
const GLYPH: Record<string, string> = { create: "+", update: "✎", delete: "×", login: "→", approve: "✓", reject: "✕", cancel: "⊘", send: "↗", status: "⇄", sign: "✍", other: "•" };
const TONE: Record<string, string> = {
  create: "bg-emerald-50 text-emerald-700", update: "bg-sky-50 text-sky-700", delete: "bg-red-50 text-red-700", login: "bg-slate-100 text-slate-700",
  approve: "bg-emerald-50 text-emerald-700", reject: "bg-red-50 text-red-700", cancel: "bg-amber-50 text-amber-700", send: "bg-indigo-50 text-indigo-700",
  status: "bg-violet-50 text-violet-700", sign: "bg-teal-50 text-teal-700", other: "bg-slate-100 text-slate-600",
};
const FIELD = "w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3 py-2.5 focus:border-primary";

/** برچسب روز جلالی برای گروه‌بندی (به وقت تهران، چون formatJalaliDate از منطقه‌ی مرورگر می‌خواند). */
const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 12_600_000).toISOString().slice(0, 10);

function MiniChart({ daily }: { daily: UserActivitySummary["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  return (
    <div className="flex items-end gap-[3px] h-14" role="img" aria-label="نمودار فعالیت روزانه‌ی ۳۰ روز اخیر">
      {daily.map((d) => (
        <div key={d.date} className="flex-1 min-w-[3px] bg-slate-100 rounded-sm flex items-end h-full" title={`${formatJalaliDate(new Date(`${d.date}T12:00:00`))}: ${d.count.toLocaleString("fa-IR")}`}>
          <div className="w-full bg-primary rounded-sm" style={{ height: `${d.count === 0 ? 0 : Math.max(8, (d.count / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

export function UserActivityArchive({ userId }: { userId: string }) {
  const [summary, setSummary] = useState<UserActivitySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [items, setItems] = useState<ActivityTimelineItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [moduleCode, setModuleCode] = useState("");
  const [actionType, setActionType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 350).trim();
  const filters = useMemo<ActivityFilters>(() => ({ module: moduleCode || undefined, actionType: actionType || undefined, from: from || undefined, to: to || undefined, q: q || undefined }), [moduleCode, actionType, from, to, q]);
  const reqId = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetchUserActivitySummary(userId)
      .then((s) => alive && setSummary(s))
      .catch((e) => alive && setSummaryError(e instanceof ApiError ? e.message : "بارگذاری خلاصه ناموفق بود"));
    return () => {
      alive = false;
    };
  }, [userId]);

  const load = useCallback(
    async (after: string | null) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const r = await fetchUserActivity(userId, filters, after ?? undefined);
        if (id !== reqId.current) return;
        setItems((prev) => (after ? [...prev, ...r.items.filter((n) => !prev.some((p) => p.id === n.id))] : r.items));
        setCursor(r.nextCursor);
      } catch (e) {
        if (id === reqId.current) setError(e instanceof ApiError ? e.message : "بارگذاری سوابق ناموفق بود");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [userId, filters],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems([]);
    setCursor(null);
    void load(null);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || loading || error) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void load(cursor), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, error, load]);

  const groups = useMemo(() => {
    const out: Array<{ day: string; rows: ActivityTimelineItem[] }> = [];
    for (const it of items) {
      const k = dayKey(it.at);
      const last = out[out.length - 1];
      if (last && last.day === k) last.rows.push(it);
      else out.push({ day: k, rows: [it] });
    }
    return out;
  }, [items]);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadUserActivityCsv(userId, filters);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "دریافت خروجی ناموفق بود");
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = !!(moduleCode || actionType || from || to || search);
  const off = summary?.subject.offboarding;

  return (
    <div className="flex flex-col gap-4">
      {summary && (summary.subject.deleted || summary.subject.inactive) ? (
        <div role="status" className="bg-warning-soft border border-border rounded-xl px-4 py-3 text-[12.5px] leading-relaxed">
          <b>{summary.subject.deleted ? "این کاربر حذف شده است" : "این کاربر غیرفعال است"}</b> — سوابق فقط‌خواندنی و محفوظ می‌ماند.
          {off ? ` (${off.mode === "delete" ? "حذف" : off.mode === "deactivate" ? "غیرفعال‌سازی" : "انتقال رکوردها"} در ${formatJalaliDate(off.at)}${off.performedByName ? ` توسط ${off.performedByName}` : ""}${off.toUserName ? `؛ رکوردها به ${off.toUserName} منتقل شد` : ""})` : ""}
        </div>
      ) : null}

      <Card className="p-4">
        {summaryError ? (
          <div className="text-[13px] text-danger">{summaryError}</div>
        ) : !summary ? (
          <div className="text-[13px] text-muted">در حال بارگذاری خلاصه...</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12.5px]">
              <div><div className="text-muted text-[11.5px]">آخرین ورود</div><div className="font-bold mt-0.5">{summary.lastLoginAt ? formatJalaliDateTime(summary.lastLoginAt) : "—"}</div></div>
              <div><div className="text-muted text-[11.5px]">آخرین فعالیت</div><div className="font-bold mt-0.5">{summary.lastActiveAt ? formatJalaliDateTime(summary.lastActiveAt) : "—"}</div></div>
              <div><div className="text-muted text-[11.5px]">فعالیت ۳۰ روز اخیر</div><div className="font-bold mt-0.5">{summary.count30d.toLocaleString("fa-IR")}</div></div>
            </div>
            <MiniChart daily={summary.daily} />
            {summary.devices.length ? (
              <details className="text-[12px]">
                <summary className="cursor-pointer text-muted">ورودهای اخیر (دستگاه و IP)</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {summary.devices.map((d, i) => (
                    <li key={i} className="flex gap-2 flex-wrap"><span className="text-muted">{formatJalaliDateTime(d.at)}</span><span>{d.device ?? "دستگاه نامشخص"}</span><span dir="ltr" className="text-muted">{d.ip ?? ""}</span></li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-2">
        <SearchInput value={search} onChange={setSearch} loading={loading} placeholder="جستجو در شرح فعالیت" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <select value={moduleCode} onChange={(e) => setModuleCode(e.target.value)} className={FIELD} aria-label="ماژول">
            <option value="">همه‌ی ماژول‌ها</option>
            {(summary?.modules ?? []).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            {["tasks", "correspondence", "dispatch", "signature"].filter((c) => !(summary?.modules ?? []).some((m) => m.code === c)).map((c) => (
              <option key={c} value={c}>{{ tasks: "وظایف", correspondence: "مکاتبات", dispatch: "اعلام بار", signature: "امضای دیجیتال" }[c]}</option>
            ))}
          </select>
          <select value={actionType} onChange={(e) => setActionType(e.target.value)} className={FIELD} aria-label="نوع اقدام">
            {ACTION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <JalaliDateInput value={from} onChange={setFrom} placeholder="از تاریخ" />
          <JalaliDateInput value={to} onChange={setTo} placeholder="تا تاریخ" />
        </div>
        <div className="flex items-center gap-3">
          {hasFilters ? <button type="button" onClick={() => { setModuleCode(""); setActionType(""); setFrom(""); setTo(""); setSearch(""); }} className="text-[12px] font-bold text-primary cursor-pointer">حذف فیلترها</button> : null}
          {summary?.viewer.canExport ? (
            <button type="button" disabled={exporting} onClick={handleExport} className="mr-auto text-[12px] font-bold text-ink-soft bg-slate-100 px-3 min-h-9 rounded-lg cursor-pointer disabled:opacity-60">
              {exporting ? "در حال آماده‌سازی..." : "خروجی CSV"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="text-center text-[13px] text-danger py-4">
          {error} <button type="button" onClick={() => void load(cursor)} className="font-bold text-primary cursor-pointer">تلاش دوباره</button>
        </div>
      ) : null}
      {!error && !loading && items.length === 0 ? <div className="text-center text-muted text-[13px] py-8">فعالیتی با این شرایط ثبت نشده است</div> : null}

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.day} aria-label={formatJalaliDate(new Date(`${g.day}T12:00:00`))}>
            <h3 className="text-[12px] font-extrabold text-ink-soft mb-1.5">{formatJalaliDate(new Date(`${g.day}T12:00:00`))}</h3>
            <ul className="flex flex-col">
              {g.rows.map((it) => {
                const body = (
                  <>
                    <span className={clsx("w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0", TONE[it.actionType] ?? TONE.other)} aria-hidden>{GLYPH[it.actionType] ?? "•"}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold break-words">{it.title}</span>
                      <span className="block text-[11.5px] text-muted mt-0.5">
                        {it.moduleLabel} · {new Date(it.at).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" })}
                        {it.actorType !== "MANUAL" ? " · خودکار" : ""}
                        {it.ip ? <span dir="ltr"> · {it.ip}</span> : null}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={it.id} className="border-b border-border last:border-0">
                    {it.link ? <Link href={it.link} className="flex items-center gap-3 py-2.5 hover:bg-slate-50 rounded-lg">{body}</Link> : <div className="flex items-center gap-3 py-2.5">{body}</div>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div ref={sentinel} className="py-3 text-center text-[12px] text-muted">
        {loading ? "در حال بارگذاری..." : cursor ? <button type="button" onClick={() => void load(cursor)} className="font-bold text-primary cursor-pointer">نمایش بیشتر</button> : items.length > 0 ? "پایان سوابق" : null}
      </div>
    </div>
  );
}
