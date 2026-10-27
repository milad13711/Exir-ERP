"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DocsIcon, WebhookIcon, BotIcon, PlusIcon } from "@/components/icons";
import { formatJalaliDate } from "@/lib/persian";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import {
  API_URL,
  fetchApiKeys,
  revokeApiKey,
  rotateApiKey,
  fetchWebhooks,
  fetchWebhookEvents,
  toggleWebhook,
  deleteWebhook,
  type ApiKeyEntry,
  type WebhookSubscription,
} from "@/lib/api";
import { NewApiKeyModal, RawKeyReveal } from "@/components/api/NewApiKeyModal";
import { McpConnectGuide } from "@/components/api/McpConnectGuide";
import { describeKey, isKeyExpired, moduleLabel } from "@/components/api/key-scopes";
import { Modal } from "@/components/ui/Modal";
import { NewWebhookModal } from "@/components/api/NewWebhookModal";
import { WebhookDeliveriesModal } from "@/components/api/WebhookDeliveriesModal";
import { WEBHOOK_EVENT_LABELS } from "@/components/api/webhook-labels";
import { useWorkspace } from "@/lib/workspace-context";

type ToolRef = { name: string; desc: string; module: string; kind: "read" | "write" };

/** هم‌خوان با src/mcp/*: هر ابزار ماژول و نوع (read فوری / write فقط درخواست تأیید) دارد. */
const MCP_TOOLS_REFERENCE: ToolRef[] = [
  { name: "list_crm_deals", desc: "فهرست فرصت‌های فروش CRM", module: "crm", kind: "read" },
  { name: "search_crm_contacts", desc: "جست‌وجوی مخاطبان و مرحله‌ی قیف", module: "crm", kind: "read" },
  { name: "create_crm_contact", desc: "ثبت مخاطب جدید در CRM", module: "crm", kind: "write" },
  { name: "update_crm_contact", desc: "ویرایش مخاطب CRM", module: "crm", kind: "write" },
  { name: "create_crm_deal", desc: "ثبت فرصت فروش جدید", module: "crm", kind: "write" },
  { name: "update_funnel_stage", desc: "جابه‌جایی مرحله‌ی سرنخ در قیف", module: "crm", kind: "write" },
  { name: "disqualify_lead", desc: "رد صلاحیت سرنخ با دلیل", module: "crm", kind: "write" },
  { name: "convert_lead_to_customer", desc: "تبدیل سرنخ به مشتری", module: "crm", kind: "write" },
  { name: "list_sales_invoices", desc: "فهرست فاکتورهای فروش", module: "sales", kind: "read" },
  { name: "create_sales_invoice", desc: "ثبت فاکتور فروش جدید", module: "sales", kind: "write" },
  { name: "list_purchase_orders", desc: "فهرست سفارش‌های خرید", module: "purchasing", kind: "read" },
  { name: "create_purchase_order", desc: "ثبت سفارش خرید جدید", module: "purchasing", kind: "write" },
  { name: "list_products", desc: "فهرست کالاهای انبار", module: "warehouse", kind: "read" },
  { name: "get_stock_levels", desc: "موجودی فعلی و کالاهای زیر نقطه‌ی سفارش", module: "warehouse", kind: "read" },
  { name: "create_product", desc: "ثبت کالای جدید", module: "warehouse", kind: "write" },
  { name: "get_accounting_summary", desc: "خلاصه‌ی وضعیت مالی", module: "accounting", kind: "read" },
  { name: "create_journal_entry", desc: "ثبت سند حسابداری", module: "accounting", kind: "write" },
  { name: "list_employees", desc: "فهرست کارمندان", module: "hr", kind: "read" },
  { name: "create_leave_request", desc: "ثبت درخواست مرخصی", module: "hr", kind: "write" },
  { name: "list_tasks", desc: "فهرست وظایف باز", module: "tasks", kind: "read" },
  { name: "search_tasks", desc: "جست‌وجوی وظایف با فیلتر و شماره‌ی TASK-000123", module: "tasks", kind: "read" },
  { name: "get_task", desc: "جزئیات و خط زمان یک وظیفه", module: "tasks", kind: "read" },
  { name: "create_task", desc: "ثبت وظیفه‌ی جدید (مسئول‌ها، موعد، جزئیات بیشتر)", module: "tasks", kind: "write" },
  { name: "add_task_comment", desc: "افزودن نظر به وظیفه", module: "tasks", kind: "write" },
  { name: "reassign_task", desc: "تغییر مسئول وظیفه", module: "tasks", kind: "write" },
  { name: "get_operations_overview", desc: "شمارنده‌های داشبورد عملیات", module: "operations", kind: "read" },
  { name: "search_letters", desc: "جست‌وجوی نامه‌های دبیرخانه (بدون سری)", module: "correspondence", kind: "read" },
  { name: "get_letter", desc: "وضعیت و خط زمان نامه", module: "correspondence", kind: "read" },
  { name: "list_pending_letter_actions", desc: "نامه‌های منتظر امضا و ارجاع‌های باز", module: "correspondence", kind: "read" },
  { name: "create_letter_draft", desc: "ایجاد پیش‌نویس نامه‌ی صادره/داخلی", module: "correspondence", kind: "write" },
  { name: "register_incoming_letter", desc: "ثبت نامه‌ی وارده با شماره‌ی دبیرخانه", module: "correspondence", kind: "write" },
  { name: "search_shipments", desc: "فهرست بارها (راننده، منطقه، وضعیت، وزن)", module: "dispatch", kind: "read" },
  { name: "get_shipment", desc: "جزئیات، وزن‌ها و خط زمان بار", module: "dispatch", kind: "read" },
  { name: "get_dispatch_overview", desc: "شمارنده‌ی بارهای فعال", module: "dispatch", kind: "read" },
  { name: "declare_shipment", desc: "اعلام بار (دستی یا از فاکتور/تولید)", module: "dispatch", kind: "write" },
  { name: "list_booking_services", desc: "فهرست خدمات قابل رزرو", module: "booking", kind: "read" },
  { name: "list_free_slots", desc: "وقت‌های آزاد یک خدمت در یک روز", module: "booking", kind: "read" },
  { name: "list_appointments", desc: "فهرست نوبت‌ها", module: "booking", kind: "read" },
  { name: "create_appointment", desc: "ثبت نوبت برای مشتری", module: "booking", kind: "write" },
  { name: "create_reminder", desc: "ثبت یادآوری در تقویم داشبورد", module: "dashboard", kind: "write" },
  { name: "suggest_new_module", desc: "پیشنهاد ماژول جدید به تیم اکسیر", module: "mcp", kind: "write" },
  { name: "list_module_suggestions", desc: "پیگیری پیشنهادهای ماژول", module: "mcp", kind: "read" },
];

