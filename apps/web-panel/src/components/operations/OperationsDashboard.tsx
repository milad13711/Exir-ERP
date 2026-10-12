"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import { useWorkspace } from "@/lib/workspace-context";
import { formatJalaliDateTime, toJalali, toPersianDigits } from "@/lib/persian";
import { approveTask, decideTaskExtension, resolveTaskProblem, returnTask } from "@/lib/api";
import {
  downloadOpsCsv,
  fetchOpsActivity,
  fetchOpsAttention,
  fetchOpsOverview,
  fetchOpsTrend,
  fetchOpsWorkload,
  type OpsActivityItem,
  type OpsAttention,
  type OpsAttentionItem,
  type OpsAttentionKind,
  type OpsChip,
  type OpsOverview,
  type OpsTrend,
  type OpsWorkload,
  type OpsWorkloadSort,
} from "@/lib/operations-api";

const REFRESH_MS = 60_000;
const BTN = "text-[12px] font-bold px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50";

const isoDay = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const num = (n: number) => toPersianDigits(n);
const pct = (v: number | null) => (v === null ? "—" : `${toPersianDigits(Math.round(v * 100))}٪`);
const hoursText = (h: number | null) => {
  if (h === null) return "—";
  if (h < 1) return `${toPersianDigits(Math.round(h * 60))} دقیقه`;
  if (h < 48) return `${toPersianDigits(Math.round(h * 10) / 10)} ساعت`;
  return `${toPersianDigits(Math.round(h / 24))} روز`;
};
const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "همین الان";
  if (m < 60) return `${toPersianDigits(m)} دقیقه پیش`;
  if (m < 1440) return `${toPersianDigits(Math.round(m / 60))} ساعت پیش`;
  return `${toPersianDigits(Math.round(m / 1440))} روز پیش`;
};
const errText = (e: unknown) => (e instanceof Error ? e.message : "خطایی رخ داد");

const KINDS: Record<OpsAttentionKind, { label: string; tone: Tone }> = {
  problem: { label: "مشکل گزارش‌شده", tone: "danger" },
  overdue: { label: "دارای تأخیر", tone: "danger" },
  extension: { label: "درخواست تمدید", tone: "warning" },
  approval: { label: "منتظر تأیید", tone: "warning" },
  unseen: { label: "دیده‌نشده", tone: "accent" },
  scheduled: { label: "ارسال‌نشده", tone: "neutral" },
};

const CHIPS: Record<OpsChip, { label: string; tone: Tone }> = {
  overloaded: { label: "بار زیاد", tone: "warning" },
  has_overdue: { label: "دارای تأخیر", tone: "danger" },
  idle: { label: "بدون کار باز", tone: "neutral" },
  ok: { label: "عادی", tone: "success" },
};

type Kpi = { key: string; label: string; value: number; status?: string; tone: string };

