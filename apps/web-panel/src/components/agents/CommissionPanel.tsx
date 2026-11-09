"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import {
  AGENT_COMMISSION_STATUS_LABELS, AGENT_LEVEL_LABELS, AGENT_RULE_OCCURRENCE_LABELS, AGENT_TX_OCCURRENCE_LABELS,
  agentsCatalog, agentsCreatePlanRule, agentsEndPlanRule, agentsPlanRules, agentsSimulateRule, agentsTransactions, agentsUpsertCatalog,
  type AgentCatalogEntry, type AgentCommissionStatus, type AgentLevel, type AgentPlanRule, type AgentProduct, type AgentRuleOccurrence,
  type AgentTransactionRow, type AgentTxFilter, type AgentWallet, type AgentWalletEntry,
} from "@/lib/api";
import { btnDanger, btnGhost, btnPrimary, errMsg, Field, fa, fmtDate, fmtMoney, inputClass, Loading } from "./agent-ui";

const LEVELS = Object.keys(AGENT_LEVEL_LABELS) as AgentLevel[];
const OCCS = Object.keys(AGENT_RULE_OCCURRENCE_LABELS) as AgentRuleOccurrence[];

const statusTone: Record<AgentCommissionStatus, Tone> = { CREDITED: "success", NO_RULE: "warning", NOT_ATTRIBUTED: "neutral", AGENT_INACTIVE: "neutral", REVERSED: "danger", ZERO: "neutral" };

function nameOf(list: AgentCatalogEntry[], code: string | null, any: string) {
  if (!code) return any;
  const e = list.find((x) => x.code === code);
  return e && e.name !== code ? `${e.name} (${code})` : code;
}

// ─────────────────────────────────────────────────────────────────────────────
// قوانین پورسانت (ادمین): سطح × نوع تراکنش × قلم × اول/تمدید → درصد از مبلغ خالص
// ─────────────────────────────────────────────────────────────────────────────

