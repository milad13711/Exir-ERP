"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { formatActivityAction, MODULE_LABELS_FA } from "@/lib/activity-labels";
import {
  fetchActivityDailySummary,
  fetchActivityLogs,
  fetchActivityModules,
  fetchActivityUsers,
  fetchDailyReportSubmissions,
  updateDailyReportCutoff,
  type ActivityDailySummary,
  type ActivityLogEntry,
  type DailyReportSubmissions,
} from "@/lib/api";

const PAGE_SIZE = 20;

/** برچسب ماژول: اول جدول دستی فرانت، بعد برچسب بک‌اند؛ در نهایت خود کد. */
const MODULE_EXTRA_FA: Record<string, string> = {
  sales: "فروش", purchasing: "خرید", tasks: "وظایف", "daily-checklist": "چک‌لیست روزانه", reports: "گزارش‌ها", projects: "پروژه‌ها",
  contracts: "قراردادها", proposals: "پیشنهادها", booking: "نوبت‌دهی", production: "تولید", mentoring: "منتورینگ", events: "رویدادها",
  forms: "فرم‌ساز", sms: "پیامک", automation: "اتوماسیون", recruitment: "استخدام", checks: "چک‌ها", tax: "مالیات", fleet: "ناوگان",
  warranty: "گارانتی", marketing: "بازاریابی", "online-store": "فروشگاه آنلاین", users: "کاربران و نقش‌ها", settings: "تنظیمات",
  system: "سیستم", approvals: "تأییدیه‌ها", attachments: "پیوست‌ها",
};
const moduleLabel = (m: string) => MODULE_LABELS_FA[m] ?? MODULE_EXTRA_FA[m] ?? m;

const ACTION_TYPES: Record<string, string> = {
  create: "ایجاد", update: "ویرایش", delete: "حذف", approve: "تأیید", reject: "رد", cancel: "ابطال/لغو", send: "ارسال", status: "تغییر وضعیت", other: "سایر",
};

const ACTOR_LABEL: Record<string, string> = { MANUAL: "دستی", AUTOMATIC: "خودکار", SYSTEM: "سیستم" };
const ACTOR_TONE: Record<string, Tone> = { MANUAL: "primary", AUTOMATIC: "accent", SYSTEM: "neutral" };

/** ساعت و تاریخ به وقت تهران، مستقل از ساعت مرورگر */
function formatTehranDateTime(iso: string): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d).split("-").map(Number);
  return `${formatJalaliDate(new Date(y, m - 1, day, 12))} ${toPersianDigits(time)}`;
}

function formatTehranTime(iso: string | null): string {
  if (!iso) return "—";
  return toPersianDigits(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)));
}

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(new Date());
}

type Tab = "list" | "summary" | "reports";

