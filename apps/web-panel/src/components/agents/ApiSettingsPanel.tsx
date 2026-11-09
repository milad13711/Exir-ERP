"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  agentsApiInfo, agentsCreateKey, agentsEventLogs, agentsListKeys, agentsListProducts, agentsRevokeKey, agentsRotateKey, agentsTestEvent,
  type AgentApiKey, type AgentApiKeyCreated, type AgentEventLog, type AgentProduct,
} from "@/lib/api";
import { btnDanger, btnGhost, btnPrimary, CopyButton, errMsg, Field, fa, fmtDate, inputClass, Loading, TabBar } from "./agent-ui";

type Tab = "keys" | "docs" | "logs";

function curlExample(base: string, type: "events" | "validate" | "health") {
  const sign = `TS=$(date +%s)\nBODY='{"eventId":"evt-1001","type":"customer.registered","data":{"referralCode":"ALI-01","externalCustomerId":"user_42","name":"علی رضایی","phone":"09121234567"}}'\nSIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$EXIR_SIGNING_SECRET" -hex | sed 's/^.* //')`;
  if (type === "health") return `TS=$(date +%s)\nSIG=$(printf '%s.' "$TS" | openssl dgst -sha256 -hmac "$EXIR_SIGNING_SECRET" -hex | sed 's/^.* //')\ncurl ${base}/health \\\n  -H "Authorization: Bearer $EXIR_API_KEY" -H "X-Exir-Timestamp: $TS" -H "X-Exir-Signature: $SIG"`;
  if (type === "validate") return `TS=$(date +%s)\nSIG=$(printf '%s.' "$TS" | openssl dgst -sha256 -hmac "$EXIR_SIGNING_SECRET" -hex | sed 's/^.* //')\ncurl ${base}/referral-codes/ALI-01/validate \\\n  -H "Authorization: Bearer $EXIR_API_KEY" -H "X-Exir-Timestamp: $TS" -H "X-Exir-Signature: $SIG"`;
  return `${sign}\ncurl -X POST ${base}/events \\\n  -H "Authorization: Bearer $EXIR_API_KEY" -H "Content-Type: application/json" \\\n  -H "X-Exir-Timestamp: $TS" -H "X-Exir-Signature: $SIG" \\\n  -d "$BODY"`;
}

const NODE_EXAMPLE = (base: string) => `import crypto from "node:crypto";
const ts = Math.floor(Date.now() / 1000).toString();
// هر پرداخت (چه مشتری نماینده داشته باشد چه نه) → دفتر مرکزی + پورسانت. مبنا: مبلغ خالص (ناخالص − تخفیف، بدون مالیات)
const body = JSON.stringify({ eventId: "evt-1002", type: "transaction.recorded", data: {
  transactionId: "INV-2026-1187", externalCustomerId: "user_42", txType: "SUBSCRIPTION", itemCode: "crm", itemName: "اشتراک CRM",
  grossAmount: 10000000, discountAmount: 2000000, taxAmount: 720000, currency: "IRT",
  paidAt: new Date().toISOString(), periodEnd: "2027-11-09T00:00:00Z" } });
// بازپرداخت: همان نوع رویداد با refundOf: "INV-2026-1187" و مبلغ برگشتی
const sig = crypto.createHmac("sha256", process.env.EXIR_SIGNING_SECRET).update(ts + "." + body).digest("hex");
await fetch("${base}/events", { method: "POST", body, headers: {
  Authorization: "Bearer " + process.env.EXIR_API_KEY, "Content-Type": "application/json",
  "X-Exir-Timestamp": ts, "X-Exir-Signature": sig } });`;

