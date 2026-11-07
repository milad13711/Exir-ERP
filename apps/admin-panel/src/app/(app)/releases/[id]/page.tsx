"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListSkeleton } from "@/components/ui/EmptyState";
import { INPUT, LABEL, BTN_PRIMARY, BTN_GHOST, BTN_DANGER, BTN_SOFT } from "@/components/ui/styles";
import { ApiError, fetchTenants, type AdminTenant } from "@/lib/api";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  deleteRelease,
  fetchDeliveryReport,
  fetchRecipients,
  fetchRelease,
  fetchReleaseMeta,
  publishRelease,
  retryRelease,
  testSendRelease,
  updateRelease,
  type Channels,
  type ChangeType,
  type DeliveryReport,
  type RecipientsPreview,
  type ReleaseChangeInput,
  type ReleaseFull,
  type ReleaseMeta,
  type ChannelOutcome,
} from "@/lib/module-releases-api";

const TYPE_LABEL: Record<ChangeType, string> = { NEW: "جدید", IMPROVED: "بهبود", FIX: "رفع مشکل" };
const CH_LABEL: Record<string, string> = { NOTIFY: "اعلان", TICKET: "تیکت", SMS: "پیامک" };
const STATUS_LABEL: Record<string, string> = { PENDING: "در جریان", SENT: "ارسال شد", PARTIAL: "ناقص", FAILED: "ناموفق", SKIPPED: "رد شد" };
const REASON_LABEL: Record<string, string> = {
  OPTED_OUT: "انصراف تننت",
  NO_SMS_CHANNEL: "پنل پیامک ندارد",
  NO_RECIPIENT: "گیرنده ندارد",
  DAILY_CAP: "سقف روزانه",
  NO_PUBLIC_URL: "آدرس عمومی تنظیم نشده",
  NOTIFY_INCOMPLETE: "برخی کاربران نرسید",
};
const tone = (s: string) => (s === "SENT" ? "success" : s === "FAILED" ? "danger" : s === "PARTIAL" || s === "PENDING" ? "warning" : "neutral");

const emptyChange = (): ReleaseChangeInput => ({ type: "NEW", title: "", description: "", valueText: "", deepLink: "" });

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-3 min-h-[44px] py-1.5 cursor-pointer">
      <input type="checkbox" className="w-5 h-5 mt-0.5 cursor-pointer" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-[13.5px] font-bold block">{label}</span>
        {hint ? <span className="text-[12px] text-muted block">{hint}</span> : null}
      </span>
    </label>
  );
}

