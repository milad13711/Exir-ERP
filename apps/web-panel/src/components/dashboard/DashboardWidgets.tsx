"use client";

/**
 * رندررهای ویجت‌های داشبورد. کلید هر ویجت باید با رجیستری سرور (backend-core/src/dashboard/dashboard-widgets.ts)
 * یکی باشد. راهنمای افزودن ویجت جدید: docs/dev/dashboard-widgets.md
 *
 * قاعده: ویجت فقط «نمایش» است؛ مجوز و دامنه‌ی داده را endpointِ خودش اعمال می‌کند. سرور فقط ویجت‌های
 * مجاز کاربر را در چیدمان برمی‌گرداند، پس اینجا فقط loading/empty/error را مدیریت می‌کنیم.
 */
import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon, DashboardIcon, OrdersIcon, WarningIcon, BillingIcon, WarehouseIcon, ChatIcon } from "@/components/icons";
import { formatJalaliDate, formatJalaliDateTime, formatNumber, formatToman } from "@/lib/persian";
import { formatActivityAction } from "@/lib/activity-labels";
import { useMessengerUnread } from "@/lib/useMessengerUnread";
import {
  fetchActivity,
  fetchDashboardSummary,
  fetchExpiringSoonContracts,
  fetchTasks,
  fetchUpcomingAppointmentsThisWeek,
  toggleTask,
  type ActivityEntry,
  type ApiTask,
  type Appointment,
  type Contract,
  type DashboardSummary,
} from "@/lib/api";
import { fetchOpsCounters, type OpsOverview } from "@/lib/operations-api";
import { fetchDispatchActiveCounts, type DispatchActiveCounts } from "@/lib/dispatch-api";
import { ApprovalsList } from "@/components/approvals/ApprovalsList";
import { DailyChecklistWidget } from "@/components/dashboard/DailyChecklistWidget";
import { FormsInboxWidget } from "@/components/dashboard/FormsInboxWidget";
import { ProjectsProgressWidget } from "@/components/dashboard/ProjectsProgressWidget";
import { DueOrOverdueInvoicesWidget } from "@/components/dashboard/DueOrOverdueInvoicesWidget";
import { DashboardCalendar } from "@/components/dashboard/DashboardCalendar";
import { TaskModal } from "@/components/tasks/TaskModal";
import { isTaskFinished } from "@/components/tasks/task-ui";
import { fetchCounters, type Counters } from "@/lib/correspondence-api";

export type WidgetProps = { size: "S" | "M" | "L" | "FULL"; variant: string };

// ── خلاصه‌ی مشترک (یک درخواست برای همه‌ی ویجت‌های خلاصه) ─────────────────────────

type SummaryState = { summary: DashboardSummary | null; failed: boolean };
const SummaryContext = createContext<SummaryState>({ summary: null, failed: false });