const sections = [
  {
    title: "REST API",
    description: "دسترسی برنامه‌نویسی به داده‌های تننت شما — مشتریان، فاکتورها، موجودی و بیشتر.",
    tone: "primary" as const,
    tag: "v1",
    Icon: DocsIcon,
    href: `${API_URL}/docs`,
    linkLabel: "مشاهده مستندات",
  },
  {
    title: "وب‌هوک‌ها (Webhooks)",
    description: "دریافت رویداد لحظه‌ای (فرصت فروش جدید، وظیفه، تغییر موجودی و…) در سامانه‌ی خودتان.",
    tone: "accent" as const,
    tag: "۵ رویداد",
    Icon: WebhookIcon,
    href: "#webhooks",
    linkLabel: "مدیریت وب‌هوک‌ها",
  },
  {
    title: "MCP Server",
    description: "اتصال ایجنت‌های هوش مصنوعی مستقل به محیط کاری شما با استاندارد MCP.",
    tone: "warning" as const,
    tag: "بتا",
    Icon: BotIcon,
    href: "#mcp",
    linkLabel: "راهنمای اتصال",
  },
];

export default function ApiDocsSettingsPage() {
  const { installedModules } = useWorkspace();
  const webhooksEnabled = installedModules.has("webhooks");
  const mcpEnabled = installedModules.has("mcp");
  const [keys, setKeys] = useState<ApiKeyEntry[] | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookSubscription[] | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newWebhookOpen, setNewWebhookOpen] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [rotated, setRotated] = useState<{ rawKey: string; name: string } | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    fetchApiKeys().then(setKeys).catch(() => setKeys([]));
    fetchWebhooks().then(setWebhooks).catch(() => setWebhooks([]));
    fetchWebhookEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  async function handleRevoke(id: string) {
    const updated = await revokeApiKey(id);
    setKeys((prev) => prev?.map((k) => (k.id === id ? updated : k)) ?? prev);
  }

  async function handleRotate(k: ApiKeyEntry) {
    if (!window.confirm(`کلید «${k.name}» چرخانده شود؟ کلید جدید با همان دسترسی‌ها ساخته می‌شود و کلید قبلی تا ۲۴ ساعت دیگر هنوز کار می‌کند تا فرصت جایگزینی داشته باشید.`)) return;
    setKeyError(null);
    try {
      const created = await rotateApiKey(k.id);
      setRotated({ rawKey: created.rawKey, name: created.name });
      const fresh = await fetchApiKeys();
      setKeys(fresh);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "چرخش کلید انجام نشد");
    }
  }

  async function handleToggleWebhook(id: string) {
    const updated = await toggleWebhook(id);
    setWebhooks((prev) => prev?.map((w) => (w.id === id ? updated : w)) ?? prev);
  }

  async function handleDeleteWebhook(id: string) {
    await deleteWebhook(id);
    setWebhooks((prev) => prev?.filter((w) => w.id !== id) ?? prev);
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold flex items-center gap-2">
        API، وب‌هوک و MCP
        <ModuleHelp code="mcp" />
      </h1>
      <p className="text-[13.5px] text-muted mt-1">
        نرم‌افزارها و ایجنت‌های مستقل خودتان را به محیط کاری اکسیر متصل کنید
      </p>

      <div className="grid sm:grid-cols-3 gap-4 mt-6">
        {sections.map((s) => (
          <Card key={s.title} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold flex items-center gap-2">
                <s.Icon className="w-4 h-4 text-ink-soft" />
                {s.title}
              </span>
              <Badge tone={s.tone}>{s.tag}</Badge>
            </div>
            <p className="text-[12.5px] text-muted mt-2.5 leading-relaxed">{s.description}</p>
            <a
              href={s.href}
              target={s.href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="mt-4 text-[12.5px] font-bold text-primary inline-block"
            >
              {s.linkLabel} ←
            </a>
          </Card>
        ))}
      </div>

      {/* کلیدهای API */}
      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[13.5px] font-bold">کلیدهای API</div>
          <button
            onClick={() => setNewKeyOpen(true)}
            className="text-[12.5px] font-bold text-primary flex items-center gap-1 cursor-pointer"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            ساخت کلید جدید
          </button>
        </div>
        <p className="text-[11.5px] text-muted mb-3">
          همان کلید برای REST API و MCP Server استفاده می‌شود. هر کلید یک سطح دسترسی دارد؛ برای ایجنت‌ها «فقط‌خواندنی» یا «خواندن + درخواست تأیید» را بگذارید.
        </p>
        {keyError ? <div className="text-[12px] text-danger bg-danger-soft rounded-xl p-3 mb-3">{keyError}</div> : null}
        {keys === null ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : keys.length === 0 ? (
          <div className="py-6 text-center text-muted text-sm">هنوز کلیدی نساخته‌اید</div>
        ) : (
          keys.map((k, i) => {
            const access = describeKey(k);
            const expired = isKeyExpired(k);
            const dead = !!k.revokedAt || expired;
            return (
              <div
                key={k.id}
                className={`flex items-start justify-between gap-3 py-3 ${i < keys.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{k.name}</div>
                  <div className="text-[11.5px] text-muted mt-0.5 font-mono" dir="ltr">
                    {k.keyPrefix}••••••••
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <Badge tone={access.legacy ? "warning" : access.level === "read_only" ? "success" : access.level === "read_propose" ? "primary" : "danger"}>
                      {access.levelLabel}
                    </Badge>
                    {access.modules.map((m) => (
                      <Badge key={m} tone="neutral">
                        {moduleLabel(m)}
                      </Badge>
                    ))}
                    {access.tools.length ? <Badge tone="neutral">{access.tools.length} ابزار مجاز</Badge> : null}
                    {k.ipAllowlist.length ? <Badge tone="neutral">محدود به IP</Badge> : null}
                    {k.expiresAt ? (
                      <Badge tone={expired ? "danger" : "neutral"}>
                        {expired ? "منقضی‌شده" : `انقضا: ${formatJalaliDate(k.expiresAt)}`}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-[10.5px] text-muted mt-1.5">
                    ساخته‌شده: {formatJalaliDate(k.createdAt)}
                    {k.lastUsedAt
                      ? ` · آخرین استفاده: ${formatJalaliDate(k.lastUsedAt)}${k.lastUsedIp ? ` از ${k.lastUsedIp}` : ""} · ${k.useCount.toLocaleString("fa-IR")} فراخوانی`
                      : " · هنوز استفاده نشده"}
                  </div>
                </div>
                {k.revokedAt ? (
                  <Badge tone="danger">باطل‌شده</Badge>
                ) : (
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge tone={expired ? "danger" : "success"}>{expired ? "منقضی" : "فعال"}</Badge>
                    {!dead ? (
                      <button onClick={() => handleRotate(k)} className="text-[11.5px] font-bold text-primary cursor-pointer">
                        چرخش
                      </button>
                    ) : null}
                    <button onClick={() => handleRevoke(k.id)} className="text-[11.5px] font-bold text-danger cursor-pointer">
                      ابطال
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </Card>

      {/* وب‌هوک‌ها */}
      {webhooksEnabled ? (
      <Card id="webhooks" className="mt-6 p-5 scroll-mt-20">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13.5px] font-bold">وب‌هوک‌ها</div>
          <button
            onClick={() => setNewWebhookOpen(true)}
            className="text-[12.5px] font-bold text-primary flex items-center gap-1 cursor-pointer"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            وب‌هوک جدید
          </button>
        </div>
        {webhooks === null ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : webhooks.length === 0 ? (
          <div className="py-6 text-center text-muted text-sm">هنوز وب‌هوکی ثبت نکرده‌اید</div>
        ) : (
          webhooks.map((w, i) => (
            <div key={w.id} className={`py-3 ${i < webhooks.length - 1 ? "border-b border-border" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold font-mono truncate" dir="ltr">
                    {w.url}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {w.events.map((e) => (
                      <Badge key={e} tone="neutral">
                        {WEBHOOK_EVENT_LABELS[e] ?? e}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Badge tone={w.isActive ? "success" : "neutral"}>{w.isActive ? "فعال" : "غیرفعال"}</Badge>
              </div>
              <div className="flex items-center gap-3 mt-2.5 text-[11.5px] font-bold">
                <button onClick={() => setDeliveriesFor(w.id)} className="text-primary cursor-pointer">
                  تاریخچه ارسال
                </button>
                <button onClick={() => handleToggleWebhook(w.id)} className="text-ink-soft cursor-pointer">
                  {w.isActive ? "غیرفعال کردن" : "فعال کردن"}
                </button>
                <button onClick={() => handleDeleteWebhook(w.id)} className="text-danger cursor-pointer">
                  حذف
                </button>
              </div>
            </div>
          ))
        )}
      </Card>
      ) : null}

      {/* MCP */}
      {mcpEnabled ? (
      <Card id="mcp" className="mt-6 p-5 scroll-mt-20">
        <div className="text-[13.5px] font-bold mb-1">اتصال از طریق MCP</div>
        <p className="text-[12px] text-muted mb-3 leading-relaxed">
          ایجنت هوش مصنوعی خود را با پروتکل MCP (Streamable HTTP) به این آدرس و یکی از کلیدهای بالا وصل کنید.
          ابزارهای فقط-خواندنی بلافاصله اجرا می‌شوند؛ ثبت/ویرایش/حذف همیشه اول منتظر تأیید شما می‌ماند — از «دستیار هوشمند (MCP)» در همین منو دنبال کنید.
        </p>
        <div className="bg-slate-50 border border-border rounded-xl p-3.5">
          <div className="text-[11px] text-muted mb-1">آدرس سرور MCP</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12px] font-mono text-ink" dir="ltr">
              {API_URL}/mcp
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${API_URL}/mcp`);
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 2000);
              }}
              className="text-[11px] font-bold text-primary cursor-pointer shrink-0"
            >
              {copiedUrl ? "کپی شد ✓" : "کپی"}
            </button>
          </div>
          <div className="text-[11px] text-muted mt-2.5">
            هدر احراز هویت: <code dir="ltr">Authorization: Bearer exir_live_...</code>
          </div>
        </div>
        <div className="mt-4">
          <div className="text-[11.5px] text-muted mb-2">ابزارهای در دسترس</div>
          <div className="flex flex-col gap-1.5">
            {MCP_TOOLS_REFERENCE.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-3 text-[12px]">
                <span className="flex items-center gap-2 min-w-0">
                  <code className="font-mono text-ink-soft truncate" dir="ltr">
                    {t.name}
                  </code>
                  <Badge tone={t.kind === "read" ? "success" : "warning"} className="!py-0.5 shrink-0">
                    {t.kind === "read" ? "فوری" : "نیازمند تأیید"}
                  </Badge>
                </span>
                <span className="text-muted text-end">{t.desc}</span>
              </div>
            ))}
          </div>
        </div>
        <McpConnectGuide mcpUrl={`${API_URL}/mcp`} />
      </Card>
      ) : null}

      {rotated ? (
        <Modal title={`کلید جدید برای «${rotated.name}»`} onClose={() => setRotated(null)}>
          <RawKeyReveal rawKey={rotated.rawKey} onClose={() => setRotated(null)} note="کلید قبلی تا ۲۴ ساعت دیگر هنوز کار می‌کند؛ بعد از جایگزینی آن را «ابطال» کنید." />
        </Modal>
      ) : null}

      {newKeyOpen ? (
        <NewApiKeyModal
          onClose={() => setNewKeyOpen(false)}
          onCreated={(key) => setKeys((prev) => [key, ...(prev ?? [])])}
        />
      ) : null}

      {newWebhookOpen ? (
        <NewWebhookModal
          events={events}
          onClose={() => setNewWebhookOpen(false)}
          onCreated={(w) => setWebhooks((prev) => [w, ...(prev ?? [])])}
        />
      ) : null}

      {deliveriesFor ? (
        <WebhookDeliveriesModal webhookId={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      ) : null}
    </div>
  );
}