export function PlanRulesEditor({ product, canEdit, onClose }: { product: AgentProduct; canEdit: boolean; onClose: () => void }) {
  const [rules, setRules] = useState<AgentPlanRule[] | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [cat, setCat] = useState<{ types: AgentCatalogEntry[]; items: AgentCatalogEntry[] }>({ types: [], items: [] });
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ level: "B" as AgentLevel, txTypeCode: "", itemCode: "", occurrence: "FIRST" as AgentRuleOccurrence, percent: "10", from: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    agentsPlanRules(product.id, showEnded).then(setRules).catch((e) => { setRules([]); setMsg(errMsg(e)); });
    agentsCatalog(product.id).then(setCat).catch(() => undefined);
  }, [product.id, showEnded]);
  useEffect(load, [load]);

  async function add() {
    setMsg(null);
    const percent = Number(form.percent.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return setMsg("درصد باید بین ۰ تا ۱۰۰ باشد");
    // تاریخ آینده = از ابتدای همان روز؛ خالی = از همین لحظه
    const effectiveFrom = form.from ? new Date(`${form.from}T00:00:00`).toISOString() : undefined;
    if (effectiveFrom && new Date(effectiveFrom).getTime() < Date.now()) return setMsg("تاریخ شروع باید امروز به بعد باشد؛ برای «از همین الان» خالی بگذارید");
    const same = (rules ?? []).find((r) => r.state !== "ENDED" && r.level === form.level && (r.txTypeCode ?? "") === form.txTypeCode.trim().toUpperCase() && (r.itemCode ?? "") === form.itemCode.trim() && r.occurrence === form.occurrence);
    if (same && !window.confirm(`برای همین ترکیب قانون ${fa(same.percent)}٪ فعال است. قانون جدید جایگزین آن می‌شود (فقط برای تراکنش‌های بعدی). ادامه؟`)) return;
    setBusy(true);
    try {
      await agentsCreatePlanRule(product.id, {
        level: form.level,
        txTypeCode: form.txTypeCode.trim() || undefined,
        itemCode: form.itemCode.trim() || undefined,
        occurrence: form.occurrence,
        percent,
        effectiveFrom,
        note: form.note.trim() || undefined,
      });
      setForm((f) => ({ ...f, note: "" }));
      load();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function end(r: AgentPlanRule) {
    if (!window.confirm(r.state === "SCHEDULED" ? "این قانون زمان‌بندی‌شده لغو شود؟" : "این قانون از همین لحظه پایان یابد؟ پورسانت‌های قبلی تغییری نمی‌کنند.")) return;
    try { await agentsEndPlanRule(product.id, r.id); load(); } catch (e) { setMsg(errMsg(e)); }
  }

  const byLevel = useMemo(() => {
    const m = new Map<AgentLevel, AgentPlanRule[]>();
    for (const l of LEVELS) m.set(l, []);
    for (const r of rules ?? []) m.get(r.level)?.push(r);
    for (const list of m.values()) list.sort((a, b) => b.specificity - a.specificity || a.occurrence.localeCompare(b.occurrence));
    return m;
  }, [rules]);

  return (
    <Modal title={`قوانین پورسانت — ${product.name}`} onClose={onClose} width="max-w-[880px]">
      <div className="flex flex-col gap-4">
        <div className="text-[12.5px] text-ink-soft leading-6 bg-slate-50 border border-border rounded-xl p-3">
          پورسانت = درصد از <b>مبلغ خالص</b> تراکنش (بعد از تخفیف، بدون مالیات). برای هر سطح، نوع تراکنش و قلم (مثلاً اشتراک CRM) جدا
          درصدِ «خرید اول» و «هر تمدید» بگذارید. اگر چند قانون به یک تراکنش بخورند، <b>خاص‌ترین</b> اعمال می‌شود (نوع › قلم › دفعه).
          تغییر یا پایان قانون فقط روی تراکنش‌های بعدی اثر دارد. پورسانت فقط وقتی ثبت می‌شود که عضویت نماینده در لحظه‌ی تراکنش فعال باشد و پس از
          مهلت نگهداری ({fa(product.holdDays)} روز) قابل تسویه می‌شود.
        </div>

        {canEdit ? (
          <Card className="p-3.5 flex flex-col gap-3">
            <div className="font-bold text-[13px]">قانون جدید</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Field label="سطح نماینده">
                <select className={inputClass} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as AgentLevel })}>
                  {LEVELS.map((l) => <option key={l} value={l}>{AGENT_LEVEL_LABELS[l]}</option>)}
                </select>
              </Field>
              <Field label="نوع تراکنش" hint="خالی = هر نوع">
                <input className={inputClass} dir="ltr" list="agent-tx-types" placeholder="SUBSCRIPTION" value={form.txTypeCode} onChange={(e) => setForm({ ...form, txTypeCode: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="قلم (مثلاً crm)" hint="خالی = هر قلم">
                <input className={inputClass} dir="ltr" list="agent-tx-items" placeholder="crm" value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} />
              </Field>
              <Field label="دفعه">
                <select className={inputClass} value={form.occurrence} onChange={(e) => setForm({ ...form, occurrence: e.target.value as AgentRuleOccurrence })}>
                  {OCCS.map((o) => <option key={o} value={o}>{AGENT_RULE_OCCURRENCE_LABELS[o]}</option>)}
                </select>
              </Field>
              <Field label="درصد پورسانت">
                <input className={inputClass} dir="ltr" inputMode="decimal" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
              </Field>
              <Field label="شروع اعتبار" hint="خالی = از همین الان">
                <JalaliDateInput value={form.from} onChange={(v) => setForm({ ...form, from: v })} placeholder="از همین الان" />
              </Field>
              <div className="col-span-2">
                <Field label="یادداشت (اختیاری)">
                  <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
                </Field>
              </div>
            </div>
            <datalist id="agent-tx-types">{cat.types.map((t) => <option key={t.id} value={t.code}>{t.name}</option>)}</datalist>
            <datalist id="agent-tx-items">{cat.items.map((t) => <option key={t.id} value={t.code}>{t.name}</option>)}</datalist>
            <div className="flex flex-wrap items-center gap-2">
              <button className={btnPrimary} disabled={busy} onClick={add}>{busy ? "در حال ثبت..." : "ثبت قانون"}</button>
              {msg ? <span className="text-[12px] text-danger">{msg}</span> : null}
            </div>
          </Card>
        ) : msg ? <div className="text-[12px] text-danger">{msg}</div> : null}

        <div className="flex items-center justify-between">
          <div className="font-bold text-[13px]">قوانین</div>
          <label className="flex items-center gap-1.5 text-[12px] text-muted cursor-pointer"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />نمایش قوانین پایان‌یافته</label>
        </div>
        {rules === null ? <Loading rows={rules} /> : (
          <div className="flex flex-col gap-3">
            {LEVELS.map((l) => {
              const list = byLevel.get(l) ?? [];
              return (
                <div key={l} className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-[12.5px] font-bold flex items-center justify-between">
                    <span>{AGENT_LEVEL_LABELS[l]}</span>
                    <span className="text-muted font-normal">{list.length ? `${fa(list.length)} قانون` : "بدون قانون — نمایندگان این سطح پورسانت نمی‌گیرند"}</span>
                  </div>
                  {list.map((r) => (
                    <div key={r.id} className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[12.5px] border-t border-border", r.state === "ENDED" && "opacity-55")}>
                      <span className="font-bold min-w-[140px]">{nameOf(cat.types, r.txTypeCode, "هر نوع تراکنش")}</span>
                      <span className="min-w-[110px]">{nameOf(cat.items, r.itemCode, "هر قلم")}</span>
                      <span className="min-w-[70px] text-ink-soft">{AGENT_RULE_OCCURRENCE_LABELS[r.occurrence]}</span>
                      <span className="font-extrabold text-primary min-w-[48px]">{fa(r.percent)}٪</span>
                      <span className="text-muted text-[11.5px]">از {fmtDate(r.effectiveFrom)}{r.endedAt ? ` تا ${fmtDate(r.endedAt)}` : ""}</span>
                      {r.state === "SCHEDULED" ? <Badge tone="warning">زمان‌بندی‌شده</Badge> : r.state === "ENDED" ? <Badge tone="neutral">پایان‌یافته</Badge> : null}
                      {r.note ? <span className="text-muted text-[11.5px] truncate max-w-[200px]" title={r.note}>{r.note}</span> : null}
                      {canEdit && r.state !== "ENDED" ? <button className={clsx(btnDanger, "ms-auto !min-h-[32px] !px-3 !text-[11.5px]")} onClick={() => end(r)}>{r.state === "SCHEDULED" ? "لغو" : "پایان"}</button> : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <RuleSimulator productId={product.id} types={cat.types} items={cat.items} />
        <CatalogEditor productId={product.id} cat={cat} canEdit={canEdit} onChanged={load} />
      </div>
    </Modal>
  );
}

function RuleSimulator({ productId, types, items }: { productId: string; types: AgentCatalogEntry[]; items: AgentCatalogEntry[] }) {
  const [q, setQ] = useState({ level: "B" as AgentLevel, txType: "SUBSCRIPTION", itemCode: "", occurrence: "FIRST", amount: "10000000" });
  const [res, setRes] = useState<{ rule: AgentPlanRule | null; commission: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setErr(null);
    try { setRes(await agentsSimulateRule(productId, { ...q, itemCode: q.itemCode || undefined, amount: Number(q.amount) || undefined })); } catch (e) { setErr(errMsg(e)); }
  }
  return (
    <details className="border border-border rounded-xl p-3">
      <summary className="cursor-pointer font-bold text-[13px]">آزمایش: اگر الان این تراکنش بیاید، چه پورسانتی؟</summary>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3 items-end">
        <Field label="سطح"><select className={inputClass} value={q.level} onChange={(e) => setQ({ ...q, level: e.target.value as AgentLevel })}>{LEVELS.map((l) => <option key={l} value={l}>{AGENT_LEVEL_LABELS[l]}</option>)}</select></Field>
        <Field label="نوع"><input className={inputClass} dir="ltr" list="agent-tx-types" value={q.txType} onChange={(e) => setQ({ ...q, txType: e.target.value.toUpperCase() })} /></Field>
        <Field label="قلم"><input className={inputClass} dir="ltr" list="agent-tx-items" value={q.itemCode} onChange={(e) => setQ({ ...q, itemCode: e.target.value })} /></Field>
        <Field label="دفعه"><select className={inputClass} value={q.occurrence} onChange={(e) => setQ({ ...q, occurrence: e.target.value })}><option value="FIRST">خرید اول</option><option value="RENEWAL">تمدید</option><option value="ONE_OFF">یک‌باره</option></select></Field>
        <Field label="مبلغ خالص"><input className={inputClass} dir="ltr" inputMode="numeric" value={q.amount} onChange={(e) => setQ({ ...q, amount: e.target.value.replace(/\D/g, "") })} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-2.5">
        <button className={btnGhost} onClick={run}>محاسبه</button>
        {err ? <span className="text-[12px] text-danger">{err}</span> : null}
        {res ? (
          res.rule ? (
            <span className="text-[12.5px]">قانون: <b>{nameOf(types, res.rule.txTypeCode, "هر نوع")}</b> / <b>{nameOf(items, res.rule.itemCode, "هر قلم")}</b> / {AGENT_RULE_OCCURRENCE_LABELS[res.rule.occurrence]} — <b className="text-primary">{fa(res.rule.percent)}٪</b> = <b className="text-success">{fmtMoney(res.commission)}</b></span>
          ) : <span className="text-[12.5px] text-warning">هیچ قانونی تطبیق ندارد — پورسانتی ثبت نمی‌شود.</span>
        ) : null}
      </div>
    </details>
  );
}

function CatalogEditor({ productId, cat, canEdit, onChanged }: { productId: string; cat: { types: AgentCatalogEntry[]; items: AgentCatalogEntry[] }; canEdit: boolean; onChanged: () => void }) {
  const [kind, setKind] = useState<"types" | "items">("types");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function save(c = code, n = name) {
    setErr(null);
    try { await agentsUpsertCatalog(productId, kind, { code: c.trim(), name: n.trim() || undefined }); setCode(""); setName(""); onChanged(); } catch (e) { setErr(errMsg(e)); }
  }
  const list = kind === "types" ? cat.types : cat.items;
  return (
    <details className="border border-border rounded-xl p-3">
      <summary className="cursor-pointer font-bold text-[13px]">انواع تراکنش و اقلام این محصول ({fa(cat.types.length)} نوع، {fa(cat.items.length)} قلم)</summary>
      <div className="text-[12px] text-muted mt-2 leading-5">با اولین تراکنشی که محصول از طریق API بفرستد، کدها خودکار اینجا اضافه می‌شوند. می‌توانید پیش از آن هم کد را تعریف کنید تا قانونش آماده باشد، و برای هر کد نام فارسی بگذارید.</div>
      <div className="flex gap-2 mt-2.5">
        {(["types", "items"] as const).map((k) => <button key={k} className={clsx(k === kind ? btnPrimary : btnGhost, "!min-h-[34px]")} onClick={() => setKind(k)}>{k === "types" ? "انواع تراکنش" : "اقلام"}</button>)}
      </div>
      <div className="flex flex-col gap-1 mt-2.5">
        {list.map((e) => (
          <div key={e.id} className="flex items-center gap-2 text-[12.5px] border-b border-border py-1.5">
            <code className="font-mono min-w-[140px]" dir="ltr">{e.code}</code>
            {canEdit ? (
              <input className={clsx(inputClass, "!py-1.5")} defaultValue={e.name} onBlur={(ev) => ev.target.value.trim() !== e.name && agentsUpsertCatalog(productId, kind, { code: e.code, name: ev.target.value }).then(onChanged).catch((x) => setErr(errMsg(x)))} />
            ) : <span>{e.name}</span>}
          </div>
        ))}
        {!list.length ? <div className="text-[12px] text-muted py-2">هنوز کدی ثبت نشده.</div> : null}
      </div>
      {canEdit ? (
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-2.5 items-end">
          <Field label="کد"><input className={inputClass} dir="ltr" value={code} onChange={(e) => setCode(kind === "types" ? e.target.value.toUpperCase() : e.target.value)} placeholder={kind === "types" ? "MODULE" : "hr"} /></Field>
          <Field label="نام فارسی"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "types" ? "خرید ماژول" : "منابع انسانی"} /></Field>
          <button className={btnGhost} disabled={code.trim().length < 2} onClick={() => save()}>افزودن</button>
        </div>
      ) : null}
      {err ? <div className="text-[12px] text-danger mt-1.5">{err}</div> : null}
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// دفتر مرکزی تراکنش‌ها (ادمین)
// ─────────────────────────────────────────────────────────────────────────────

export function TransactionsPanel({ products }: { products: AgentProduct[] }) {
  const [f, setF] = useState<AgentTxFilter>({});
  const [rows, setRows] = useState<AgentTransactionRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [totals, setTotals] = useState<{ byOccurrence: Array<{ occurrence: string; count: number; net: number }>; commission: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback((cursor?: string) => {
    agentsTransactions({ ...f, cursor })
      .then((r) => { setErr(null); setRows((prev) => (cursor ? [...(prev ?? []), ...r.items] : r.items)); setNext(r.nextCursor); if (!cursor) setTotals(r.totals); })
      .catch((e) => { setErr(errMsg(e)); setRows([]); });
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? "—";
  const netSales = (totals?.byOccurrence ?? []).filter((t) => t.occurrence !== "REFUND").reduce((a, t) => a + t.net, 0);
  const refunds = (totals?.byOccurrence ?? []).find((t) => t.occurrence === "REFUND")?.net ?? 0;
  const count = (totals?.byOccurrence ?? []).reduce((a, t) => a + t.count, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12.5px] text-ink-soft">همه‌ی تراکنش‌هایی که محصولات از طریق API فرستاده‌اند — چه مشتری نماینده داشته باشد چه نه — با وضعیت پورسانت هر کدام.</div>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
        <Field label="محصول"><select className={inputClass} value={f.productId ?? ""} onChange={(e) => setF({ ...f, productId: e.target.value || undefined })}><option value="">همه</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="وضعیت پورسانت"><select className={inputClass} value={f.commissionStatus ?? ""} onChange={(e) => setF({ ...f, commissionStatus: e.target.value || undefined })}><option value="">همه</option>{(Object.keys(AGENT_COMMISSION_STATUS_LABELS) as AgentCommissionStatus[]).map((s) => <option key={s} value={s}>{AGENT_COMMISSION_STATUS_LABELS[s]}</option>)}</select></Field>
        <Field label="دفعه"><select className={inputClass} value={f.occurrence ?? ""} onChange={(e) => setF({ ...f, occurrence: e.target.value || undefined })}><option value="">همه</option>{Object.entries(AGENT_TX_OCCURRENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="از تاریخ"><JalaliDateInput value={f.from?.slice(0, 10) ?? ""} onChange={(v) => setF({ ...f, from: v ? new Date(`${v}T00:00:00`).toISOString() : undefined })} placeholder="—" /></Field>
        <Field label="تا تاریخ"><JalaliDateInput value={f.to?.slice(0, 10) ?? ""} onChange={(v) => setF({ ...f, to: v ? new Date(`${v}T23:59:59`).toISOString() : undefined })} placeholder="—" /></Field>
        <Field label="جستجو"><input className={inputClass} placeholder="شناسه/مشتری/قلم" value={f.q ?? ""} onChange={(e) => setF({ ...f, q: e.target.value || undefined })} /></Field>
      </div>
      {totals ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="تعداد تراکنش" value={fa(count)} />
          <Stat label="فروش خالص" value={fmtMoney(netSales)} />
          <Stat label="بازپرداخت" value={fmtMoney(refunds)} tone="danger" />
          <Stat label="پورسانت نمایندگان" value={fmtMoney(totals.commission)} tone="success" />
        </div>
      ) : null}
      {err ? <div className="text-[12px] text-danger">{err}</div> : null}
      {rows === null ? <Loading rows={rows} /> : !rows.length ? <div className="text-[12.5px] text-muted py-6 text-center">تراکنشی ثبت نشده است.</div> : (
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-[12px] min-w-[860px]">
            <thead className="bg-slate-50 text-ink-soft"><tr>{["تاریخ", "محصول", "نوع / قلم", "دفعه", "مشتری", "مبلغ خالص", "نماینده", "پورسانت", "وضعیت"].map((h) => <th key={h} className="text-start font-bold px-2.5 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const sum = r.commissions.reduce((a, c) => a + c.amount, 0);
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-2.5 py-2 whitespace-nowrap">{fmtDate(r.paidAt)}</td>
                    <td className="px-2.5 py-2">{pname(r.productId)}</td>
                    <td className="px-2.5 py-2"><span dir="ltr" className="font-mono">{r.txTypeCode}</span>{r.itemCode ? <div className="text-muted">{r.itemName ?? r.itemCode}</div> : null}</td>
                    <td className="px-2.5 py-2">{AGENT_TX_OCCURRENCE_LABELS[r.occurrence]}</td>
                    <td className="px-2.5 py-2">{r.customerName ?? <span className="text-muted font-mono" dir="ltr">{r.externalCustomerId}</span>}</td>
                    <td className={clsx("px-2.5 py-2 whitespace-nowrap font-bold", r.occurrence === "REFUND" && "text-danger")}>{r.occurrence === "REFUND" ? "−" : ""}{fmtMoney(r.netAmount)}</td>
                    <td className="px-2.5 py-2">{r.agentName ?? "—"}{r.membershipLevel ? <div className="text-muted">{AGENT_LEVEL_LABELS[r.membershipLevel]}</div> : null}</td>
                    <td className={clsx("px-2.5 py-2 whitespace-nowrap font-bold", sum > 0 ? "text-success" : sum < 0 ? "text-danger" : "text-muted")}>{sum ? `${fmtMoney(Math.abs(sum))}${sum < 0 ? " −" : ""}` : "—"}{r.commissions[0] ? <div className="text-muted font-normal">{fa(r.commissions[0].percent)}٪</div> : null}</td>
                    <td className="px-2.5 py-2"><Badge tone={statusTone[r.commissionStatus]}>{AGENT_COMMISSION_STATUS_LABELS[r.commissionStatus]}</Badge>{r.commissionNote ? <div className="text-muted mt-1 max-w-[180px]">{r.commissionNote}</div> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {next ? <button className={clsx(btnGhost, "self-center")} onClick={() => load(next)}>بیشتر</button> : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "danger" }) {
  return (
    <Card className="p-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={clsx("text-[15px] font-extrabold mt-1", tone === "success" && "text-success", tone === "danger" && "text-danger")}>{value}</div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// کیف پول (ادمین و خودِ نماینده): سبز = پورسانت، قرمز = برگشت
// ─────────────────────────────────────────────────────────────────────────────

export function WalletView({ fetchPage, minSettlement }: { fetchPage: (cursor?: string) => Promise<AgentWallet>; minSettlement?: number }) {
  const [w, setW] = useState<AgentWallet | null>(null);
  const [entries, setEntries] = useState<AgentWalletEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const load = useCallback((cursor?: string) => {
    fetchPage(cursor)
      .then((r) => { setW(r); setEntries((prev) => (cursor ? [...prev, ...r.entries] : r.entries)); })
      .catch((e) => setErr(errMsg(e)));
  }, [fetchPage]);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="text-[12px] text-danger">{err}</div>;
  if (!w) return <Loading rows={null} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="قابل تسویه" value={fmtMoney(w.balances.withdrawable)} tone={w.balances.withdrawable < 0 ? "danger" : "success"} />
        <Stat label="در انتظار (مهلت نگهداری)" value={fmtMoney(w.balances.held)} />
        <Stat label="در جریان تسویه" value={fmtMoney(w.balances.pending)} />
        <Stat label="تسویه‌شده" value={fmtMoney(w.balances.paid)} />
        <Stat label="کل پورسانت" value={fmtMoney(w.balances.totalEarned)} />
      </div>
      {typeof minSettlement === "number" ? <div className="text-[11.5px] text-muted">حداقل مبلغ درخواست تسویه: {fmtMoney(minSettlement)}</div> : null}
      {!entries.length ? <div className="text-[12.5px] text-muted py-4 text-center">هنوز پورسانتی ثبت نشده است.</div> : (
        <div className="flex flex-col gap-1.5">
          {entries.map((e) => {
            const credit = e.amount >= 0;
            const held = credit && new Date(e.availableAt).getTime() > now;
            return (
              <div key={e.id} className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2.5 text-[12.5px]", credit ? "border-success/25 bg-success-soft/40" : "border-danger/25 bg-danger-soft/40")}>
                <span className={clsx("font-extrabold min-w-[110px]", credit ? "text-success" : "text-danger")}>{credit ? "+" : "−"}{fmtMoney(Math.abs(e.amount))}</span>
                <span className="text-ink-soft">{credit ? "پورسانت" : "برگشت بابت بازپرداخت"} · {AGENT_TX_OCCURRENCE_LABELS[e.transaction.occurrence]} · {e.transaction.itemName ?? e.transaction.itemCode ?? e.transaction.txTypeCode} · {fa(e.percent)}٪ از {fmtMoney(e.transaction.netAmount)}</span>
                {e.customerName ? <span className="text-muted">{e.customerName}</span> : null}
                <span className="text-muted ms-auto text-[11.5px]">{fmtDate(e.createdAt)}{held ? ` · قابل تسویه از ${fmtDate(e.availableAt)}` : ""}</span>
              </div>
            );
          })}
        </div>
      )}
      {w.nextCursor ? <button className={clsx(btnGhost, "self-center")} onClick={() => load(w.nextCursor!)}>بیشتر</button> : null}
    </div>
  );
}
