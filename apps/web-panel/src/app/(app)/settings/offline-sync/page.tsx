"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConflictDialog } from "@/components/offline/ConflictDialog";
import { OfflineOnboarding } from "@/components/offline/OfflineOnboarding";
import { apiFetch } from "@/lib/api";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import { getManager, requestPersistence, type OfflinePolicy } from "@/lib/offline/client";
import { OFFLINE_OPS } from "@/lib/offline/registry";
import type { OutboxItem, OutboxStatus } from "@/lib/offline/types";
import { useOfflineSnapshot, useOutboxItems } from "@/lib/offline/useOffline";

const STATUS: Record<OutboxStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { label: "در انتظار", tone: "warning" },
  syncing: { label: "در حال ارسال", tone: "warning" },
  failed: { label: "ناموفق", tone: "danger" },
  conflict: { label: "تعارض", tone: "danger" },
  done: { label: "همگام شد", tone: "success" },
};

const mb = (n: number) => `${toPersianDigits((n / 1048576).toFixed(1))} مگابایت`;
const inputCls = "w-full min-h-[40px] rounded-lg border border-border bg-surface px-3 text-[16px]";

export default function OfflineSyncSettingsPage() {
  const { me } = useWorkspace();
  const isManager = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";
  const [tab, setTab] = useState<"queue" | "diag" | "policy">("queue");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-extrabold text-ink">کار آفلاین و همگام‌سازی</h1>
        <p className="text-[12.5px] text-muted mt-1">ثبت اطلاعات بدون اینترنت روی گوشی و لپ‌تاپ؛ ارسال خودکار و بدون ثبت تکراری پس از اتصال.</p>
      </div>
      <OfflineOnboarding />
      <div className="flex gap-1.5 overflow-x-auto">
        {([["queue", "صف همگام‌سازی"], ["diag", "حافظه و عیب‌یابی"], ...(isManager ? [["policy", "سیاست سازمان"]] : [])] as Array<[typeof tab, string]>).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={clsx("min-h-[40px] px-4 rounded-lg text-[13px] font-bold whitespace-nowrap", tab === k ? "bg-primary text-white" : "bg-slate-100 text-ink-soft")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "queue" ? <QueueTab /> : tab === "diag" ? <DiagTab /> : <PolicyTab />}
    </div>
  );
}

