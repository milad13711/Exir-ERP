"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { WarningIcon } from "@/components/icons";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { formatActivityAction, MODULE_LABELS_FA } from "@/lib/activity-labels";
import {
  fetchActivityLogs,
  fetchActivityModules,
  fetchErrorLogs,
  type ActivityLogEntry,
  type ErrorLogEntry,
} from "@/lib/api";

type Tab = "activity" | "errors";
const PAGE_SIZE = 20;

const LEVEL_TONES: Record<ErrorLogEntry["level"], "warning" | "danger"> = {
  INFO: "warning",
  WARNING: "warning",
  ERROR: "danger",
  FATAL: "danger",
};

export default function LogsSettingsPage() {
  const [tab, setTab] = useState<Tab>("activity");

  return (
    <div>
      <h1 className="text-xl font-extrabold">لاگ فعالیت‌ها و خطاها</h1>
      <p className="text-[13.5px] text-muted mt-1">
        تاریخچه‌ی کامل فعالیت کاربران و خطاهای سیستمی، قابل فیلتر بر اساس ماژول و بازه‌ی زمانی
      </p>

      <div className="flex items-center gap-2 mt-6 border-b border-border">
        {(
          [
            ["activity", "فعالیت‌ها"],
            ["errors", "خطاهای سیستم"],
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

      {tab === "activity" ? <ActivityTab /> : <ErrorsTab />}
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
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="font-bold text-primary disabled:opacity-30 cursor-pointer disabled:cursor-default"
        >
          قبلی
        </button>
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="font-bold text-primary disabled:opacity-30 cursor-pointer disabled:cursor-default"
        >
          بعدی
        </button>
      </div>
    </div>
  );
}

function ActivityTab() {
  const [items, setItems] = useState<ActivityLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [module, setModule] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [modules, setModules] = useState<string[]>([]);

  useEffect(() => {
    fetchActivityModules().then(setModules).catch(() => setModules([]));
  }, []);

  useEffect(() => {
    fetchActivityLogs({ module: module || undefined, from, to, page, pageSize: PAGE_SIZE })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      });
  }, [module, from, to, page]);

  return (
    <>
      <div className="flex items-center gap-2.5 mt-5 flex-wrap">
        <select
          value={module}
          onChange={(e) => {
            setModule(e.target.value);
            setPage(1);
          }}
          className="text-[12.5px] bg-surface border border-border rounded-xl px-3 py-2 outline-none"
        >
          <option value="">همه‌ی ماژول‌ها</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {MODULE_LABELS_FA[m] ?? m}
            </option>
          ))}
        </select>
        <div className="w-[150px]">
          <JalaliDateInput
            value={from}
            onChange={(v) => {
              setFrom(v);
              setPage(1);
            }}
            placeholder="از تاریخ"
          />
        </div>
        <span className="text-[12px] text-muted">تا</span>
        <div className="w-[150px]">
          <JalaliDateInput
            value={to}
            onChange={(v) => {
              setTo(v);
              setPage(1);
            }}
            placeholder="تا تاریخ"
          />
        </div>
      </div>

      <Card className="mt-4 p-2">
        {items === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">رکوردی یافت نشد</div>
        ) : (
          items.map((a, i) => (
            <div
              key={a.id}
              className={clsx("flex items-center gap-3 px-4 py-3.5", i < items.length - 1 && "border-b border-border")}
            >
              <div className="flex-1 min-w-0 text-[13px]">{formatActivityAction(a.action, a.userName)}</div>
              <div className="text-xs text-muted whitespace-nowrap">{formatJalaliDate(a.createdAt)}</div>
            </div>
          ))
        )}
        <Pager page={page} total={total} onChange={setPage} />
      </Card>
    </>
  );
}

function ErrorsTab() {
  const [items, setItems] = useState<ErrorLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchErrorLogs({ page, pageSize: PAGE_SIZE })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      });
  }, [page]);

  const expanded = useMemo(() => items?.find((i) => i.id === expandedId) ?? null, [items, expandedId]);

  return (
    <Card className="mt-5 p-2">
      {items === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-muted text-sm flex flex-col items-center gap-2">
          <WarningIcon className="w-6 h-6 text-success" />
          هیچ خطایی ثبت نشده است
        </div>
      ) : (
        items.map((e, i) => (
          <div key={e.id} className={clsx(i < items.length - 1 && "border-b border-border")}>
            <button
              onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <Badge tone={LEVEL_TONES[e.level]}>{e.level}</Badge>
              <div className="flex-1 min-w-0 text-[13px] truncate">{e.message}</div>
              <div className="text-xs text-muted whitespace-nowrap">{formatJalaliDate(e.createdAt)}</div>
            </button>
            {expanded?.id === e.id && e.stackTrace ? (
              <pre className="mx-4 mb-3.5 p-3 bg-slate-900 text-slate-100 rounded-xl text-[11px] overflow-x-auto whitespace-pre-wrap" dir="ltr">
                {e.stackTrace}
              </pre>
            ) : null}
          </div>
        ))
      )}
      <Pager page={page} total={total} onChange={setPage} />
    </Card>
  );
}
