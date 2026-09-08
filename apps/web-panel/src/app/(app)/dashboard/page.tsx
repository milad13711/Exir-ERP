"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  DashboardIcon,
  OrdersIcon,
  WarningIcon,
  CheckIcon,
  BillingIcon,
  WarehouseIcon,
} from "@/components/icons";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchTasks,
  toggleTask,
  fetchActivity,
  fetchDashboardSummary,
  fetchExpiringSoonContracts,
  fetchUpcomingAppointmentsThisWeek,
  type ApiTask,
  type ActivityEntry,
  type DashboardSummary,
  type Contract,
  type Appointment,
} from "@/lib/api";
import { formatJalaliDate, formatToman } from "@/lib/persian";
import { formatActivityAction } from "@/lib/activity-labels";

import { ModuleHelp } from "@/components/ui/ModuleHelp";
export default function DashboardPage() {
  const { me, installedModules } = useWorkspace();
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [expiringContracts, setExpiringContracts] = useState<Contract[] | null>(null);
  const [weekAppointments, setWeekAppointments] = useState<Appointment[] | null>(null);

  useEffect(() => {
    fetchTasks().then((t) => setTasks(t.slice(0, 4))).catch(() => setTasks([]));
    fetchActivity().then((a) => setActivity(a.slice(0, 3))).catch(() => setActivity([]));
    fetchDashboardSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    if (!installedModules.has("contracts")) return;
    fetchExpiringSoonContracts().then(setExpiringContracts).catch(() => setExpiringContracts([]));
  }, [installedModules]);

  useEffect(() => {
    if (!installedModules.has("booking")) return;
    fetchUpcomingAppointmentsThisWeek().then(setWeekAppointments).catch(() => setWeekAppointments([]));
  }, [installedModules]);

  async function handleToggle(id: string) {
    const updated = await toggleTask(id);
    setTasks((prev) => prev?.map((t) => (t.id === id ? updated : t)) ?? prev);
  }

  const firstName = (me?.user.name ?? "").split(" ")[0] || "همکار";
  const maxChart = summary ? Math.max(1, ...summary.salesTrend.map((c) => c.value)) : 1;

  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <div className="flex items-baseline justify-between mb-5 gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">سلام {firstName}، خوش برگشتی</h1>
            <ModuleHelp code="dashboard" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">خلاصه‌ی امروز کسب‌وکار شما</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-5">
        <KpiCard
          label="موجودی نقد و بانک"
          value={summary?.cashBalance ?? 0}
          unitSuffix="تومان"
          tone="primary"
          icon={<DashboardIcon className="w-full h-full" />}
        />
        <KpiCard
          label="فاکتورهای این ماه"
          value={summary?.monthInvoiceCount ?? 0}
          unitSuffix="فاکتور"
          tone="success"
          icon={<OrdersIcon className="w-full h-full" />}
        />
        <KpiCard
          label="مطالبات معوق"
          value={summary?.overdueReceivables.total ?? 0}
          unitSuffix="تومان"
          tone="danger"
          note={summary && summary.overdueReceivables.count > 0 ? `${summary.overdueReceivables.count} فاکتور معوق` : undefined}
          icon={<WarningIcon className="w-full h-full" />}
        />
        <KpiCard
          label="چک‌های نزدیک به سررسید"
          value={summary?.checksDueSoon.total ?? 0}
          unitSuffix="تومان"
          tone="warning"
          note={summary && summary.checksDueSoon.count > 0 ? `${summary.checksDueSoon.count} چک ظرف ۷ روز آینده` : undefined}
          icon={<BillingIcon className="w-full h-full" />}
        />
        <KpiCard
          label="کالاهای رو به اتمام"
          value={summary?.lowStockCount ?? 0}
          unitSuffix="کالا"
          tone="warning"
          icon={<WarehouseIcon className="w-full h-full" />}
        />
      </div>

      <div className="grid lg:grid-cols-[1.7fr_1fr] gap-4 mb-4">
        <Card className="p-5.5">
          <div className="flex items-center justify-between mb-5.5">
            <span className="text-[14.5px] font-bold">روند فروش ۶ ماه اخیر</span>
          </div>
          {summary ? (
            <div className="flex items-end gap-3 sm:gap-5.5 h-45 px-1.5">
              {summary.salesTrend.map((point, i) => {
                const isLast = i === summary.salesTrend.length - 1;
                return (
                  <div key={`${point.label}-${i}`} className="flex-1 flex flex-col items-center gap-2.5">
                    <div
                      className={clsx("w-full rounded-t-[10px] rounded-b", isLast ? "bg-primary" : "bg-primary-soft")}
                      style={{ height: `${(point.value / maxChart) * 180}px` }}
                    />
                    <span className={clsx("text-[11.5px]", isLast ? "text-ink font-bold" : "text-muted")}>
                      {point.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-45 flex items-center justify-center text-muted text-sm">در حال بارگذاری...</div>
          )}
        </Card>

        <Card className="p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[14.5px] font-bold">وظایف و یادآوری‌ها</span>
            <a href="/tasks" className="text-xs font-bold text-primary">همه</a>
          </div>
          <div className="flex flex-col gap-3">
            {tasks === null ? (
              <div className="text-center text-muted text-sm py-4">در حال بارگذاری...</div>
            ) : tasks.length === 0 ? (
              <div className="text-center text-muted text-sm py-4">هنوز وظیفه‌ای ثبت نشده است</div>
            ) : (
              tasks.map((task) => {
                const done = task.status === "DONE";
                return (
                  <div key={task.id} className="flex items-start gap-2.5">
                    <button
                      onClick={() => handleToggle(task.id)}
                      className={clsx(
                        "w-4.5 h-4.5 rounded-md mt-0.5 shrink-0 flex items-center justify-center",
                        done ? "bg-success" : "border-2 border-border",
                      )}
                      aria-label="تغییر وضعیت وظیفه"
                    >
                      {done ? <CheckIcon className="w-2.5 h-2.5 text-white" strokeWidth={3} /> : null}
                    </button>
                    <div className="flex-1">
                      <div className={clsx("text-[13px] font-semibold", done && "text-muted line-through")}>
                        {task.title}
                      </div>
                      <div className="text-[11.5px] text-muted mt-0.5">
                        {task.dueAt ? formatJalaliDate(task.dueAt) : formatJalaliDate(task.createdAt)}
                      </div>
                    </div>
                    {task.priority !== "NORMAL" ? (
                      <Badge tone={task.priority === "URGENT" ? "danger" : "warning"}>
                        {task.priority === "URGENT" ? "فوری" : "متوسط"}
                      </Badge>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          <a
            href="/tasks"
            className="mt-4 py-2.5 rounded-[10px] border-[1.5px] border-dashed border-border text-[12.5px] font-semibold text-muted text-center"
          >
            + افزودن وظیفه
          </a>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3.5">
            <span className="text-[14.5px] font-bold">فاکتورهای معوق</span>
            <a href="/sales" className="text-xs font-bold text-primary">همه</a>
          </div>
          {!summary ? (
            <div className="text-center text-muted text-sm py-4">در حال بارگذاری...</div>
          ) : summary.overdueReceivables.items.length === 0 ? (
            <div className="text-center text-muted text-sm py-4">فاکتور معوقی وجود ندارد</div>
          ) : (
            <div className="flex flex-col">
              {summary.overdueReceivables.items.map((inv, i) => (
                <div
                  key={inv.id}
                  className={clsx(
                    "flex items-center justify-between py-2.5",
                    i < summary.overdueReceivables.items.length - 1 && "border-b border-border",
                  )}
                >
                  <div>
                    <div className="text-[12.5px] font-bold">
                      فاکتور #{inv.invoiceNo} — {inv.contact.company || inv.contact.name}
                    </div>
                    <div className="text-[11px] text-danger mt-0.5">سررسید: {formatJalaliDate(inv.dueAt)}</div>
                  </div>
                  <div className="text-[12.5px] font-extrabold">{formatToman(inv.total - inv.paidAmount)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3.5">
            <span className="text-[14.5px] font-bold">چک‌های نزدیک به سررسید</span>
            <a href="/checks" className="text-xs font-bold text-primary">همه</a>
          </div>
          {!summary ? (
            <div className="text-center text-muted text-sm py-4">در حال بارگذاری...</div>
          ) : summary.checksDueSoon.items.length === 0 ? (
            <div className="text-center text-muted text-sm py-4">چکی در این بازه سررسید ندارد</div>
          ) : (
            <div className="flex flex-col">
              {summary.checksDueSoon.items.map((c, i) => {
                const party = c.contact;
                return (
                  <div
                    key={c.id}
                    className={clsx(
                      "flex items-center justify-between py-2.5",
                      i < summary.checksDueSoon.items.length - 1 && "border-b border-border",
                    )}
                  >
                    <div>
                      <div className="text-[12.5px] font-bold flex items-center gap-1.5">
                        {party?.company || party?.name || "—"}
                        <Badge tone={c.direction === "RECEIVED" ? "primary" : "accent"}>
                          {c.direction === "RECEIVED" ? "دریافتی" : "صادرشده"}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-warning mt-0.5">سررسید: {formatJalaliDate(c.dueDate)}</div>
                    </div>
                    <div className="text-[12.5px] font-extrabold">{formatToman(c.amount)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {installedModules.has("contracts") && expiringContracts && expiringContracts.length > 0 ? (
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between mb-3.5">
            <span className="text-[14.5px] font-bold">قراردادهای رو به انقضا (تا یک ماه آینده)</span>
            <a href="/contracts" className="text-xs font-bold text-primary">همه</a>
          </div>
          <div className="flex flex-col">
            {expiringContracts.map((c, i) => {
              const party = c.employee?.fullName ?? c.contact?.name ?? c.secondPartyContact?.name ?? c.secondPartyName ?? "—";
              return (
                <div
                  key={c.id}
                  className={clsx(
                    "flex items-center justify-between py-2.5",
                    i < expiringContracts.length - 1 && "border-b border-border",
                  )}
                >
                  <div>
                    <div className="text-[12.5px] font-bold">
                      قرارداد #{c.contractNo} — {party}
                    </div>
                    <div className="text-[11px] text-warning mt-0.5">پایان: {formatJalaliDate(c.endDate)}</div>
                  </div>
                  <div className="text-[12.5px] font-extrabold">{formatToman(c.value)}</div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {installedModules.has("booking") && weekAppointments && weekAppointments.length > 0 ? (
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between mb-3.5">
            <span className="text-[14.5px] font-bold">نوبت‌های این هفته</span>
            <a href="/booking" className="text-xs font-bold text-primary">همه</a>
          </div>
          <div className="flex flex-col">
            {weekAppointments.map((a, i) => (
              <div
                key={a.id}
                className={clsx(
                  "flex items-center justify-between py-2.5",
                  i < weekAppointments.length - 1 && "border-b border-border",
                )}
              >
                <div>
                  <div className="text-[12.5px] font-bold">
                    {a.customerName} <span className="text-muted font-normal">— {a.serviceType.name}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">{formatJalaliDate(a.startAt)}</div>
                </div>
                <Badge tone={a.status === "PENDING_COORDINATION" ? "warning" : a.status === "CONFIRMED" ? "success" : "primary"}>
                  {a.status === "PENDING_COORDINATION" ? "در انتظار هماهنگی" : a.status === "CONFIRMED" ? "تأییدشده" : "رزروشده"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {installedModules.has("sales") && summary && summary.customerFollowUps.length > 0 ? (
        <Card className="p-5 mb-4">
          <div className="text-[14.5px] font-bold mb-1">مشتریان با موعد پیگیری</div>
          <p className="text-[11.5px] text-muted mb-3.5">
            بر اساس ریتم خرید هر مشتری از هر کالا — نه یک بازه‌ی ثابت برای همه
          </p>
          <div className="flex flex-col">
            {summary.customerFollowUps.map((f, i) => (
              <div
                key={`${f.contactId}-${f.productId}`}
                className={clsx(
                  "flex items-center justify-between py-2.5",
                  i < summary.customerFollowUps.length - 1 && "border-b border-border",
                )}
              >
                <div>
                  <div className="text-[12.5px] font-bold">
                    {f.contactName} <span className="text-muted font-normal">— {f.productName}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    معمولاً هر {f.avgIntervalDays.toLocaleString("fa-IR")} روز — {f.daysSinceLastPurchase.toLocaleString("fa-IR")} روز از خرید قبلی گذشته
                  </div>
                </div>
                <Badge tone="warning">{f.daysOverdue.toLocaleString("fa-IR")} روز موعد گذشته</Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {installedModules.has("production") && summary && summary.producibleCapacity.length > 0 ? (
        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <Card className="p-5">
            <div className="text-[14.5px] font-bold mb-3.5">ظرفیت تولید فعلی</div>
            <div className="flex flex-col">
              {summary.producibleCapacity.map((c, i) => (
                <div
                  key={c.productId}
                  className={clsx(
                    "flex items-center justify-between py-2.5",
                    i < summary.producibleCapacity.length - 1 && "border-b border-border",
                  )}
                >
                  <div>
                    <div className="text-[12.5px] font-bold">{c.productName}</div>
                    {c.bottleneckMaterial ? (
                      <div className="text-[11px] text-danger mt-0.5">کمبود ماده اولیه: {c.bottleneckMaterial}</div>
                    ) : null}
                  </div>
                  <div className={clsx("text-[12.5px] font-extrabold", c.producibleQty === 0 && "text-danger")}>
                    {c.producibleQty.toLocaleString("fa-IR")} {c.unit}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="text-[14.5px] font-bold mb-4">روند تولید ۶ ماه اخیر (مقایسه با سال قبل)</div>
            <div className="flex items-end gap-3 sm:gap-5.5 h-40 px-1.5">
              {summary.productionTrend.map((point, i) => {
                const maxProd = Math.max(1, ...summary.productionTrend.flatMap((p) => [p.value, p.valueLastYear]));
                const isLast = i === summary.productionTrend.length - 1;
                return (
                  <div key={`${point.label}-${i}`} className="flex-1 flex flex-col items-center gap-2.5">
                    <div className="w-full flex items-end gap-1 h-32">
                      <div
                        className="flex-1 rounded-t-[6px] bg-slate-200"
                        style={{ height: `${(point.valueLastYear / maxProd) * 128}px` }}
                        title="سال قبل"
                      />
                      <div
                        className={clsx("flex-1 rounded-t-[6px]", isLast ? "bg-primary" : "bg-primary-soft")}
                        style={{ height: `${(point.value / maxProd) * 128}px` }}
                        title="امسال"
                      />
                    </div>
                    <span className={clsx("text-[11.5px]", isLast ? "text-ink font-bold" : "text-muted")}>{point.label}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      ) : null}

      <Card className="p-5">
        <div className="text-[14.5px] font-bold mb-3.5">فعالیت‌های اخیر</div>
        <div className="flex flex-col">
          {activity === null ? (
            <div className="text-center text-muted text-sm py-4">در حال بارگذاری...</div>
          ) : activity.length === 0 ? (
            <div className="text-center text-muted text-sm py-4">هنوز فعالیتی ثبت نشده است</div>
          ) : (
            activity.map((a, i) => (
              <div
                key={a.id}
                className={clsx(
                  "flex items-center gap-3 py-2.75",
                  i < activity.length - 1 && "border-b border-border",
                )}
              >
                <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 bg-primary-soft text-primary">
                  <OrdersIcon className="w-[15px] h-[15px]" />
                </div>
                <div className="flex-1 text-[13px]">
                  {formatActivityAction(a.action, a.userName)}
                </div>
                <div className="text-xs text-muted whitespace-nowrap">{formatJalaliDate(a.createdAt)}</div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