export default function ReleaseEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [rel, setRel] = useState<ReleaseFull | null>(null);
  const [meta, setMeta] = useState<ReleaseMeta | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [changes, setChanges] = useState<ReleaseChangeInput[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [publishOpen, setPublishOpen] = useState(false);
  const [channels, setChannels] = useState<Channels>({ notify: true, ticket: true, sms: false });
  const [recipients, setRecipients] = useState<RecipientsPreview | null>(null);

  const [testOpen, setTestOpen] = useState(false);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [testTenant, setTestTenant] = useState("");
  const [testChannels, setTestChannels] = useState<Channels>({ notify: true, ticket: false, sms: false });
  const [testResult, setTestResult] = useState<Record<string, ChannelOutcome> | null>(null);

  const [report, setReport] = useState<DeliveryReport | null>(null);

  const load = useCallback(() => {
    fetchRelease(id)
      .then((r) => {
        setRel(r);
        setTitle(r.title);
        setSummary(r.summary);
        setChanges(r.changes.map((c) => ({ type: c.type, title: c.title, description: c.description, valueText: c.valueText, deepLink: c.deepLink ?? "" })));
      })
      .catch((e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "بارگذاری نشد" }));
  }, [id]);

  useEffect(() => {
    load();
    fetchReleaseMeta().then(setMeta).catch(() => {});
  }, [load]);

  const loadReport = useCallback(() => {
    fetchDeliveryReport(id).then(setReport).catch(() => {});
  }, [id]);

  const published = rel?.status === "PUBLISHED";

  useEffect(() => {
    if (!published) return;
    loadReport();
    const t = setInterval(loadReport, 8000);
    return () => clearInterval(t);
  }, [published, loadReport]);

  const moduleRoute = meta?.modules.find((m) => m.code === rel?.moduleCode)?.route ?? null;

  function patchChange(i: number, p: Partial<ReleaseChangeInput>) {
    setChanges((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  }
  function move(i: number, d: -1 | 1) {
    setChanges((cs) => {
      const j = i + d;
      if (j < 0 || j >= cs.length) return cs;
      const n = [...cs];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await updateRelease(id, { title, summary, changes: changes.filter((c) => c.title.trim() || c.description.trim()) });
      setRel(r);
      setMsg({ ok: true, text: "ذخیره شد" });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "ذخیره نشد" });
    } finally {
      setBusy(false);
    }
  }

  async function openPublish() {
    setMsg(null);
    await save();
    setRecipients(null);
    setPublishOpen(true);
    fetchRecipients(id).then(setRecipients).catch(() => setRecipients({ tenants: 0, smsReady: 0, optedOut: { notify: 0, ticket: 0, sms: 0 }, sample: [] }));
  }

  async function doPublish() {
    setBusy(true);
    try {
      await publishRelease(id, channels);
      setPublishOpen(false);
      setMsg({ ok: true, text: "منتشر شد؛ ارسال در پس‌زمینه در حال انجام است" });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "انتشار انجام نشد" });
      setPublishOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function doRetry() {
    setBusy(true);
    try {
      await retryRelease(id);
      setMsg({ ok: true, text: "ارسال مجدد شروع شد؛ فقط به کسانی که نگرفته‌اند می‌رود" });
      setTimeout(loadReport, 1500);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "ارسال مجدد انجام نشد" });
    } finally {
      setBusy(false);
    }
  }

  async function openTest() {
    setTestOpen(true);
    setTestResult(null);
    if (!tenants.length) fetchTenants().then((t) => setTenants(t.filter((x) => x.status === "ACTIVE"))).catch(() => {});
  }

  async function doTest() {
    setBusy(true);
    try {
      setTestResult(await testSendRelease(id, testTenant, testChannels));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "ارسال آزمایشی انجام نشد" });
      setTestOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("این پیش‌نویس حذف شود؟")) return;
    try {
      await deleteRelease(id);
      router.replace("/releases");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "حذف نشد" });
    }
  }

  if (!rel) return <div className="p-5 max-w-[900px] mx-auto">{msg ? <div className="text-danger text-sm">{msg.text}</div> : <ListSkeleton />}</div>;

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[900px] mx-auto pb-24">
      <Link href="/releases" className="text-[12.5px] text-primary underline min-h-[40px] inline-flex items-center">
        بازگشت به فهرست
      </Link>
      <PageHeader
        title={`${rel.moduleName} — نسخه ${rel.version}`}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge tone={published ? "success" : "warning"}>{published ? "منتشرشده" : "پیش‌نویس"}</Badge>
            {rel.publishedAt ? <span>{formatJalaliDateTime(rel.publishedAt)}</span> : null}
            <span dir="ltr" className="text-muted">/releases/{rel.shortCode}</span>
          </span>
        }
      />

      {msg ? <div className={`mt-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{msg.text}</div> : null}

      <Card className="p-4 mt-4 flex flex-col gap-3.5">
        <div>
          <label className={LABEL}>عنوان انتشار</label>
          <input className={`${INPUT} text-[16px]`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>خلاصه (اختیاری)</label>
          <textarea className={`${INPUT} text-[16px] min-h-[84px]`} value={summary} maxLength={600} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <p className="text-[12px] text-muted">متن‌ها فقط متن ساده‌اند (HTML حذف می‌شود). دکمه‌ی «رفتن به ماژول و تست» برای هر تغییر به لینک خودش، و اگر خالی باشد به صفحه‌ی ماژول{moduleRoute ? ` (${moduleRoute})` : ""} می‌رود.</p>
      </Card>

      <div className="flex items-center justify-between mt-6 mb-3">
        <h2 className="text-[15px] font-extrabold">تغییرات ({changes.length})</h2>
        <button type="button" className={BTN_SOFT} onClick={() => setChanges((c) => [...c, emptyChange()])}>
          افزودن تغییر
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {changes.map((c, i) => (
          <Card key={i} className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <select className={`${INPUT} !w-auto text-[16px]`} value={c.type} onChange={(e) => patchChange(i, { type: e.target.value as ChangeType })}>
                {(["NEW", "IMPROVED", "FIX"] as ChangeType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input className={`${INPUT} text-[16px]`} placeholder="عنوان تغییر" value={c.title} maxLength={120} onChange={(e) => patchChange(i, { title: e.target.value })} />
            </div>
            <textarea className={`${INPUT} text-[16px] min-h-[72px]`} placeholder="توضیح" value={c.description} maxLength={1200} onChange={(e) => patchChange(i, { description: e.target.value })} />
            <textarea className={`${INPUT} text-[16px] min-h-[64px]`} placeholder="ارزش جدید برای شما (فایده برای مشتری)" value={c.valueText} maxLength={600} onChange={(e) => patchChange(i, { valueText: e.target.value })} />
            <div>
              <input className={`${INPUT} text-[16px]`} dir="ltr" list="route-roots" placeholder={moduleRoute ?? "/sales"} value={c.deepLink} onChange={(e) => patchChange(i, { deepLink: e.target.value })} />
              <datalist id="route-roots">{meta?.routeRoots.map((r) => <option key={r} value={`/${r}`} />)}</datalist>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" className={BTN_GHOST} disabled={i === 0} onClick={() => move(i, -1)}>
                بالا
              </button>
              <button type="button" className={BTN_GHOST} disabled={i === changes.length - 1} onClick={() => move(i, 1)}>
                پایین
              </button>
              <button type="button" className={`${BTN_DANGER} ms-auto`} onClick={() => setChanges((cs) => cs.filter((_, j) => j !== i))}>
                حذف
              </button>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap mt-6">
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={save}>
          ذخیره
        </button>
        <button type="button" className={BTN_SOFT} onClick={openTest}>
          ارسال آزمایشی به یک تننت
        </button>
        {!published ? (
          <>
            <button type="button" className={BTN_PRIMARY} disabled={busy || changes.length === 0} onClick={openPublish}>
              انتشار و اطلاع‌رسانی…
            </button>
            <button type="button" className={`${BTN_DANGER} ms-auto`} onClick={remove}>
              حذف پیش‌نویس
            </button>
          </>
        ) : null}
      </div>

      {published ? (
        <section className="mt-9">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-[15px] font-extrabold">گزارش تحویل {report?.running ? <Badge tone="warning">در حال ارسال…</Badge> : null}</h2>
            <button type="button" className={BTN_SOFT} disabled={busy || !report || report.retryableCount === 0} onClick={doRetry}>
              ارسال دوباره به کسانی که نگرفتند ({report?.retryableCount ?? 0})
            </button>
          </div>
          {report ? (
            <>
              <div className="flex gap-2 flex-wrap mb-3">
                {Object.entries(report.totals).map(([ch, st]) => (
                  <Card key={ch} className="px-3.5 py-2.5 text-[12px]">
                    <b className="text-[13px]">{CH_LABEL[ch] ?? ch}</b>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      {Object.entries(st).map(([s, n]) => (
                        <Badge key={s} tone={tone(s)}>
                          {STATUS_LABEL[s] ?? s}: {n}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {report.tenants.map((t) => (
                  <Card key={t.tenantId} className="p-3.5">
                    <div className="text-[13.5px] font-bold mb-1.5">{t.name}</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {Object.entries(t.channels).map(([ch, o]) => (
                        <Badge key={ch} tone={tone(o.status)} title={o.reason ?? ""}>
                          {CH_LABEL[ch] ?? ch}: {STATUS_LABEL[o.status] ?? o.status}
                          {o.reason ? ` (${REASON_LABEL[o.reason] ?? o.reason})` : ""}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                ))}
                {report.tenants.length === 0 ? <div className="text-[13px] text-muted">هنوز ردیفی ثبت نشده است (یا کانالی انتخاب نشده بود).</div> : null}
              </div>
            </>
          ) : (
            <ListSkeleton count={2} height="h-16" />
          )}
        </section>
      ) : null}

      {publishOpen ? (
        <Modal title="انتشار و اطلاع‌رسانی" onClose={() => setPublishOpen(false)}>
          <div className="flex flex-col gap-3">
            <div className="rounded-xl bg-primary-soft px-3.5 py-3 text-[13px] leading-relaxed">
              {recipients ? (
                <>
                  این انتشار برای <b>{recipients.tenants}</b> تننت فعال (دارای ماژول «{rel.moduleName}») ارسال می‌شود.
                  {channels.sms ? (
                    <>
                      {" "}
                      پیامک فقط به <b>{recipients.smsReady}</b> تننت دارای پنل پیامک (و بدون انصراف) می‌رود.
                    </>
                  ) : null}
                  {recipients.optedOut.notify + recipients.optedOut.ticket + recipients.optedOut.sms > 0 ? (
                    <div className="text-muted mt-1">انصراف‌داده‌ها — اعلان: {recipients.optedOut.notify}، تیکت: {recipients.optedOut.ticket}، پیامک: {recipients.optedOut.sms}</div>
                  ) : null}
                </>
              ) : (
                "در حال شمارش گیرندگان…"
              )}
            </div>
            <div>
              <Check label="اعلان درون‌برنامه و پوش" hint="به همه‌ی کاربران فعال تننت" checked={channels.notify} onChange={(v) => setChannels((c) => ({ ...c, notify: v }))} />
              <Check label="تیکت پشتیبانی خودکار" hint="در فهرست تیکت‌های مالک تننت، از طرف سیستم" checked={channels.ticket} onChange={(v) => setChannels((c) => ({ ...c, ticket: v }))} />
              <Check label="پیامک" hint="فقط به مالک/مدیران (حداکثر ۳ نفر)، با سقف روزانه؛ هزینه از پنل پیامک خود تننت" checked={channels.sms} onChange={(v) => setChannels((c) => ({ ...c, sms: v }))} />
            </div>
            <p className="text-[12px] text-muted">پس از انتشار، متن قابل ویرایش است ولی اعلان‌هایی که رفته‌اند تکرار نمی‌شوند.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" className={BTN_GHOST} onClick={() => setPublishOpen(false)}>
                انصراف
              </button>
              <button type="button" className={BTN_PRIMARY} disabled={busy || !recipients} onClick={doPublish}>
                تأیید و انتشار
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {testOpen ? (
        <Modal title="ارسال آزمایشی" onClose={() => setTestOpen(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className={LABEL}>تننت</label>
              <select className={`${INPUT} text-[16px]`} value={testTenant} onChange={(e) => setTestTenant(e.target.value)}>
                <option value="">انتخاب کنید…</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Check label="اعلان" checked={testChannels.notify} onChange={(v) => setTestChannels((c) => ({ ...c, notify: v }))} />
              <Check label="تیکت" checked={testChannels.ticket} onChange={(v) => setTestChannels((c) => ({ ...c, ticket: v }))} />
              <Check label="پیامک (فقط یک نفر)" checked={testChannels.sms} onChange={(v) => setTestChannels((c) => ({ ...c, sms: v }))} />
            </div>
            <p className="text-[12px] text-muted">فقط به مالک/مدیران همین تننت می‌رود و ارسال واقعی را مصرف نمی‌کند. لینک پیش‌نویس فقط برای همین تننت باز می‌شود.</p>
            {testResult ? (
              <div className="flex gap-1.5 flex-wrap">
                {Object.entries(testResult).map(([ch, o]) => (
                  <Badge key={ch} tone={tone(o.status)}>
                    {CH_LABEL[ch.toUpperCase()] ?? ch}: {STATUS_LABEL[o.status] ?? o.status}
                    {o.reason ? ` (${REASON_LABEL[o.reason] ?? o.reason})` : ""}
                  </Badge>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2 justify-end">
              <button type="button" className={BTN_GHOST} onClick={() => setTestOpen(false)}>
                بستن
              </button>
              <button type="button" className={BTN_PRIMARY} disabled={busy || !testTenant} onClick={doTest}>
                ارسال آزمایشی
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