export function ActivityLogsView() {
  const [tab, setTab] = useState<Tab>("list");
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border">
        {(
          [
            ["list", "همه‌ی فعالیت‌ها"],
            ["summary", "خلاصه‌ی روزانه‌ی افراد"],
            ["reports", "ساعت ثبت گزارش روزانه"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2.5 text-[13px] font-bold border-b-2 -mb-px cursor-pointer transition-colors",
              tab === key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink-soft",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "list" ? <ListTab /> : tab === "summary" ? <SummaryTab /> : <ReportsTab />}
    </div>
  );
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-[12px]">
      <span className="text-muted">
        صفحه {toPersianDigits(page)} از {toPersianDigits(totalPages)} · {toPersianDigits(total)} رکورد
      </span>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="font-bold text-primary disabled:opacity-30 cursor-pointer disabled:cursor-default">
          قبلی
        </button>
        <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="font-bold text-primary disabled:opacity-30 cursor-pointer disabled:cursor-default">
          بعدی
        </button>
      </div>
    </div>
  );
}

const selectCls = "text-[12.5px] bg-surface border border-border rounded-xl px-3 py-2 outline-none";

function ListTab() {
  const [items, setItems] = useState<ActivityLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [scope, setScope] = useState<"ALL" | "OWN">("OWN");
  const [page, setPage] = useState(1);
  const [module, setModule] = useState("");
  const [userId, setUserId] = useState("");
  const [actorType, setActorType] = useState("");
  const [actionType, setActionType] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [modules, setModules] = useState<string[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetchActivityModules().then(setModules).catch(() => setModules([]));
    fetchActivityUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    fetchActivityLogs({ module: module || undefined, userId: userId || undefined, actorType: actorType || undefined, actionType: actionType || undefined, q: qDebounced || undefined, from, to, page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setScope((res as unknown as { scope?: "ALL" | "OWN" }).scope ?? "OWN");
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [module, userId, actorType, actionType, qDebounced, from, to, page]);

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <>
      {scope === "OWN" ? (
        <div className="mt-4 text-[12px] text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5">
          فقط فعالیت‌های خودتان نمایش داده می‌شود. برای دیدن فعالیت دیگران، مدیر باید دسترسی «لاگ فعالیت‌ها ← مشاهده‌ی همه» را به نقش شما بدهد.
        </div>
      ) : null}
      <div className="flex items-center gap-2.5 mt-4 flex-wrap">
        <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="جستجو در شرح فعالیت…" className={clsx(selectCls, "w-[200px]")} />
        {scope === "ALL" ? (
          <select value={userId} onChange={(e) => reset(setUserId)(e.target.value)} className={selectCls}>
            <option value="">همه‌ی افراد</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : null}
        <select value={module} onChange={(e) => reset(setModule)(e.target.value)} className={selectCls}>
          <option value="">همه‌ی ماژول‌ها</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {moduleLabel(m)}
            </option>
          ))}
        </select>
        <select value={actionType} onChange={(e) => reset(setActionType)(e.target.value)} className={selectCls}>
          <option value="">همه‌ی انواع عمل</option>
          {Object.entries(ACTION_TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={actorType} onChange={(e) => reset(setActorType)(e.target.value)} className={selectCls}>
          <option value="">دستی و خودکار</option>
          <option value="MANUAL">فقط دستی</option>
          <option value="AUTOMATIC">فقط خودکار</option>
          <option value="SYSTEM">فقط سیستم</option>
        </select>
        <div className="w-[150px]">
          <JalaliDateInput value={from} onChange={reset(setFrom)} placeholder="از تاریخ" />
        </div>
        <span className="text-[12px] text-muted">تا</span>
        <div className="w-[150px]">
          <JalaliDateInput value={to} onChange={reset(setTo)} placeholder="تا تاریخ" />
        </div>
      </div>

      <Card className="mt-4 p-2">
        {items === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">رکوردی یافت نشد</div>
        ) : (
          items.map((a, i) => {
            const actor = a.actorType ?? "MANUAL";
            const meta = (a.metadata ?? {}) as { recipient?: string; purpose?: string; parts?: number; length?: number; preview?: string | null; success?: boolean };
            return (
              <div key={a.id} className={clsx(i < items.length - 1 && "border-b border-border")}>
                <button onClick={() => setOpenId(openId === a.id ? null : a.id)} className="w-full flex items-center gap-3 px-4 py-3 text-right cursor-pointer hover:bg-slate-50 transition-colors">
                  <Badge tone={ACTOR_TONE[actor] ?? "neutral"}>{ACTOR_LABEL[actor] ?? actor}</Badge>
                  <div className="flex-1 min-w-0 text-[13px]">
                    <span className="font-bold">{a.userName ?? (actor === "MANUAL" ? "کاربر" : "سیستم")}</span>
                    <span className="text-muted"> · </span>
                    {a.summary ?? formatActivityAction(a.action, a.userName)}
                  </div>
                  <span className="hidden md:inline text-[11.5px] text-muted whitespace-nowrap">{moduleLabel(a.moduleCode ?? a.action.split(".")[0])}</span>
                  <div className="text-xs text-muted whitespace-nowrap">{formatTehranDateTime(a.createdAt)}</div>
                </button>
                {openId === a.id ? (
                  <div className="mx-4 mb-3 p-3 bg-slate-50 rounded-xl border border-border text-[12px] text-ink-soft grid gap-1">
                    <div>عمل: {ACTION_TYPES[a.actionType ?? "other"] ?? a.actionType ?? "—"} · کد: <span dir="ltr">{a.action}</span></div>
                    {a.entityId ? <div>شناسه‌ی رکورد: <span dir="ltr">{a.entityId}</span></div> : null}
                    {a.ip ? <div>IP: <span dir="ltr">{a.ip}</span></div> : null}
                    {a.action.startsWith("sms.") ? (
                      <div>
                        گیرنده: <span dir="ltr">{meta.recipient}</span> · هدف: {meta.purpose} · {toPersianDigits(meta.length ?? 0)} نویسه / {toPersianDigits(meta.parts ?? 1)} بخش
                        {meta.preview ? <div className="mt-1 text-muted">پیش‌نمایش (ردکت‌شده): {meta.preview}</div> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        <Pager page={page} total={total} onChange={setPage} />
      </Card>
    </>
  );
}

function SummaryTab() {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<ActivityDailySummary | null>(null);

  useEffect(() => {
    setData(null);
    fetchActivityDailySummary(date).then(setData).catch(() => setData({ date, people: [] }));
  }, [date]);

  return (
    <>
      <div className="flex items-center gap-2.5 mt-5">
        <span className="text-[12.5px] text-muted">روز:</span>
        <div className="w-[160px]">
          <JalaliDateInput value={date} onChange={(v) => v && setDate(v)} placeholder="انتخاب روز" />
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {data === null ? (
          <Card className="p-8 text-center text-muted text-sm">در حال بارگذاری...</Card>
        ) : data.people.length === 0 ? (
          <Card className="p-8 text-center text-muted text-sm">برای این روز فعالیتی ثبت نشده است</Card>
        ) : (
          data.people.map((p) => (
            <Card key={p.userId} className="p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="font-extrabold text-[14px]">{p.userName}</div>
                <Badge tone="primary">{toPersianDigits(p.total)} فعالیت</Badge>
                <Badge tone="neutral">دستی {toPersianDigits(p.manual)}</Badge>
                {p.automatic > 0 ? <Badge tone="accent">خودکار {toPersianDigits(p.automatic)}</Badge> : null}
                <div className="text-[12px] text-muted ms-auto">
                  اولین فعالیت {formatTehranTime(p.firstAt)} · آخرین فعالیت {formatTehranTime(p.lastAt)}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {Object.entries(p.modules)
                  .sort((a, b) => b[1] - a[1])
                  .map(([m, n]) => (
                    <span key={m} className="text-[11.5px] bg-slate-100 rounded-lg px-2.5 py-1">
                      {moduleLabel(m)}: <b>{toPersianDigits(n)}</b>
                    </span>
                  ))}
                {Object.entries(p.actions)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, n]) => (
                    <span key={k} className="text-[11.5px] bg-primary-soft text-primary rounded-lg px-2.5 py-1">
                      {ACTION_TYPES[k] ?? k}: <b>{toPersianDigits(n)}</b>
                    </span>
                  ))}
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}

const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  ON_TIME: { label: "به‌موقع", tone: "success" },
  LATE: { label: "با تأخیر", tone: "warning" },
  MISSING: { label: "ثبت نشده", tone: "danger" },
  PENDING: { label: "در انتظار", tone: "neutral" },
};

function ReportsTab() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
  });
  const [to, setTo] = useState(todayIso());
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<DailyReportSubmissions | null>(null);
  const [cutoff, setCutoff] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchActivityUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    setData(null);
    fetchDailyReportSubmissions({ from, to, userId: userId || undefined })
      .then((d) => {
        setData(d);
        setCutoff(`${String(d.cutoff.hour).padStart(2, "0")}:${String(d.cutoff.minute).padStart(2, "0")}`);
      })
      .catch(() => setData({ range: { from, to }, cutoff: { hour: 23, minute: 59 }, rows: [], summary: [] }));
  }, [from, to, userId, saved]);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  async function saveCutoff() {
    if (!/^\d{1,2}:\d{2}$/.test(cutoff)) return;
    await updateDailyReportCutoff(cutoff).catch(() => undefined);
    setSaved((s) => !s);
  }

  return (
    <>
      <div className="flex items-center gap-2.5 mt-5 flex-wrap">
        {users.length > 1 ? (
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={selectCls}>
            <option value="">همه‌ی افراد</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="w-[150px]">
          <JalaliDateInput value={from} onChange={(v) => v && setFrom(v)} placeholder="از تاریخ" />
        </div>
        <span className="text-[12px] text-muted">تا</span>
        <div className="w-[150px]">
          <JalaliDateInput value={to} onChange={(v) => v && setTo(v)} placeholder="تا تاریخ" />
        </div>
        <div className="flex items-center gap-1.5 ms-auto text-[12px] text-muted">
          <span>مهلت «به‌موقع» (به وقت تهران):</span>
          <input value={cutoff} onChange={(e) => setCutoff(e.target.value)} dir="ltr" className={clsx(selectCls, "w-[80px] text-center")} placeholder="23:59" />
          <button onClick={saveCutoff} className="font-bold text-primary cursor-pointer">
            ذخیره
          </button>
        </div>
      </div>

      {data && data.summary.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {data.summary.map((s) => (
            <Card key={s.userId} className="p-3.5">
              <div className="font-bold text-[13px]">{s.userName}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge tone="success">به‌موقع {toPersianDigits(s.onTime)}</Badge>
                <Badge tone="warning">با تأخیر {toPersianDigits(s.late)}</Badge>
                <Badge tone="danger">ثبت‌نشده {toPersianDigits(s.missing)}</Badge>
                <Badge tone="neutral">دستی {toPersianDigits(s.manual)} · خودکار {toPersianDigits(s.auto)}</Badge>
                {s.avgManualMinutes != null ? (
                  <Badge tone="primary">
                    میانگین ساعت ثبت دستی {toPersianDigits(`${String(Math.floor(s.avgManualMinutes / 60)).padStart(2, "0")}:${String(s.avgManualMinutes % 60).padStart(2, "0")}`)}
                  </Badge>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <Card className="mt-4 p-2">
        {data === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">در این بازه چک‌لیست یا گزارشی ثبت نشده است</div>
        ) : (
          rows.map((r, i) => (
            <div key={`${r.userId}-${r.date}`} className={clsx("flex items-center gap-3 px-4 py-3 text-[13px]", i < rows.length - 1 && "border-b border-border")}>
              <div className="w-[110px] font-bold truncate">{r.userName}</div>
              <div className="w-[90px] text-muted">{toPersianDigits(r.dateFa)}</div>
              <div className="flex-1 min-w-0">
                {r.submitted ? (
                  <>
                    ثبت در ساعت <b>{toPersianDigits(r.submittedTimeFa ?? "")}</b>
                    <span className="text-muted"> · {r.mode === "AUTO" ? "ثبت خودکار پایان روز" : "ثبت دستی توسط خود فرد"}</span>
                  </>
                ) : (
                  <span className="text-muted">گزارشی ثبت نشده</span>
                )}
              </div>
              <span className="hidden md:inline text-[11.5px] text-muted">
                {toPersianDigits(r.itemsDone)}/{toPersianDigits(r.itemsTotal)} کار
              </span>
              <Badge tone={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].label}</Badge>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