/** useEffect-ی که فوراً و سپس هر ۶۰ ثانیه (فقط وقتی تب دیده می‌شود) اجرا می‌شود. */
function usePolling(fn: () => void, deps: unknown[]) {
  useEffect(() => {
    fn();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") fn();
    }, REFRESH_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function OperationsDashboard() {
  const { installedModules } = useWorkspace();
  const messengerOn = installedModules.has("messenger");

  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<OpsWorkloadSort>("open");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [reloadKey, setReloadKey] = useState(0);

  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [workload, setWorkload] = useState<OpsWorkload | null>(null);
  const [attention, setAttention] = useState<OpsAttention | null>(null);
  const [trend, setTrend] = useState<OpsTrend | null>(null);
  const [feed, setFeed] = useState<OpsActivityItem[] | null>(null);
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);

  const rangeKey = useDebouncedValue(`${from}|${to}`, 300);
  const beginOverview = useRequestGuard();
  const beginWorkload = useRequestGuard();
  const beginAttention = useRequestGuard();
  const beginTrend = useRequestGuard();
  const beginFeed = useRequestGuard();

  const rangeIso = useCallback(() => {
    const [f, t] = rangeKey.split("|");
    return {
      from: f ? new Date(`${f}T00:00:00`).toISOString() : undefined,
      to: t ? new Date(`${t}T23:59:59`).toISOString() : undefined,
    };
  }, [rangeKey]);

  const setErr = (k: string, v: string) => setErrors((e) => ({ ...e, [k]: v }));

  usePolling(() => {
    const ok = beginOverview();
    const r = rangeIso();
    fetchOpsOverview(r.from, r.to)
      .then((d) => ok() && (setOverview(d), setErr("overview", "")))
      .catch((e) => ok() && setErr("overview", errText(e)));
  }, [rangeKey, reloadKey]);

  usePolling(() => {
    const ok = beginWorkload();
    const r = rangeIso();
    fetchOpsWorkload({ ...r, sort, dir })
      .then((d) => ok() && (setWorkload(d), setErr("workload", "")))
      .catch((e) => ok() && setErr("workload", errText(e)));
  }, [rangeKey, sort, dir, reloadKey]);

  usePolling(() => {
    const ok = beginAttention();
    fetchOpsAttention()
      .then((d) => ok() && (setAttention(d), setErr("attention", "")))
      .catch((e) => ok() && setErr("attention", errText(e)));
  }, [reloadKey]);

  usePolling(() => {
    const ok = beginTrend();
    fetchOpsTrend(days)
      .then((d) => ok() && (setTrend(d), setErr("trend", "")))
      .catch((e) => ok() && setErr("trend", errText(e)));
  }, [days, reloadKey]);

  // فید زنده: صفحه‌ی اول هر ۶۰ ثانیه تازه می‌شود (صفحه‌های بعدی با «بیشتر» می‌آیند)
  usePolling(() => {
    const ok = beginFeed();
    fetchOpsActivity()
      .then((d) => {
        if (!ok()) return;
        setFeed(d.items);
        setFeedCursor(d.nextCursor);
        setErr("feed", "");
      })
      .catch((e) => ok() && setErr("feed", errText(e)));
  }, [reloadKey]);

  async function loadMoreFeed() {
    if (!feedCursor) return;
    try {
      const d = await fetchOpsActivity(feedCursor);
      setFeed((prev) => [...(prev ?? []), ...d.items.filter((i) => !(prev ?? []).some((p) => p.id === i.id))]);
      setFeedCursor(d.nextCursor);
    } catch (e) {
      setErr("feed", errText(e));
    }
  }

  const reload = () => setReloadKey((k) => k + 1);
  const manager = overview?.scope === "all" || workload?.scope === "all";

  const kpis: Kpi[] = overview
    ? [
        { key: "new", label: "جدید", value: overview.counters.new, status: "NEW", tone: "text-primary" },
        { key: "seen", label: "دیده‌شده، شروع‌نشده", value: overview.counters.seenNotStarted, status: "SEEN", tone: "text-accent" },
        { key: "prog", label: "در حال انجام", value: overview.counters.inProgress, status: "IN_PROGRESS", tone: "text-accent" },
        { key: "over", label: "دارای تأخیر", value: overview.counters.overdue, status: "OVERDUE", tone: "text-danger" },
        { key: "appr", label: "منتظر تأیید", value: overview.counters.awaitingApproval, status: "DONE", tone: "text-warning" },
        { key: "ret", label: "برگشت برای اصلاح", value: overview.counters.returnedForFix, status: "RETURNED_FOR_FIX", tone: "text-warning" },
        { key: "prob", label: "دارای مشکل", value: overview.counters.hasProblem, status: "HAS_PROBLEM", tone: "text-danger" },
        { key: "ext", label: "درخواست تمدید", value: overview.counters.extensionPending, tone: "text-warning" },
        { key: "today", label: "انجام‌شده‌ی امروز", value: overview.counters.doneToday, status: "DONE,APPROVED", tone: "text-success" },
        { key: "week", label: "انجام‌شده‌ی این هفته", value: overview.counters.doneThisWeek, status: "DONE,APPROVED", tone: "text-success" },
      ]
    : [];

  async function exportCsv() {
    setExporting(true);
    try {
      const r = rangeIso();
      await downloadOpsCsv(r.from, r.to);
    } catch (e) {
      window.alert(errText(e));
    } finally {
      setExporting(false);
    }
  }

  function toggleSort(s: OpsWorkloadSort) {
    if (sort === s) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(s);
      setDir(s === "name" || s === "avg" ? "asc" : "desc");
    }
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1180px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">داشبورد عملیات</h1>
            <ModuleHelp code="operations" />
          </div>
          <p className="text-[13px] text-muted mt-1">
            {manager === false ? "نمای شخصی از بار کاری شما" : "وضعیت زنده‌ی کارهای مجموعه"}
            {overview ? ` · به‌روزرسانی ${ago(overview.generatedAt)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <JalaliDateInput value={from} onChange={setFrom} placeholder="از تاریخ" className="w-[140px]" />
          <JalaliDateInput value={to} onChange={setTo} placeholder="تا تاریخ" className="w-[140px]" />
          <button type="button" onClick={reload} className={clsx(BTN, "bg-slate-100 text-ink-soft")}>تازه‌سازی</button>
          <button type="button" onClick={exportCsv} disabled={exporting} className={clsx(BTN, "bg-primary text-white")}>
            {exporting ? "در حال دریافت…" : "خروجی CSV"}
          </button>
        </div>
      </div>

      {/* شمارنده‌ها */}
      <Section error={errors.overview} loading={!overview} onRetry={reload} className="mt-4">
        {overview ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {kpis.map((k) => {
                const body = (
                  <>
                    <div className={clsx("text-2xl font-extrabold", k.tone)}>{num(k.value)}</div>
                    <div className="text-[12px] text-muted mt-1">{k.label}</div>
                  </>
                );
                const cls = "bg-surface border border-border rounded-2xl p-3 text-right block";
                return k.status ? (
                  <Link key={k.key} href={`/tasks?status=${k.status}`} className={clsx(cls, "hover:border-primary transition-colors")}>{body}</Link>
                ) : (
                  <a key={k.key} href="#attention" className={clsx(cls, "hover:border-primary transition-colors")}>{body}</a>
                );
              })}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-2.5">
              <Rate label="نرخ تکمیل (ایجادشده‌های بازه)" value={pct(overview.stats.completionRate)} hint={`${num(overview.stats.completed)} از ${num(overview.stats.created)}`} />
              <Rate label="میانگین زمان تا انجام" value={hoursText(overview.stats.avgCompletionHours)} hint="از ایجاد تا ثبت نتیجه" />
              <Rate label="نرخ انجام به‌موقع" value={pct(overview.stats.onTimeRate)} hint="انجام‌شده‌ها تا پیش از موعد" />
            </div>
          </>
        ) : null}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* نیازمند اقدام */}
        <div id="attention" className="lg:col-span-2 scroll-mt-4">
          <h2 className="text-[15px] font-extrabold mb-2">نیازمند اقدام</h2>
          <Section error={errors.attention} loading={!attention} onRetry={reload}>
            {attention && attention.items.length === 0 ? (
              <Card className="p-6 text-center text-[13px] text-muted">همه‌چیز مرتب است؛ موردی نیازمند اقدام نیست.</Card>
            ) : (
              <div className="flex flex-col gap-2">
                {attention?.items.map((it) => (
                  <AttentionRow key={`${it.kind}-${it.extension?.id ?? it.taskId}`} item={it} canManage={attention.scope === "all"} onDone={reload} />
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* فید فعالیت */}
        <div>
          <h2 className="text-[15px] font-extrabold mb-2">فعالیت زنده</h2>
          <Section error={errors.feed} loading={!feed} onRetry={reload}>
            <Card className="p-3">
              {feed && feed.length === 0 ? <div className="text-[13px] text-muted text-center py-4">هنوز فعالیتی ثبت نشده است.</div> : null}
              <ul className="flex flex-col divide-y divide-border max-h-[520px] overflow-y-auto">
                {feed?.map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="text-[12.5px] leading-relaxed">
                      <span className="font-bold">{e.actorName}</span> {e.label}{" "}
                      <Link href={`/tasks?open=${e.taskId}`} className="text-primary font-semibold">
                        <span dir="ltr">{e.code}</span> {e.taskTitle}
                      </Link>
                    </div>
                    {e.note ? <div className="text-[11.5px] text-muted mt-0.5 line-clamp-2">{e.note}</div> : null}
                    <div className="text-[11px] text-muted mt-0.5">{formatJalaliDateTime(e.createdAt)}</div>
                  </li>
                ))}
              </ul>
              {feedCursor ? (
                <button type="button" onClick={loadMoreFeed} className="w-full text-[12px] font-bold text-primary py-2 cursor-pointer">نمایش بیشتر</button>
              ) : null}
            </Card>
          </Section>
        </div>
      </div>

      {/* بار کاری */}
      <h2 className="text-[15px] font-extrabold mt-6 mb-2">بار کاری افراد</h2>
      <Section error={errors.workload} loading={!workload} onRetry={reload}>
        {workload && workload.rows.length === 0 ? (
          <Card className="p-6 text-center text-[13px] text-muted">هنوز وظیفه‌ای به کسی ارجاع نشده است.</Card>
        ) : workload ? (
          <Card className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[720px]">
              <thead>
                <tr className="text-muted text-right border-b border-border">
                  <Th label="نام" k="name" sort={sort} dir={dir} onSort={toggleSort} />
                  <Th label="باز" k="open" sort={sort} dir={dir} onSort={toggleSort} />
                  <Th label="دارای تأخیر" k="overdue" sort={sort} dir={dir} onSort={toggleSort} />
                  <th className="p-2.5 font-bold">منتظر تأیید</th>
                  <Th label="انجام‌شده در بازه" k="done" sort={sort} dir={dir} onSort={toggleSort} />
                  <Th label="میانگین زمان" k="avg" sort={sort} dir={dir} onSort={toggleSort} />
                  <Th label="آخرین فعالیت" k="last" sort={sort} dir={dir} onSort={toggleSort} />
                  <th className="p-2.5 font-bold">وضعیت</th>
                  {messengerOn ? <th className="p-2.5 font-bold" /> : null}
                </tr>
              </thead>
              <tbody>
                {workload.rows.map((r) => (
                  <tr key={r.userId} className="border-b border-border last:border-0">
                    <td className="p-2.5 font-bold">
                      <Link href={`/tasks?assigneeId=${r.userId}`} className="hover:text-primary">{r.name}</Link>
                    </td>
                    <td className="p-2.5">{num(r.openCount)}</td>
                    <td className={clsx("p-2.5", r.overdueCount > 0 && "text-danger font-bold")}>{num(r.overdueCount)}</td>
                    <td className="p-2.5">{num(r.awaitingApprovalCount)}</td>
                    <td className="p-2.5">{num(r.doneInRange)}</td>
                    <td className="p-2.5">{hoursText(r.avgCompletionHours)}</td>
                    <td className="p-2.5 text-muted">{ago(r.lastActivityAt)}</td>
                    <td className="p-2.5">
                      <div className="flex gap-1 flex-wrap">
                        {r.chips.map((c) => (
                          <Badge key={c} tone={CHIPS[c].tone}>{CHIPS[c].label}</Badge>
                        ))}
                      </div>
                    </td>
                    {messengerOn ? (
                      <td className="p-2.5">
                        {r.userId !== workload.currentUserId ? (
                          <Link href={`/messenger?with=${r.userId}`} className="text-primary font-bold text-[12px]">پیام</Link>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </Section>

      {/* روند */}
      <div className="flex items-center justify-between mt-6 mb-2 gap-2 flex-wrap">
        <h2 className="text-[15px] font-extrabold">روند ایجاد و انجام</h2>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={clsx(BTN, days === d ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}>
              {num(d)} روز
            </button>
          ))}
        </div>
      </div>
      <Section error={errors.trend} loading={!trend} onRetry={reload}>
        {trend ? <TrendChart trend={trend} /> : null}
      </Section>
    </div>
  );
}

function Section({ error, loading, onRetry, className, children }: { error?: string; loading: boolean; onRetry: () => void; className?: string; children: React.ReactNode }) {
  if (loading && !error) return <div className={clsx("h-24 rounded-2xl bg-slate-100 animate-pulse", className)} aria-busy="true" />;
  if (error && loading)
    return (
      <Card className={clsx("p-5 text-center", className)}>
        <div className="text-[13px] text-danger">{error}</div>
        <button type="button" onClick={onRetry} className="mt-2 text-[12px] font-bold text-primary cursor-pointer">تلاش دوباره</button>
      </Card>
    );
  return (
    <div className={className}>
      {error ? <div className="text-[11.5px] text-danger mb-1">به‌روزرسانی ناموفق بود؛ آخرین داده نمایش داده می‌شود.</div> : null}
      {children}
    </div>
  );
}

function Rate({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="text-xl font-extrabold mt-1">{value}</div>
      <div className="text-[11px] text-muted mt-0.5">{hint}</div>
    </Card>
  );
}

function Th({ label, k, sort, dir, onSort }: { label: string; k: OpsWorkloadSort; sort: OpsWorkloadSort; dir: "asc" | "desc"; onSort: (k: OpsWorkloadSort) => void }) {
  return (
    <th className="p-2.5 font-bold" aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={clsx("cursor-pointer font-bold", sort === k && "text-primary")}>
        {label}
        {sort === k ? (dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

function AttentionRow({ item, canManage, onDone }: { item: OpsAttentionItem; canManage: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"" | "return" | "resolve">("");
  const [error, setError] = useState("");
  const kind = KINDS[item.kind];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode("");
      setNote("");
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const actionable = item.kind === "approval" || item.kind === "problem" || item.kind === "extension";
  const why =
    item.kind === "overdue"
      ? `${toPersianDigits(item.ageHours)} ساعت از موعد گذشته`
      : item.kind === "unseen"
        ? `${toPersianDigits(item.ageHours)} ساعت است دیده نشده`
        : `${toPersianDigits(item.ageHours)} ساعت در انتظار`;

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge tone={kind.tone}>{kind.label}</Badge>
            {item.priority === "URGENT" ? <Badge tone="danger">فوری</Badge> : null}
            <span className="text-[11px] text-muted" dir="ltr">{item.code}</span>
          </div>
          <Link href={`/tasks?open=${item.taskId}`} className="block text-[13.5px] font-bold mt-1 hover:text-primary">{item.title}</Link>
          <div className="text-[11.5px] text-muted mt-0.5">
            {item.assignees.length ? item.assignees.map((a) => a.name).join("، ") + " · " : ""}
            {why}
          </div>
          {item.detail ? <div className="text-[12px] text-ink-soft mt-1 line-clamp-2">{item.detail}</div> : null}
          {item.extension ? (
            <div className="text-[12px] text-ink-soft mt-1">
              {item.extension.requestedByName} موعد جدید {formatJalaliDateTime(item.extension.proposedDueAt)} را پیشنهاد داده است.
            </div>
          ) : null}
        </div>
        {actionable && canManage ? (
          <div className="flex gap-1.5 flex-wrap">
            {item.kind === "approval" ? (
              <>
                <button type="button" disabled={busy} onClick={() => run(() => approveTask(item.taskId))} className={clsx(BTN, "bg-success text-white")}>تأیید</button>
                <button type="button" disabled={busy} onClick={() => setMode(mode === "return" ? "" : "return")} className={clsx(BTN, "bg-warning-soft text-warning")}>بازگشت</button>
              </>
            ) : null}
            {item.kind === "problem" ? (
              <button type="button" disabled={busy} onClick={() => setMode(mode === "resolve" ? "" : "resolve")} className={clsx(BTN, "bg-success text-white")}>رفع مشکل</button>
            ) : null}
            {item.kind === "extension" && item.extension ? (
              <>
                <button type="button" disabled={busy} onClick={() => run(() => decideTaskExtension(item.taskId, item.extension!.id, true))} className={clsx(BTN, "bg-success text-white")}>تأیید تمدید</button>
                <button type="button" disabled={busy} onClick={() => run(() => decideTaskExtension(item.taskId, item.extension!.id, false))} className={clsx(BTN, "bg-danger-soft text-danger")}>رد</button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {mode ? (
        <div className="mt-2 flex gap-2 items-center flex-wrap">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "return" ? "دلیل بازگشت (الزامی)" : "توضیح (اختیاری)"}
            className="flex-1 min-w-[180px] text-[12.5px] bg-slate-50 border border-border rounded-lg px-3 py-1.5"
          />
          <button
            type="button"
            disabled={busy || (mode === "return" && !note.trim())}
            onClick={() => run(() => (mode === "return" ? returnTask(item.taskId, note.trim()) : resolveTaskProblem(item.taskId, { note: note.trim() || undefined })))}
            className={clsx(BTN, "bg-primary text-white")}
          >
            ثبت
          </button>
        </div>
      ) : null}
      {error ? <div className="text-[11.5px] text-danger mt-1.5">{error}</div> : null}
    </Card>
  );
}

function TrendChart({ trend }: { trend: OpsTrend }) {
  const max = useMemo(() => Math.max(1, ...trend.series.flatMap((s) => [s.created, s.completed])), [trend]);
  const total = trend.series.reduce((a, s) => ({ c: a.c + s.created, d: a.d + s.completed }), { c: 0, d: 0 });
  const label = (iso: string) => {
    const j = toJalali(new Date(`${iso}T12:00:00`));
    return `${toPersianDigits(j.month)}/${toPersianDigits(j.day)}`;
  };
  const step = Math.ceil(trend.series.length / 8);
  const PRI: Array<[keyof OpsTrend["byPriority"], string]> = [["URGENT", "فوری"], ["MEDIUM", "مهم"], ["NORMAL", "عادی"]];
  if (total.c === 0 && total.d === 0) return <Card className="p-6 text-center text-[13px] text-muted">در این بازه فعالیتی ثبت نشده است.</Card>;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-4 text-[12px] mb-3 flex-wrap">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-primary inline-block" />ایجادشده ({num(total.c)})</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-success inline-block" />انجام‌شده ({num(total.d)})</span>
      </div>
      <div className="flex items-end gap-[3px] h-[160px]" role="img" aria-label="نمودار روزانه‌ی وظایف ایجادشده در برابر انجام‌شده" dir="rtl">
        {trend.series.map((s, i) => (
          <div key={s.date} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1" title={`${label(s.date)} — ایجاد ${s.created}، انجام ${s.completed}`}>
            <div className="w-full flex items-end justify-center gap-px h-full">
              <div className="flex-1 bg-primary rounded-t-sm" style={{ height: `${(s.created / max) * 100}%`, minHeight: s.created ? 2 : 0 }} />
              <div className="flex-1 bg-success rounded-t-sm" style={{ height: `${(s.completed / max) * 100}%`, minHeight: s.completed ? 2 : 0 }} />
            </div>
            <span className="text-[9.5px] text-muted h-3 whitespace-nowrap">{i % step === 0 ? label(s.date) : ""}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4">
        {PRI.map(([p, name]) => (
          <div key={p} className="bg-slate-50 rounded-xl p-2.5 text-center">
            <div className="text-[12px] font-bold">{name}</div>
            <div className="text-[11.5px] text-muted mt-0.5">ایجاد {num(trend.byPriority[p].created)} · انجام {num(trend.byPriority[p].completed)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