function QueueTab() {
  const snap = useOfflineSnapshot();
  const { items, reload } = useOutboxItems();
  const [conflict, setConflict] = useState<OutboxItem | null>(null);
  const [editing, setEditing] = useState<{ item: OutboxItem; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const m = getManager();

  async function syncNow() {
    if (!m) return;
    setBusy(true);
    try {
      await m.syncNow();
    } finally {
      setBusy(false);
      reload();
    }
  }
  async function discard(it: OutboxItem) {
    if (!m || !window.confirm("این مورد برای همیشه دور انداخته شود؟ این کار برگشت‌پذیر نیست.")) return;
    await m.engine.discard(it.id);
    reload();
  }
  function exportJson() {
    const safe = (items ?? []).map((i) => ({ ...i, body: JSON.parse(JSON.stringify(i.body ?? null, (_k, v) => (typeof v === "string" && v.startsWith("data:") ? "[فایل]" : v))), idempotencyKey: undefined }));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), items: safe }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "exir-offline-queue.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  if (!snap.active) {
    return <Card className="p-4 text-[13px] text-muted">این مرورگر از ذخیره‌سازی امن آفلاین پشتیبانی نمی‌کند یا ماژول فعال نیست.</Card>;
  }
  const open = (items ?? []).filter((i) => i.status !== "done");
  const done = (items ?? []).filter((i) => i.status === "done");

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Badge tone={snap.online ? "success" : "danger"}>{snap.online ? "آنلاین" : "آفلاین"}</Badge>
            <span className="text-[13px] text-ink-soft">
              {open.length > 0 ? `${toPersianDigits(open.length)} مورد در صف` : "چیزی در صف نیست"}
              {snap.authRequired ? " · نیازمند ورود دوباره" : ""}
            </span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={exportJson} className="min-h-[40px] px-3 text-[12.5px] rounded-lg border border-border">خروجی JSON برای پشتیبانی</button>
            <button type="button" onClick={syncNow} disabled={busy || !snap.online} className="min-h-[40px] px-4 text-[12.5px] font-bold text-white bg-primary rounded-lg disabled:opacity-50">
              {busy || snap.syncing ? "در حال همگام‌سازی…" : "همگام‌سازی همین حالا"}
            </button>
          </div>
        </div>
      </Card>

      {items === null ? (
        <div className="text-[12.5px] text-muted text-center py-4">در حال بارگذاری…</div>
      ) : open.length === 0 ? (
        <div className="text-[12.5px] text-muted text-center py-4 bg-slate-50 rounded-xl border border-border">موردی در صف نیست — همه‌چیز همگام است</div>
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((it) => (
            <div key={it.id} className="bg-surface border border-border rounded-xl px-3.5 py-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold min-w-0 break-words">{it.label}</span>
                <Badge tone={STATUS[it.status].tone}>{STATUS[it.status].label}</Badge>
              </div>
              <div className="text-[11px] text-muted">ثبت در دستگاه: {formatJalaliDateTime(it.createdAtDevice)}{it.attempts > 0 ? ` · تلاش ${toPersianDigits(it.attempts)}` : ""}</div>
              {it.lastError ? <div className="text-[12px] text-danger break-words">{it.lastError}</div> : null}
              <div className="flex flex-wrap gap-2">
                {it.status === "conflict" ? <button type="button" className="min-h-[40px] px-3 text-[12.5px] rounded-lg bg-primary text-white font-bold" onClick={() => setConflict(it)}>حل تعارض</button> : null}
                {it.lastErrorCode === "OFFLINE_TOO_OLD" ? (
                  <button type="button" className="min-h-[40px] px-3 text-[12.5px] rounded-lg bg-primary text-white font-bold" onClick={async () => { await m?.engine.review(it.id); void syncNow(); }}>بازبینی و ارسال</button>
                ) : null}
                {it.status === "failed" && it.lastErrorCode !== "OFFLINE_TOO_OLD" ? (
                  <>
                    <button type="button" className="min-h-[40px] px-3 text-[12.5px] rounded-lg border border-border" onClick={() => setEditing({ item: it, text: JSON.stringify(it.body ?? {}, null, 2) })}>ویرایش و ارسال دوباره</button>
                    <button type="button" className="min-h-[40px] px-3 text-[12.5px] rounded-lg border border-border" onClick={async () => { await m?.engine.retry(it.id); void syncNow(); }}>تلاش دوباره</button>
                  </>
                ) : null}
                {it.status !== "syncing" ? <button type="button" className="min-h-[40px] px-3 text-[12.5px] rounded-lg border border-danger text-danger" onClick={() => discard(it)}>دور انداختن</button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 ? <div className="text-[11.5px] text-muted">{toPersianDigits(done.length)} مورد اخیراً همگام شد (تا ۲۴ ساعت نمایش داده می‌شود).</div> : null}

      {conflict ? <ConflictDialog item={conflict} onClose={() => setConflict(null)} onDone={() => { setConflict(null); reload(); }} /> : null}
      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="bg-surface rounded-2xl p-4 w-full max-w-[560px] flex flex-col gap-3">
            <div className="text-[14px] font-extrabold">ویرایش داده‌ی ثبت‌شده (JSON)</div>
            <textarea dir="ltr" className={clsx(inputCls, "min-h-[220px] font-mono")} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
            <div className="flex gap-2 justify-end">
              <button type="button" className="min-h-[40px] px-3 rounded-lg border border-border text-[13px]" onClick={() => setEditing(null)}>انصراف</button>
              <button
                type="button"
                className="min-h-[40px] px-4 rounded-lg bg-primary text-white text-[13px] font-bold"
                onClick={async () => {
                  try {
                    await m?.engine.editAndRetry(editing.item.id, JSON.parse(editing.text));
                    setEditing(null);
                    void syncNow();
                  } catch {
                    window.alert("JSON نامعتبر است");
                  }
                }}
              >
                ذخیره و ارسال
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function DiagTab() {
  const snap = useOfflineSnapshot();
  const [info, setInfo] = useState<Awaited<ReturnType<NonNullable<ReturnType<typeof getManager>>["usage"]>> | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(snap.persisted);
  const m = getManager();
  const load = useCallback(() => {
    void m?.usage().then(setInfo);
  }, [m]);
  useEffect(load, [load, snap.counts.pending, snap.lastSyncAt]);

  if (!m) return <Card className="p-4 text-[13px] text-muted">آفلاین فعال نیست.</Card>;
  const est = info?.estimate;
  const pct = est && est.quota > 0 ? Math.round((est.usage / est.quota) * 100) : null;
  const rows: Array<[string, string]> = [
    ["حافظه‌ی پایدار (persist)", persisted === null ? "نامشخص" : persisted ? "بله" : "خیر (مرورگر ممکن است در کمبود فضا پاک کند)"],
    ["سهمیه‌ی مرورگر", est ? `${mb(est.usage)} از ${mb(est.quota)}` : "نامشخص"],
    ["صف (رمزنگاری‌شده)", info ? `${toPersianDigits(info.usage.outboxCount)} مورد · ${mb(info.usage.outboxBytes + info.usage.blobBytes)}` : "…"],
    ["کش خواندنی", info ? `${toPersianDigits(info.usage.cacheCount)} مورد · ${mb(info.usage.cacheBytes)}` : "…"],
    ["آخرین همگام‌سازی", snap.lastSyncAt ? formatJalaliDateTime(new Date(snap.lastSyncAt).toISOString()) : "—"],
    ["آخرین دریافت فهرست‌ها", snap.lastLookupAt ? formatJalaliDateTime(new Date(snap.lastLookupAt).toISOString()) : "—"],
    ["Background Sync مرورگر", snap.swSyncSupported ? "پشتیبانی می‌شود" : "پشتیبانی نمی‌شود (همگام‌سازی هنگام آنلاین‌شدن/بازکردن برنامه)"],
    ["اختلاف ساعت دستگاه با سرور", snap.clockSkewMs === null ? "نامشخص" : `${toPersianDigits(Math.round(snap.clockSkewMs / 1000))} ثانیه`],
  ];

  return (
    <>
      {pct !== null && pct >= 80 ? <Card className="p-3 border-danger text-danger text-[13px] font-semibold">حافظه‌ی مرورگر به {toPersianDigits(pct)}٪ سهمیه رسیده؛ ابتدا همگام‌سازی کنید و داده‌ی آفلاین قدیمی را پاک کنید.</Card> : null}
      <Card className="p-4">
        {est ? (
          <div className="mb-3">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={clsx("h-full", (pct ?? 0) >= 80 ? "bg-danger" : "bg-primary")} style={{ width: `${Math.min(100, pct ?? 0)}%` }} /></div>
            <div className="text-[11px] text-muted mt-1">{toPersianDigits(pct ?? 0)}٪ استفاده</div>
          </div>
        ) : null}
        <dl className="flex flex-col gap-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 text-[12.5px]"><dt className="text-muted">{k}</dt><dd className="font-semibold text-end">{v}</dd></div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2 mt-4">
          {persisted === false ? <button type="button" className="min-h-[40px] px-3 rounded-lg border border-border text-[12.5px]" onClick={async () => setPersisted(await requestPersistence())}>درخواست حافظه‌ی پایدار</button> : null}
          <button type="button" className="min-h-[40px] px-3 rounded-lg border border-border text-[12.5px]" onClick={async () => { await m.refreshLookups(true); load(); }}>دریافت دوباره‌ی فهرست‌ها</button>
          <button type="button" className="min-h-[40px] px-3 rounded-lg border border-border text-[12.5px]" onClick={async () => { if (window.confirm("کش خواندنی پاک شود؟ صف ارسال دست‌نخورده می‌ماند.")) { await m.wipeOfflineData({ discardQueue: false }); load(); } }}>پاک‌سازی داده‌ی آفلاین (کش)</button>
          <button type="button" className="min-h-[40px] px-3 rounded-lg border border-danger text-danger text-[12.5px]" onClick={async () => { if (window.confirm("همه‌ی داده‌ی آفلاین از جمله موارد ارسال‌نشده برای همیشه پاک شود؟")) { await m.wipeOfflineData({ discardQueue: true }); load(); } }}>پاک‌سازی کامل (شامل صف)</button>
        </div>
      </Card>
    </>
  );
}

function PolicyTab() {
  const [policy, setPolicy] = useState<OfflinePolicy | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<OfflinePolicy>("/sync/policy").then(setPolicy).catch(() => setMsg("دریافت سیاست ناموفق بود"));
  }, []);
  if (!policy) return <div className="text-[12.5px] text-muted">{msg ?? "در حال بارگذاری…"}</div>;
  const toggle = (k: string) => setPolicy({ ...policy, enabledOperations: policy.enabledOperations.includes(k) ? policy.enabledOperations.filter((x) => x !== k) : [...policy.enabledOperations, k] });
  async function save() {
    try {
      const saved = await apiFetch<OfflinePolicy>("/sync/policy", { method: "PUT", body: JSON.stringify(policy) });
      setPolicy(saved);
      setMsg("ذخیره شد");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "ذخیره نشد");
    }
  }
  return (
    <Card className="p-4 flex flex-col gap-4">
      <div>
        <div className="text-[13px] font-bold mb-2">عملیات مجاز برای ثبت آفلاین</div>
        <div className="grid sm:grid-cols-2 gap-1">
          {OFFLINE_OPS.map((o) => (
            <label key={o.key} className="flex items-center gap-2 min-h-[40px] text-[12.5px] cursor-pointer">
              <input type="checkbox" checked={policy.enabledOperations.includes(o.key)} onChange={() => toggle(o.key)} className="w-4 h-4" />
              {o.label}
            </label>
          ))}
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-[12px]">حداکثر روز آفلاین<input type="number" inputMode="numeric" className={inputCls} value={policy.maxOfflineDays} onChange={(e) => setPolicy({ ...policy, maxOfflineDays: Number(e.target.value) })} /></label>
        <label className="text-[12px]">حداکثر حجم هر فایل (MB)<input type="number" inputMode="numeric" className={inputCls} value={policy.maxAttachmentMb} onChange={(e) => setPolicy({ ...policy, maxAttachmentMb: Number(e.target.value) })} /></label>
        <label className="text-[12px]">حداکثر حجم صف (MB)<input type="number" inputMode="numeric" className={inputCls} value={policy.maxQueueMb} onChange={(e) => setPolicy({ ...policy, maxQueueMb: Number(e.target.value) })} /></label>
      </div>
      <div>
        <div className="text-[12px] mb-1">نقش‌های مجاز (هیچ‌کدام = همه)</div>
        <div className="flex gap-3 flex-wrap">
          {[["OWNER", "مالک"], ["ADMIN", "مدیر"], ["MEMBER", "عضو"]].map(([r, l]) => (
            <label key={r} className="flex items-center gap-2 min-h-[40px] text-[12.5px]">
              <input type="checkbox" className="w-4 h-4" checked={policy.allowedRoles.includes(r)} onChange={() => setPolicy({ ...policy, allowedRoles: policy.allowedRoles.includes(r) ? policy.allowedRoles.filter((x) => x !== r) : [...policy.allowedRoles, r] })} />
              {l}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 min-h-[40px] text-[12.5px]">
        <input type="checkbox" className="w-4 h-4" checked={policy.wipeOnLogout} onChange={(e) => setPolicy({ ...policy, wipeOnLogout: e.target.checked })} />
        هنگام خروج، داده‌ی آفلاین و کلید رمز پاک شود (پیش‌فرض و توصیه‌شده؛ کاربر با موارد ارسال‌نشده فقط با انتخاب صریح می‌تواند «نگه‌داشتن» را بزند). کلید رمز در همان مرورگر است و جلوی XSS یا دسترسی DevTools را نمی‌گیرد؛ خروج با پاک‌سازی ریسک دستگاه مشترک را کم می‌کند.
      </label>
      <label className="flex items-center gap-2 min-h-[40px] text-[12.5px]">
        <input type="checkbox" className="w-4 h-4" checked={policy.allowReviewedBeyondMax} onChange={(e) => setPolicy({ ...policy, allowReviewedBeyondMax: e.target.checked })} />
        اجازه به مالک/مدیر برای ارسال مورد قدیمی‌تر از حداکثر روز آفلاین، با بازبینی صریح (سایر نقش‌ها باید دوباره آنلاین ثبت کنند)
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} className="min-h-[40px] px-5 rounded-lg bg-primary text-white text-[13px] font-bold">ذخیره‌ی سیاست</button>
        {msg ? <span className="text-[12.5px] text-muted">{msg}</span> : null}
      </div>
    </Card>
  );
}