/** فقط وقتی `enabled` است (حداقل یک ویجت خلاصه در چیدمان هست) درخواست می‌زند. */
export function DashboardSummaryProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<SummaryState>({ summary: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchDashboardSummary()
      .then((s) => alive && setState({ summary: s, failed: false }))
      .catch(() => alive && setState({ summary: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return <SummaryContext.Provider value={state}>{children}</SummaryContext.Provider>;
}

// ── قطعات مشترک ──────────────────────────────────────────────────────────────

const LOADING = <div className="text-center text-muted text-sm py-4">در حال بارگذاری...</div>;
const empty = (text: string) => <div className="text-center text-muted text-sm py-4">{text}</div>;

function WidgetCard({ title, href, children, className }: { title: string; href?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={clsx("p-4 sm:p-5 min-w-0", className)}>
      <div className="flex items-center justify-between gap-2 mb-3.5">
        <span className="text-[14.5px] font-bold min-w-0">{title}</span>
        {href ? (
          <Link href={href} className="text-xs font-bold text-primary shrink-0 py-1.5 px-1">
            همه
          </Link>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

function Row({ last, children }: { last: boolean; children: ReactNode }) {
  return <div className={clsx("flex items-center justify-between gap-3 py-2.5", !last && "border-b border-border")}>{children}</div>;
}

const take = <T,>(list: T[], variant: string, compactN = 3): T[] => (variant === "compact" ? list.slice(0, compactN) : list);

// ── KPI ──────────────────────────────────────────────────────────────────────

type KpiSpec = {
  label: string;
  tone: "primary" | "success" | "danger" | "warning";
  icon: ReactNode;
  unitSuffix: string;
  value: (s: DashboardSummary) => number;
  note?: (s: DashboardSummary) => string | undefined;
};

const KPI_SPECS: Record<string, KpiSpec> = {
  "kpi-cash": { label: "موجودی نقد و بانک", tone: "primary", icon: <DashboardIcon className="w-full h-full" />, unitSuffix: "تومان", value: (s) => s.cashBalance },
  "kpi-month-invoices": { label: "فاکتورهای این ماه", tone: "success", icon: <OrdersIcon className="w-full h-full" />, unitSuffix: "فاکتور", value: (s) => s.monthInvoiceCount },
  "kpi-overdue": {
    label: "مطالبات معوق",
    tone: "danger",
    icon: <WarningIcon className="w-full h-full" />,
    unitSuffix: "تومان",
    value: (s) => s.overdueReceivables.total,
    note: (s) => (s.overdueReceivables.count > 0 ? `${s.overdueReceivables.count} فاکتور معوق` : undefined),
  },
  "kpi-checks": {
    label: "چک‌های نزدیک به سررسید",
    tone: "warning",
    icon: <BillingIcon className="w-full h-full" />,
    unitSuffix: "تومان",
    value: (s) => s.checksDueSoon.total,
    note: (s) => (s.checksDueSoon.count > 0 ? `${s.checksDueSoon.count} چک ظرف ۷ روز آینده` : undefined),
  },
  "kpi-low-stock": { label: "کالاهای رو به اتمام", tone: "warning", icon: <WarehouseIcon className="w-full h-full" />, unitSuffix: "کالا", value: (s) => s.lowStockCount },
};

function CompactKpi({ label, value, unitSuffix, tone }: { label: string; value: number; unitSuffix: string; tone: KpiSpec["tone"] }) {
  const color = { primary: "text-primary", success: "text-success", danger: "text-danger", warning: "text-warning" }[tone];
  return (
    <Card className="px-3.5 py-3 min-h-[68px] flex flex-col justify-center min-w-0">
      <div className="text-[12px] text-muted truncate">{label}</div>
      <div className={clsx("text-[17px] font-extrabold mt-0.5 truncate", color)}>
        {formatNumber(value)} <span className="text-[11px] font-normal text-ink-soft">{unitSuffix}</span>
      </div>
    </Card>
  );
}

function makeKpi(key: string): ComponentType<WidgetProps> {
  const spec = KPI_SPECS[key];
  return function KpiWidget({ variant }) {
    const { summary } = useContext(SummaryContext);
    const value = summary ? spec.value(summary) : 0;
    if (variant === "compact") return <CompactKpi label={spec.label} value={value} unitSuffix={spec.unitSuffix} tone={spec.tone} />;
    return <KpiCard label={spec.label} value={value} unitSuffix={spec.unitSuffix} tone={spec.tone} note={summary ? spec.note?.(summary) : undefined} icon={spec.icon} />;
  };
}

function MessengerUnreadWidget({ variant }: WidgetProps) {
  const total = useMessengerUnread(true);
  if (variant === "compact") return <CompactKpi label="پیام‌های نخوانده" value={total} unitSuffix="پیام" tone="primary" />;
  return (
    <Link href="/messenger" className="block">
      <KpiCard label="پیام‌های نخوانده" value={total} unitSuffix="پیام" tone="primary" icon={<ChatIcon className="w-full h-full" />} />
    </Link>
  );
}

// ── نمودارها ─────────────────────────────────────────────────────────────────

function SalesTrendWidget({ variant }: WidgetProps) {
  const { summary } = useContext(SummaryContext);
  const max = summary ? Math.max(1, ...summary.salesTrend.map((c) => c.value)) : 1;
  const compact = variant === "compact";
  const h = compact ? 90 : 180;
  return (
    <WidgetCard title="روند فروش ۶ ماه اخیر" className="p-5">
      {summary ? (
        <div className="flex items-end gap-3 sm:gap-5 px-1.5" style={{ height: h + 28 }}>
          {summary.salesTrend.map((point, i) => {
            const isLast = i === summary.salesTrend.length - 1;
            return (
              <div key={`${point.label}-${i}`} className="flex-1 min-w-0 flex flex-col items-center gap-2.5">
                <div className={clsx("w-full rounded-t-[10px] rounded-b", isLast ? "bg-primary" : "bg-primary-soft")} style={{ height: `${(point.value / max) * h}px` }} />
                <span className={clsx("text-[11.5px] truncate max-w-full", isLast ? "text-ink font-bold" : "text-muted")}>{point.label}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center text-muted text-sm" style={{ height: h + 28 }}>در حال بارگذاری...</div>
      )}
    </WidgetCard>
  );
}

function ProductionTrendWidget({ variant }: WidgetProps) {
  const { summary } = useContext(SummaryContext);
  if (!summary) return <WidgetCard title="روند تولید ۶ ماه اخیر (مقایسه با سال قبل)">{LOADING}</WidgetCard>;
  const h = variant === "compact" ? 64 : 128;
  const maxProd = Math.max(1, ...summary.productionTrend.flatMap((p) => [p.value, p.valueLastYear]));
  return (
    <WidgetCard title="روند تولید ۶ ماه اخیر (مقایسه با سال قبل)">
      <div className="flex items-end gap-3 sm:gap-5 px-1.5" style={{ height: h + 28 }}>
        {summary.productionTrend.map((point, i) => {
          const isLast = i === summary.productionTrend.length - 1;
          return (
            <div key={`${point.label}-${i}`} className="flex-1 min-w-0 flex flex-col items-center gap-2.5">
              <div className="w-full flex items-end gap-1" style={{ height: h }}>
                <div className="flex-1 rounded-t-[6px] bg-slate-200" style={{ height: `${(point.valueLastYear / maxProd) * h}px` }} title="سال قبل" />
                <div className={clsx("flex-1 rounded-t-[6px]", isLast ? "bg-primary" : "bg-primary-soft")} style={{ height: `${(point.value / maxProd) * h}px` }} title="امسال" />
              </div>
              <span className={clsx("text-[11.5px] truncate max-w-full", isLast ? "text-ink font-bold" : "text-muted")}>{point.label}</span>
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}

// ── فهرست‌های مبتنی بر خلاصه ────────────────────────────────────────────────────

function DueInvoicesWidget({ variant }: WidgetProps) {
  const { summary } = useContext(SummaryContext);
  return (
    <WidgetCard title="فاکتورهای نزدیک به سررسید و معوق" href="/sales">
      {!summary ? LOADING : summary.dueOrOverdueInvoices.length === 0 ? empty("فاکتور نزدیک به سررسید یا معوقی وجود ندارد") : <DueOrOverdueInvoicesWidget items={take(summary.dueOrOverdueInvoices, variant, 3)} />}
    </WidgetCard>
  );
}

function ChecksDueWidget({ variant }: WidgetProps) {
  const { summary } = useContext(SummaryContext);
  const items = summary ? take(summary.checksDueSoon.items, variant) : [];
  return (
    <WidgetCard title="چک‌های نزدیک به سررسید" href="/checks">
      {!summary ? LOADING : items.length === 0 ? empty("چکی در این بازه سررسید ندارد") : (
        <div className="flex flex-col">
          {items.map((c, i) => {
            const party = c.contact;
            return (
              <Row key={c.id} last={i === items.length - 1}>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold flex items-center gap-1.5 flex-wrap">
                    <span className="truncate">{party?.company || party?.name || "—"}</span>
                    <Badge tone={c.direction === "RECEIVED" ? "primary" : "accent"}>{c.direction === "RECEIVED" ? "دریافتی" : "صادرشده"}</Badge>
                  </div>
                  <div className="text-[11px] text-warning mt-0.5">سررسید: {formatJalaliDate(c.dueDate)}</div>
                </div>
                <div className="text-[12.5px] font-extrabold shrink-0">{formatToman(c.amount)}</div>
              </Row>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

function CustomerFollowUpsWidget({ variant }: WidgetProps) {
  const { summary } = useContext(SummaryContext);
  const items = summary ? take(summary.customerFollowUps, variant) : [];
  return (
    <WidgetCard title="مشتریان با موعد پیگیری">
      <p className="text-[11.5px] text-muted -mt-2.5 mb-3">بر اساس ریتم خرید هر مشتری از هر کالا — نه یک بازه‌ی ثابت برای همه</p>
      {!summary ? LOADING : items.length === 0 ? empty("مشتری‌ای با موعد پیگیری وجود ندارد") : (
        <div className="flex flex-col">
          {items.map((f, i) => (
            <Row key={`${f.contactId}-${f.productId}`} last={i === items.length - 1}>
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold">
                  {f.contactName} <span className="text-muted font-normal">— {f.productName}</span>
                </div>
                <div className="text-[11px] text-muted mt-0.5">
                  معمولاً هر {f.avgIntervalDays.toLocaleString("fa-IR")} روز — {f.daysSinceLastPurchase.toLocaleString("fa-IR")} روز از خرید قبلی گذشته
                </div>
              </div>
              <Badge tone="warning" className="shrink-0">{f.daysOverdue.toLocaleString("fa-IR")} روز موعد گذشته</Badge>
            </Row>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function ProductionCapacityWidget({ variant }: WidgetProps) {
  const { summary } = useContext(SummaryContext);
  const items = summary ? take(summary.producibleCapacity, variant) : [];
  return (
    <WidgetCard title="ظرفیت تولید فعلی">
      {!summary ? LOADING : items.length === 0 ? empty("فرمول تولید فعالی ثبت نشده است") : (
        <div className="flex flex-col">
          {items.map((c, i) => (
            <Row key={c.productId} last={i === items.length - 1}>
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold">{c.productName}</div>
                {c.bottleneckMaterial ? <div className="text-[11px] text-danger mt-0.5">کمبود ماده اولیه: {c.bottleneckMaterial}</div> : null}
              </div>
              <div className={clsx("text-[12.5px] font-extrabold shrink-0", c.producibleQty === 0 && "text-danger")}>
                {c.producibleQty.toLocaleString("fa-IR")} {c.unit}
              </div>
            </Row>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

// ── ویجت‌های با درخواست مستقل ──────────────────────────────────────────────────

function TasksWidget({ variant }: WidgetProps) {
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [openTask, setOpenTask] = useState<ApiTask | null>(null);
  useEffect(() => {
    fetchTasks()
      .then((t) => setTasks([...t].sort((a, b) => Number(isTaskFinished(a.status)) - Number(isTaskFinished(b.status))).slice(0, 5)))
      .catch(() => setTasks([]));
  }, []);
  async function handleToggle(id: string) {
    const updated = await toggleTask(id);
    setTasks((prev) => prev?.map((t) => (t.id === id ? updated : t)) ?? prev);
  }
  const shown = tasks ? take(tasks, variant) : [];
  return (
    <WidgetCard title="وظایف و یادآوری‌ها" href="/tasks" className="flex flex-col">
      <div className="flex flex-col gap-1">
        {tasks === null ? LOADING : shown.length === 0 ? empty("هنوز وظیفه‌ای ثبت نشده است") : (
          shown.map((task) => {
            const done = isTaskFinished(task.status);
            return (
              <div key={task.id} className="flex items-start gap-1">
                <button onClick={() => handleToggle(task.id)} className="w-10 h-10 shrink-0 flex items-center justify-center cursor-pointer" aria-label="تغییر وضعیت وظیفه">
                  <span className={clsx("w-4.5 h-4.5 rounded-md flex items-center justify-center", done ? "bg-success" : "border-2 border-border")}>
                    {done ? <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} /> : null}
                  </span>
                </button>
                <div className="flex-1 min-w-0 cursor-pointer py-2" onClick={() => setOpenTask(task)}>
                  <div className={clsx("text-[13px] font-semibold break-words", done && "text-muted line-through")}>{task.title}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {task.dueAt ? formatJalaliDateTime(task.dueAt) : formatJalaliDate(task.createdAt)}
                    {task.assignee ? ` · ${task.assignee.name}` : ""}
                  </div>
                </div>
                {task.priority !== "NORMAL" ? <Badge tone={task.priority === "URGENT" ? "danger" : "warning"} className="mt-2.5 shrink-0">{task.priority === "URGENT" ? "فوری" : "مهم"}</Badge> : null}
              </div>
            );
          })
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpenTask({ id: "", title: "", dueAt: null, priority: "NORMAL", status: "OPEN", createdAt: "", completedAt: null })}
        className="mt-4 min-h-11 py-2.5 rounded-[10px] border-[1.5px] border-dashed border-border text-[12.5px] font-semibold text-muted text-center cursor-pointer"
      >
        + افزودن وظیفه
      </button>
      {openTask ? (
        <TaskModal
          key={openTask.id || "new"}
          task={openTask.id ? openTask : null}
          onClose={() => setOpenTask(null)}
          onSaved={(saved) =>
            setTasks((prev) => {
              const list = prev ?? [];
              return list.some((t) => t.id === saved.id) ? list.map((t) => (t.id === saved.id ? saved : t)) : [saved, ...list].slice(0, 5);
            })
          }
        />
      ) : null}
    </WidgetCard>
  );
}

function ContractsExpiringWidget({ variant }: WidgetProps) {
  const [list, setList] = useState<Contract[] | null>(null);
  useEffect(() => {
    fetchExpiringSoonContracts().then(setList).catch(() => setList([]));
  }, []);
  const items = list ? take(list, variant) : [];
  return (
    <WidgetCard title="قراردادهای رو به انقضا (تا یک ماه آینده)" href="/contracts">
      {list === null ? LOADING : items.length === 0 ? empty("قراردادی در حال انقضا نیست") : (
        <div className="flex flex-col">
          {items.map((c, i) => {
            const party = c.employee?.fullName ?? c.contact?.name ?? c.secondPartyContact?.name ?? c.secondPartyName ?? "—";
            return (
              <Row key={c.id} last={i === items.length - 1}>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold">قرارداد #{c.contractNo} — {party}</div>
                  <div className="text-[11px] text-warning mt-0.5">پایان: {formatJalaliDate(c.endDate)}</div>
                </div>
                <div className="text-[12.5px] font-extrabold shrink-0">{formatToman(c.value)}</div>
              </Row>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

function WeekAppointmentsWidget({ variant }: WidgetProps) {
  const [list, setList] = useState<Appointment[] | null>(null);
  useEffect(() => {
    fetchUpcomingAppointmentsThisWeek().then(setList).catch(() => setList([]));
  }, []);
  const items = list ? take(list, variant) : [];
  return (
    <WidgetCard title="نوبت‌های این هفته" href="/booking">
      {list === null ? LOADING : items.length === 0 ? empty("نوبتی برای این هفته ثبت نشده است") : (
        <div className="flex flex-col">
          {items.map((a, i) => (
            <Row key={a.id} last={i === items.length - 1}>
              <div className="min-w-0">
                <div className="text-[12.5px] font-bold">{a.customerName} <span className="text-muted font-normal">— {a.serviceType.name}</span></div>
                <div className="text-[11px] text-muted mt-0.5">{formatJalaliDate(a.startAt)}</div>
              </div>
              <Badge tone={a.status === "PENDING_COORDINATION" ? "warning" : a.status === "CONFIRMED" ? "success" : "primary"} className="shrink-0">
                {a.status === "PENDING_COORDINATION" ? "در انتظار هماهنگی" : a.status === "CONFIRMED" ? "تأییدشده" : "رزروشده"}
              </Badge>
            </Row>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function RecentActivityWidget({ variant }: WidgetProps) {
  const [list, setList] = useState<ActivityEntry[] | null>(null);
  useEffect(() => {
    fetchActivity().then((a) => setList(a.slice(0, 5))).catch(() => setList([]));
  }, []);
  const items = list ? take(list, variant, 2) : [];
  return (
    <WidgetCard title="فعالیت‌های اخیر">
      {list === null ? LOADING : items.length === 0 ? empty("هنوز فعالیتی ثبت نشده است") : (
        <div className="flex flex-col">
          {items.map((a, i) => (
            <div key={a.id} className={clsx("flex items-center gap-3 py-2.5", i < items.length - 1 && "border-b border-border")}>
              <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-primary-soft text-primary">
                <OrdersIcon className="w-[15px] h-[15px]" />
              </div>
              <div className="flex-1 min-w-0 text-[13px]">{formatActivityAction(a.action, a.userName)}</div>
              <div className="text-xs text-muted whitespace-nowrap">{formatJalaliDate(a.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function ApprovalsWidget({ variant }: WidgetProps) {
  return (
    <WidgetCard title="کارتابل تأیید من" href="/approvals">
      <ApprovalsList limit={variant === "compact" ? 2 : 3} />
    </WidgetCard>
  );
}

// ── شمارنده‌های عملیات و اعلام بار (endpoint سبک و مخصوص ماژول؛ دامنه‌ی دید سمت سرور اعمال می‌شود) ──

type CountTile = { key: string; label: string; value: number; tone: string; href: string };

function CountTiles({ tiles, compact }: { tiles: CountTile[]; compact: boolean }) {
  const shown = compact ? tiles.filter((t) => t.value > 0).slice(0, 4) : tiles;
  if (shown.length === 0) return empty("موردی برای نمایش نیست");
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {shown.map((t) => (
        <Link key={t.key} href={t.href} className="block min-h-11 rounded-xl bg-slate-50 border border-border px-3 py-2.5 min-w-0">
          <div className={clsx("text-[18px] font-extrabold leading-tight", t.tone)}>{formatNumber(t.value)}</div>
          <div className="text-[11.5px] text-ink-soft mt-0.5 break-words">{t.label}</div>
        </Link>
      ))}
    </div>
  );
}

function OperationsOverviewWidget({ variant }: WidgetProps) {
  const [data, setData] = useState<OpsOverview["counters"] | null | false>(null);
  useEffect(() => {
    fetchOpsCounters().then((r) => setData(r.counters)).catch(() => setData(false));
  }, []);
  const tiles: CountTile[] = data
    ? [
        { key: "new", label: "جدید", value: data.new, tone: "text-primary", href: "/operations" },
        { key: "prog", label: "در حال انجام", value: data.inProgress, tone: "text-accent", href: "/operations" },
        { key: "over", label: "دارای تأخیر", value: data.overdue, tone: "text-danger", href: "/operations" },
        { key: "appr", label: "منتظر تأیید", value: data.awaitingApproval, tone: "text-warning", href: "/operations" },
        { key: "prob", label: "دارای مشکل", value: data.hasProblem, tone: "text-danger", href: "/operations" },
        { key: "today", label: "انجام‌شده‌ی امروز", value: data.doneToday, tone: "text-success", href: "/operations" },
      ]
    : [];
  return (
    <WidgetCard title="وضعیت عملیات" href="/operations">
      {data === null ? LOADING : data === false ? empty("بارگذاری ناموفق بود") : <CountTiles tiles={tiles} compact={variant === "compact"} />}
    </WidgetCard>
  );
}

function DispatchActiveWidget({ variant }: WidgetProps) {
  const [data, setData] = useState<DispatchActiveCounts | null | false>(null);
  useEffect(() => {
    fetchDispatchActiveCounts().then(setData).catch(() => setData(false));
  }, []);
  const tiles: CountTile[] = data
    ? [
        { key: "active", label: "کل بارهای فعال", value: data.active, tone: "text-primary", href: "/dispatch" },
        { key: "driver", label: "در انتظار راننده", value: data.awaitingDriver, tone: "text-warning", href: "/dispatch" },
        { key: "docs", label: "در انتظار اسناد", value: data.awaitingDocs, tone: "text-warning", href: "/dispatch" },
        { key: "ready", label: "آماده حرکت", value: data.readyToDepart, tone: "text-accent", href: "/dispatch" },
        { key: "transit", label: "در مسیر", value: data.inTransit, tone: "text-success", href: "/dispatch" },
        { key: "susp", label: "متوقف", value: data.suspended, tone: "text-danger", href: "/dispatch" },
      ]
    : [];
  return (
    <WidgetCard title="بارهای فعال (اعلام بار)" href="/dispatch">
      {data === null ? LOADING : data === false ? empty("بارگذاری ناموفق بود") : <CountTiles tiles={tiles} compact={variant === "compact"} />}
    </WidgetCard>
  );
}

function CorrespondenceMineWidget({ variant }: WidgetProps) {
  const [data, setData] = useState<Counters | null | false>(null);
  useEffect(() => {
    fetchCounters().then(setData).catch(() => setData(false));
  }, []);
  const tiles: CountTile[] = data
    ? [
        { key: "sign", label: "منتظر امضای من", value: data.pendingSignature, tone: "text-warning", href: "/correspondence" },
        { key: "ref", label: "ارجاع به من", value: data.referralsToMe, tone: "text-primary", href: "/correspondence" },
        { key: "late", label: "ارجاع معوق", value: data.overdueReferrals, tone: "text-danger", href: "/correspondence" },
        { key: "wait", label: "وارده‌ی بدون پاسخ", value: data.awaitingIncoming, tone: "text-accent", href: "/correspondence/incoming" },
        { key: "due", label: "مهلت پاسخ گذشته", value: data.overdueResponses, tone: "text-danger", href: "/correspondence/search" },
        { key: "draft", label: "پیش‌نویس‌ها", value: data.drafts, tone: "text-ink", href: "/correspondence" },
      ]
    : [];
  return (
    <WidgetCard title="مکاتبات من" href="/correspondence">
      {data === null ? LOADING : data === false ? empty("بارگذاری ناموفق بود") : <CountTiles tiles={tiles} compact={variant === "compact"} />}
    </WidgetCard>
  );
}

// ── رجیستری کلاینت: key ← کامپوننت ─────────────────────────────────────────────

export const WIDGET_RENDERERS: Record<string, ComponentType<WidgetProps>> = {
  "daily-checklist": () => <DailyChecklistWidget />,
  "forms-inbox": () => <FormsInboxWidget />,
  "projects-progress": () => <ProjectsProgressWidget />,
  calendar: () => <DashboardCalendar />,
  approvals: ApprovalsWidget,
  "messenger-unread": MessengerUnreadWidget,
  "kpi-cash": makeKpi("kpi-cash"),
  "kpi-month-invoices": makeKpi("kpi-month-invoices"),
  "kpi-overdue": makeKpi("kpi-overdue"),
  "kpi-checks": makeKpi("kpi-checks"),
  "kpi-low-stock": makeKpi("kpi-low-stock"),
  "sales-trend": SalesTrendWidget,
  tasks: TasksWidget,
  "due-invoices": DueInvoicesWidget,
  "checks-due": ChecksDueWidget,
  "contracts-expiring": ContractsExpiringWidget,
  "week-appointments": WeekAppointmentsWidget,
  "customer-followups": CustomerFollowUpsWidget,
  "production-capacity": ProductionCapacityWidget,
  "production-trend": ProductionTrendWidget,
  "operations-overview": OperationsOverviewWidget,
  "dispatch-active": DispatchActiveWidget,
  "correspondence-mine": CorrespondenceMineWidget,
  "recent-activity": RecentActivityWidget,
};

/** ویجت‌هایی که از `GET /dashboard/summary` تغذیه می‌شوند. */
export const SUMMARY_WIDGET_KEYS = new Set([
  "kpi-cash",
  "kpi-month-invoices",
  "kpi-overdue",
  "kpi-checks",
  "kpi-low-stock",
  "sales-trend",
  "due-invoices",
  "checks-due",
  "customer-followups",
  "production-capacity",
  "production-trend",
]);