const OPENAPI = (base: string) => `openapi: 3.0.3
info: { title: Exir Agents Inbound API, version: "1" }
servers: [{ url: ${base} }]
security: [{ bearer: [] }]
components:
  securitySchemes: { bearer: { type: http, scheme: bearer } }
paths:
  /health: { get: { summary: بررسی اتصال و امضا } }
  /referral-codes/{code}/validate: { get: { summary: اعتبار کد معرف در همین محصول } }
  /events:
    post:
      summary: دریافت رویداد (ایدمپوتنت با eventId)
      description: types = customer.registered | transaction.recorded | subscription.activated | subscription.renewed | subscription.cancelled | payment.refunded
      parameters:
        - { in: header, name: X-Exir-Timestamp, required: true, schema: { type: string } }
        - { in: header, name: X-Exir-Signature, required: true, schema: { type: string } }
      responses: { "202": { description: پذیرفته }, "200": { description: تکراری }, "400": { description: ساختار نامعتبر }, "401": { description: کلید/امضا }, "422": { description: رد دامنه‌ای }, "429": { description: سقف نرخ } }`;

export function ApiSettingsPanel() {
  const [products, setProducts] = useState<AgentProduct[] | null>(null);
  const [pid, setPid] = useState("");
  const [base, setBase] = useState("");
  const [tab, setTab] = useState<Tab>("keys");
  useEffect(() => {
    agentsListProducts().then((r) => { setProducts(r); if (r[0]) setPid(r[0].id); }).catch(() => setProducts([]));
    agentsApiInfo().then((i) => setBase(i.baseUrl)).catch(() => undefined);
  }, []);
  if (!products) return <Loading rows={null} />;
  if (!products.length) return <Card className="p-6 text-sm text-muted text-center">ابتدا یک محصول در صفحه‌ی نمایندگی ثبت کنید.</Card>;
  const product = products.find((p) => p.id === pid);
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 flex flex-col gap-2">
        <Field label="محصول"><select className={`${inputClass} sm:max-w-[320px]`} value={pid} onChange={(e) => setPid(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <div className="flex items-center gap-2 flex-wrap text-[12.5px]">نشانی پایه‌ی API: <b dir="ltr" className="font-mono break-all">{base || "…"}</b>{base ? <CopyButton text={base} /> : null}</div>
      </Card>
      <TabBar value={tab} onChange={setTab} tabs={[{ id: "keys", label: "کلیدها و آزمایش" }, { id: "docs", label: "مستندات و نمونه‌کد" }, { id: "logs", label: "لاگ رویدادها" }]} />
      {product && tab === "keys" ? <KeysTab product={product} /> : null}
      {tab === "docs" ? <DocsTab base={base} /> : null}
      {tab === "logs" ? <LogsTab products={products} defaultProduct={pid} /> : null}
    </div>
  );
}

function KeysTab({ product }: { product: AgentProduct }) {
  const [keys, setKeys] = useState<AgentApiKey[] | null>(null);
  const [created, setCreated] = useState<AgentApiKeyCreated | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<Awaited<ReturnType<typeof agentsTestEvent>> | null>(null);
  const [code, setCode] = useState("");
  const load = useCallback(() => { agentsListKeys(product.id).then(setKeys).catch(() => setKeys([])); }, [product.id]);
  // تعویض محصول: کلید تازه‌ساخته و نتیجه‌ی تست قبلی پاک می‌شود (الگوی «تنظیم state هنگام تغییر prop» بدون effect)
  const [shownFor, setShownFor] = useState(product.id);
  if (shownFor !== product.id) { setShownFor(product.id); setCreated(null); setTest(null); }
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<AgentApiKeyCreated | AgentApiKey>) {
    setBusy(true); setErr(null);
    try { const r = await fn(); if ("apiKey" in r) setCreated(r); load(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col gap-4">
      {created ? (
        <Card className="p-4 border-warning/40 bg-warning-soft flex flex-col gap-2">
          <div className="text-[13px] font-extrabold">کلید جدید — فقط همین یک‌بار نمایش داده می‌شود</div>
          <div className="text-[12px]">کلید API: <b dir="ltr" className="font-mono break-all">{created.apiKey}</b> <CopyButton text={created.apiKey} /></div>
          <div className="text-[12px]">رمز امضا (HMAC): <b dir="ltr" className="font-mono break-all">{created.signingSecret}</b> <CopyButton text={created.signingSecret} /></div>
          <button className={btnGhost + " self-start"} onClick={() => setCreated(null)}>ذخیره کردم، بستن</button>
        </Card>
      ) : null}
      <Card className="p-4 flex flex-col gap-3">
        <div className="text-[13px] font-bold">کلیدهای API</div>
        {!keys?.length ? <Loading rows={keys} /> : keys.map((k) => (
          <div key={k.id} className="border border-border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between text-[12.5px]">
            <div className="min-w-0"><div className="font-bold">{k.name} <Badge tone={k.status === "ACTIVE" ? "success" : "neutral"}>{k.status === "ACTIVE" ? "فعال" : "باطل"}</Badge></div>
              <div className="font-mono text-muted" dir="ltr">{k.maskedKey}</div>
              <div className="text-muted text-[11.5px]">آخرین مصرف: {fmtDate(k.lastUsedAt)}{k.lastUsedIp ? ` از ${k.lastUsedIp}` : ""} · سقف {fa(k.maxPerMinute)} در دقیقه · ساخت {fmtDate(k.createdAt)}</div></div>
            {k.status === "ACTIVE" ? (
              <div className="flex gap-2 shrink-0">
                <button className={btnGhost} disabled={busy} onClick={() => window.confirm("کلید فعلی فوراً باطل و کلید تازه ساخته شود؟") && void act(() => agentsRotateKey(product.id, k.id))}>چرخش</button>
                <button className={btnDanger} disabled={busy} onClick={() => window.confirm("کلید باطل شود؟") && void act(() => agentsRevokeKey(product.id, k.id))}>ابطال</button>
              </div>
            ) : null}
          </div>
        ))}
        <div className="flex gap-2 items-end flex-wrap">
          <Field label="نام کلید جدید"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="سرور اصلی" /></Field>
          <button className={btnPrimary} disabled={busy || name.trim().length < 2} onClick={() => void act(() => agentsCreateKey(product.id, { name: name.trim() }).then((r) => { setName(""); return r; }))}>ساخت کلید</button>
        </div>
        {err ? <div className="text-[12px] text-danger">{err}</div> : null}
      </Card>
      <Card className="p-4 flex flex-col gap-2.5">
        <div className="text-[13px] font-bold">ارسال رویداد آزمایشی</div>
        <div className="text-[12px] text-muted">زنجیره‌ی ثبت‌نام ← فعال‌سازی ← تمدید ← بازپرداخت ← لغو روی یک مشتریِ ساختگی اجرا و در پایان کاملاً برگردانده می‌شود (هیچ اثری نمی‌ماند). کد معرف خالی = اولین عضویت فعال دارای کد.</div>
        <div className="flex gap-2 flex-wrap items-end">
          <Field label="کد معرف (اختیاری)"><input className={`${inputClass} font-mono`} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></Field>
          <button className={btnPrimary} disabled={busy} onClick={async () => { setBusy(true); try { setTest(await agentsTestEvent(product.id, code.trim() || undefined)); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>ارسال رویداد آزمایشی</button>
        </div>
        {test ? <ul className="text-[12.5px] flex flex-col gap-1">{test.steps.map((s, i) => <li key={i}><Badge tone={s.ok ? "success" : "danger"}>{s.ok ? "موفق" : "ناموفق"}</Badge> <span dir="ltr" className="font-mono">{s.type}</span> {s.message ? `— ${s.message}` : ""}</li>)}</ul> : null}
      </Card>
    </div>
  );
}

function DocsTab({ base }: { base: string }) {
  const blocks: Array<[string, string]> = [
    ["بررسی اتصال (GET /health)", curlExample(base, "health")],
    ["اعتبارسنجی کد معرف", curlExample(base, "validate")],
    ["ارسال رویداد ثبت‌نام (curl)", curlExample(base, "events")],
    ["ارسال رویداد اشتراک (Node.js)", NODE_EXAMPLE(base)],
    ["OpenAPI (خلاصه)", OPENAPI(base)],
  ];
  return (
    <div className="flex flex-col gap-3">
      <Card className="p-4 text-[12.5px] leading-7 text-ink-soft">
        احراز: هدر <b dir="ltr">Authorization: Bearer exir_agent_…</b>. امضا: <b dir="ltr">X-Exir-Signature</b> = HMAC-SHA256(رمز امضا، <span dir="ltr">{`timestamp + "." + `}بدنه‌ی خام</span>) به‌صورت hex و <b dir="ltr">X-Exir-Timestamp</b> ثانیه‌ی یونیکس (حداکثر ۵ دقیقه اختلاف). تکرار با همان <b dir="ltr">eventId</b> بی‌اثر و با پاسخ ۲۰۰ است. مبلغ‌ها عدد صحیح با ارز IRT یا IRR. حداکثر حجم بدنه ۳۲ کیلوبایت. خطاها: ۴۰۰ ساختار، ۴۰۱ کلید/امضا، ۴۲۲ رد دامنه‌ای (کد معرف نامعتبر، خود-معرفی، …)، ۴۲۹ سقف نرخ.
      </Card>
      {blocks.map(([t, code]) => (
        <Card key={t} className="p-4 flex flex-col gap-2"><div className="flex items-center justify-between"><b className="text-[13px]">{t}</b><CopyButton text={code} /></div><pre dir="ltr" className="text-[11.5px] bg-slate-50 rounded-xl p-3 overflow-x-auto whitespace-pre text-left">{code}</pre></Card>
      ))}
    </div>
  );
}

function LogsTab({ products, defaultProduct }: { products: AgentProduct[]; defaultProduct: string }) {
  const [rows, setRows] = useState<AgentEventLog[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [productId, setProductId] = useState(defaultProduct);
  const [status, setStatus] = useState(""); const [type, setType] = useState(""); const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const load = useCallback((more = false, cur?: string | null) => {
    agentsEventLogs({ productId, status, type, q: q.trim(), from, to, cursor: more ? cur ?? undefined : undefined })
      .then((r) => { setRows((p) => (more ? [...(p ?? []), ...r.items] : r.items)); setCursor(r.nextCursor); }).catch(() => setRows([]));
  }, [productId, status, type, q, from, to]);
  useEffect(() => { const t = setTimeout(() => load(), 250); return () => clearTimeout(t); }, [load]);
  const tone = (s: string) => (s === "ACCEPTED" ? "success" : s === "DUPLICATE" || s === "IGNORED" ? "neutral" : s === "REJECTED" ? "warning" : "danger");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">همه‌ی محصولات</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه‌ی وضعیت‌ها</option>{["ACCEPTED", "DUPLICATE", "IGNORED", "REJECTED", "ERROR"].map((s) => <option key={s}>{s}</option>)}</select>
        <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}><option value="">همه‌ی انواع</option>{["customer.registered", "transaction.recorded", "subscription.activated", "subscription.renewed", "subscription.cancelled", "payment.refunded", "test.sequence"].map((s) => <option key={s}>{s}</option>)}</select>
        <input className={inputClass} placeholder="eventId / پیام / کد خطا" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className={inputClass} type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className={inputClass} type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {!rows?.length ? <Loading rows={rows} /> : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.id} className="border border-border rounded-xl p-2.5 text-[12px] grid sm:grid-cols-[auto_1fr_auto] gap-2 items-center">
              <Badge tone={tone(r.status)}>{r.status}</Badge>
              <div className="min-w-0"><span dir="ltr" className="font-mono">{r.type ?? "—"}</span> <span className="text-muted" dir="ltr">{r.clientEventId ?? ""}</span><div className="text-muted truncate">{r.errorCode ? `${r.errorCode} — ` : ""}{r.message ?? ""}</div></div>
              <div className="text-muted text-[11px]" dir="ltr">{fmtDate(r.createdAt)} · {r.httpStatus} · {r.ip ?? ""}</div>
            </div>
          ))}
          {cursor ? <button className={btnGhost} onClick={() => load(true, cursor)}>نمایش بیشتر</button> : null}
        </div>
      )}
    </div>
  );
}
