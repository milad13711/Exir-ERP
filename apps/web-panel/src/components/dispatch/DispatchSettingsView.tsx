"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { toPersianDigits } from "@/lib/persian";
import {
  createDocRule,
  createDocType,
  deleteDocRule,
  fetchDispatchLookups,
  fetchDispatchSettings,
  fetchDocRules,
  fetchDocTypes,
  saveDispatchSettings,
  updateDocRule,
  updateDocType,
  type DispatchDocType,
  type DispatchRule,
  type DispatchSettings,
  type StepAccess,
} from "@/lib/dispatch-api";
import { BTN_DANGER, BTN_PRIMARY, BTN_SOFT, INPUT, LABEL, Section, errText } from "./dispatch-ui";

type Lookups = { roles: Array<{ id: string; name: string }>; users: Array<{ id: string; name: string }> };

const STEP_LABELS: Array<[keyof DispatchSettings["steps"], string, string]> = [
  ["arrival", "ثبت رسیدن ماشین", "خالی = هر کاربرِ دارای ویرایش در ماژول"],
  ["cleanliness", "تأیید نظافت ماشین", "خالی = هر کاربرِ دارای ویرایش"],
  ["weighing", "ثبت وزن خالی و پر (باسکول)", "خالی = هر کاربرِ دارای ویرایش"],
  ["loading", "بارگیری، ثبت حرکت و تحویل", "خالی = هر کاربرِ دارای ویرایش"],
  ["finalCheck", "کنترل نهایی (نفر دوم)", "خالی = هر کاربرِ دارای ویرایش؛ همیشه باید غیر از بارگیرنده باشد"],
  ["weightConfirm", "تأیید وزن نهایی برای فاکتور", "خالی = هر کاربرِ دارای ویرایش"],
  ["readyToDepart", "صدور «آماده حرکت»", "علاوه بر مسئول وظیفه‌ی اسناد و مدیر؛ خالی = فقط آن‌ها"],
];

function AccessPicker({ value, onChange, lookups }: { value: StepAccess; onChange: (v: StepAccess) => void; lookups: Lookups }) {
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {lookups.roles.map((r) => (
          <button
            type="button"
            key={r.id}
            onClick={() => onChange({ ...value, roleIds: toggle(value.roleIds, r.id) })}
            className={`text-[11.5px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${value.roleIds.includes(r.id) ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}
          >
            {r.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {value.userIds.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 bg-primary-soft text-primary text-[11.5px] font-bold px-2.5 py-1 rounded-lg">
            {lookups.users.find((u) => u.id === id)?.name ?? "کاربر"}
            <button type="button" onClick={() => onChange({ ...value, userIds: value.userIds.filter((x) => x !== id) })} className="cursor-pointer" aria-label="حذف">×</button>
          </span>
        ))}
        <select value="" onChange={(e) => e.target.value && onChange({ ...value, userIds: [...value.userIds, e.target.value] })} className="text-[12px] bg-white border border-border rounded-lg px-2 py-1.5">
          <option value="">+ افزودن کاربر مشخص</option>
          {lookups.users.filter((u) => !value.userIds.includes(u.id)).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

type RuleForm = { id?: string; name: string; isActive: boolean; minNetKg: string; cargoTypes: string; regions: string; docTypeCodes: string[]; handlerKind: "ROLE" | "USER"; handlerRoleId: string; handlerUserId: string };
const emptyRule: RuleForm = { name: "", isActive: true, minNetKg: "10000", cargoTypes: "", regions: "", docTypeCodes: [], handlerKind: "ROLE", handlerRoleId: "", handlerUserId: "" };

export function DispatchSettingsView() {
  const [s, setS] = useState<DispatchSettings | null>(null);
  const [lookups, setLookups] = useState<Lookups>({ roles: [], users: [] });
  const [types, setTypes] = useState<DispatchDocType[]>([]);
  const [rules, setRules] = useState<DispatchRule[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState("");
  const [rule, setRule] = useState<RuleForm | null>(null);

  const loadAll = useCallback(() => {
    Promise.all([fetchDispatchSettings(), fetchDispatchLookups(), fetchDocTypes(), fetchDocRules()])
      .then(([a, b, c, d]) => {
        setS(a);
        setLookups(b);
        setTypes(c);
        setRules(d);
      })
      .catch((e) => setErr(errText(e, "بارگذاری ناموفق بود")));
  }, []);
  useEffect(loadAll, [loadAll]);

  async function save() {
    if (!s) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      setS(await saveDispatchSettings(s));
      setMsg("تنظیمات ذخیره شد");
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    if (!rule) return;
    const body = {
      name: rule.name.trim(),
      isActive: rule.isActive,
      minNetKg: rule.minNetKg.trim() === "" ? null : Number(rule.minNetKg),
      cargoTypes: rule.cargoTypes.split(/[،,\n]/).map((x) => x.trim()).filter(Boolean),
      regions: rule.regions.split(/[،,\n]/).map((x) => x.trim()).filter(Boolean),
      docTypeCodes: rule.docTypeCodes,
      handlerRoleId: rule.handlerKind === "ROLE" && rule.handlerRoleId ? rule.handlerRoleId : null,
      handlerUserId: rule.handlerKind === "USER" && rule.handlerUserId ? rule.handlerUserId : null,
      sortOrder: 0,
    };
    try {
      if (rule.id) await updateDocRule(rule.id, body);
      else await createDocRule(body);
      setRule(null);
      setRules(await fetchDocRules());
    } catch (e) {
      setErr(errText(e));
    }
  }

  if (!s) return <div className="p-8 text-center text-muted text-sm">{err ?? "در حال بارگذاری..."}</div>;
  const roleName = (id: string | null) => lookups.roles.find((r) => r.id === id)?.name;
  const userName = (id: string | null) => lookups.users.find((u) => u.id === id)?.name;

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-[860px] mx-auto flex flex-col gap-4 pb-24">
      <div>
        <Link href="/dispatch" className="text-[12px] text-muted">← اعلام بار</Link>
        <h1 className="text-xl font-extrabold mt-1">تنظیمات اعلام بار و اسناد حمل</h1>
      </div>
      {err ? <div className="text-[12.5px] text-danger font-semibold bg-danger-soft rounded-xl px-3 py-2">{err}</div> : null}
      {msg ? <div className="text-[12.5px] text-success font-semibold bg-success-soft rounded-xl px-3 py-2">{msg}</div> : null}

      <Section title="پیشنهاد اعلام بار از دستور تولید">
        <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer mb-3">
          <input type="checkbox" checked={s.productionTrigger.enabled} onChange={(e) => setS({ ...s, productionTrigger: { ...s.productionTrigger, enabled: e.target.checked } })} className="w-4 h-4" />
          پیشنهاد خودکار (اعلان + بنر روی دستور تولید) فعال باشد
        </label>
        <label className={LABEL}>پیش‌فرض: اعلام بار در چند مرحله مانده به پایان؟ (۰ = آخرین مرحله، ۱ = یکی مانده به آخر، …)</label>
        <input value={String(s.productionTrigger.stagesBeforeEnd)} onChange={(e) => setS({ ...s, productionTrigger: { ...s.productionTrigger, stagesBeforeEnd: Math.min(20, Number(e.target.value.replace(/[^\d]/g, "")) || 0) } })} dir="ltr" className={`${INPUT} !w-28`} />
        <div className="text-[11.5px] text-muted mt-1.5">برای هر دستور تولید در خودِ همان دستور می‌توان مقدار دیگری گذاشت.</div>
      </Section>

      <Section title="چه کسی کدام مرحله را انجام دهد؟">
        <div className="flex flex-col gap-4">
          {STEP_LABELS.map(([key, label, hint]) => (
            <div key={key}>
              <div className="text-[12.5px] font-bold">{label}</div>
              <div className="text-[11px] text-muted mb-1.5">{hint}</div>
              <AccessPicker lookups={lookups} value={s.steps[key]} onChange={(v) => setS({ ...s, steps: { ...s.steps, [key]: v } })} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="رسید راننده">
        <div className="flex flex-col gap-3">
          <div>
            <label className={LABEL}>رسید امضاشده‌ی راننده الزامی است…</label>
            <select value={s.receipt.requiredBefore} onChange={(e) => setS({ ...s, receipt: { ...s.receipt, requiredBefore: e.target.value as DispatchSettings["receipt"]["requiredBefore"] } })} className={INPUT}>
              <option value="DEPARTURE">پیش از ثبت حرکت (پیشنهادی)</option>
              <option value="DELIVERY">پیش از ثبت تحویل</option>
              <option value="NONE">الزامی نیست</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer">
            <input type="checkbox" checked={s.receipt.smsEnabled} onChange={(e) => setS({ ...s, receipt: { ...s.receipt, smsEnabled: e.target.checked } })} className="w-4 h-4" />
            ارسال خودکار لینک رسید به راننده با پیامک (پس از «آماده حرکت»)
          </label>
          <div>
            <label className={LABEL}>متن پیامک — {"{shipmentNo} {link}"}</label>
            <textarea value={s.receipt.smsTemplate} onChange={(e) => setS({ ...s, receipt: { ...s.receipt, smsTemplate: e.target.value } })} rows={3} className={INPUT} />
          </div>
          <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer">
            <input type="checkbox" checked={s.receipt.archiveEnabled} onChange={(e) => setS({ ...s, receipt: { ...s.receipt, archiveEnabled: e.target.checked } })} className="w-4 h-4" />
            بایگانی PDF رسید در «اسناد محرمانه» (در صورت نصب بودن ماژول)
          </label>
        </div>
      </Section>

      <button onClick={save} disabled={saving} className={`${BTN_PRIMARY} !py-3`}>
        {saving ? "در حال ذخیره..." : "ذخیره‌ی تنظیمات"}
      </button>

      <Section title="نوع‌های سند حمل">
        <div className="flex flex-col gap-1.5 mb-3">
          {types.map((t) => (
            <div key={t.id} className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-2 text-[12.5px]">
              <span className="font-bold flex-1">{t.name}</span>
              {t.isSystem ? <Badge>پیش‌فرض</Badge> : null}
              <button onClick={() => updateDocType(t.id, { isActive: !t.isActive }).then(() => fetchDocTypes().then(setTypes))} className="text-[11.5px] font-bold text-primary cursor-pointer">
                {t.isActive ? "غیرفعال‌کردن" : "فعال‌کردن"}
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="نوع سند جدید (مثلاً گواهی بهداشت)" className={INPUT} />
          <button disabled={newType.trim().length < 2} onClick={() => createDocType(newType.trim()).then(() => { setNewType(""); return fetchDocTypes().then(setTypes); }).catch((e) => setErr(errText(e)))} className={BTN_PRIMARY}>
            افزودن
          </button>
        </div>
      </Section>

      <Section title="قوانین سند" right={<button onClick={() => setRule({ ...emptyRule })} className="text-[12px] font-bold text-primary cursor-pointer">+ قانون جدید</button>}>
        <div className="text-[11.5px] text-muted mb-3 leading-relaxed">
          هر قانون وقتی همه‌ی شروط پرشده‌اش برقرار باشد (وزن خالص ≥ حداقل، و/یا نوع بار، و/یا منطقه) اسناد لازم را الزامی و یک وظیفه برای مسئول می‌سازد. «آماده حرکت» تا تکمیل این اسناد مسدود است.
        </div>
        <div className="flex flex-col gap-2">
          {rules.length === 0 ? <div className="text-[12.5px] text-muted">قانونی تعریف نشده است.</div> : null}
          {rules.map((r) => (
            <div key={r.id} className="bg-slate-50 border border-border rounded-xl p-3 text-[12.5px] flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <b className="flex-1">{r.name}</b>
                <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "فعال" : "غیرفعال"}</Badge>
              </div>
              <div className="text-ink-soft">
                {r.minNetKg != null ? `وزن خالص ≥ ${toPersianDigits(r.minNetKg.toLocaleString("en-US"))} کیلوگرم` : ""}
                {r.cargoTypes.length ? ` · نوع بار: ${r.cargoTypes.join("، ")}` : ""}
                {r.regions.length ? ` · منطقه: ${r.regions.join("، ")}` : ""}
                {r.minNetKg == null && !r.cargoTypes.length && !r.regions.length ? "همیشه" : ""}
              </div>
              <div>اسناد: {r.docTypeCodes.map((c) => types.find((t) => t.code === c)?.name ?? c).join("، ")}</div>
              <div>مسئول: {roleName(r.handlerRoleId) ? `نقش «${roleName(r.handlerRoleId)}»` : userName(r.handlerUserId) ? `کاربر «${userName(r.handlerUserId)}»` : "مدیران (مسئولی تعیین نشده)"}</div>
              <div className="flex gap-3">
                <button onClick={() => setRule({ id: r.id, name: r.name, isActive: r.isActive, minNetKg: r.minNetKg == null ? "" : String(r.minNetKg), cargoTypes: r.cargoTypes.join("، "), regions: r.regions.join("، "), docTypeCodes: r.docTypeCodes, handlerKind: r.handlerUserId ? "USER" : "ROLE", handlerRoleId: r.handlerRoleId ?? "", handlerUserId: r.handlerUserId ?? "" })} className="text-[11.5px] font-bold text-primary cursor-pointer">ویرایش</button>
                <button onClick={() => window.confirm("این قانون حذف شود؟") && deleteDocRule(r.id).then(() => fetchDocRules().then(setRules))} className="text-[11.5px] font-bold text-danger cursor-pointer">حذف</button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {rule ? (
        <Modal title={rule.id ? "ویرایش قانون" : "قانون جدید"} onClose={() => setRule(null)} width="max-w-[520px]">
          <div className="flex flex-col gap-3">
            <div><label className={LABEL}>نام قانون</label><input value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} className={INPUT} /></div>
            <div><label className={LABEL}>حداقل وزن خالص (کیلوگرم) — خالی = بدون شرط وزن</label><input value={rule.minNetKg} onChange={(e) => setRule({ ...rule, minNetKg: e.target.value.replace(/[^\d.]/g, "") })} dir="ltr" className={INPUT} /></div>
            <div><label className={LABEL}>نوع بار (با ویرگول جدا کنید — خالی = همه)</label><input value={rule.cargoTypes} onChange={(e) => setRule({ ...rule, cargoTypes: e.target.value })} className={INPUT} /></div>
            <div><label className={LABEL}>منطقه (با ویرگول جدا کنید — خالی = همه)</label><input value={rule.regions} onChange={(e) => setRule({ ...rule, regions: e.target.value })} className={INPUT} /></div>
            <div>
              <label className={LABEL}>اسناد الزامی</label>
              <div className="flex flex-wrap gap-1.5">
                {types.filter((t) => t.isActive).map((t) => (
                  <button type="button" key={t.code} onClick={() => setRule({ ...rule, docTypeCodes: rule.docTypeCodes.includes(t.code) ? rule.docTypeCodes.filter((c) => c !== t.code) : [...rule.docTypeCodes, t.code] })} className={`text-[11.5px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${rule.docTypeCodes.includes(t.code) ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={LABEL}>مسئول ثبت اسناد (مثلاً کنترل کیفیت، انباردار، مدیر تولید)</label>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => setRule({ ...rule, handlerKind: "ROLE" })} className={rule.handlerKind === "ROLE" ? BTN_PRIMARY : BTN_SOFT}>نقش</button>
                <button type="button" onClick={() => setRule({ ...rule, handlerKind: "USER" })} className={rule.handlerKind === "USER" ? BTN_PRIMARY : BTN_SOFT}>کاربر مشخص</button>
              </div>
              {rule.handlerKind === "ROLE" ? (
                <select value={rule.handlerRoleId} onChange={(e) => setRule({ ...rule, handlerRoleId: e.target.value })} className={INPUT}>
                  <option value="">مدیران (بدون نقش مشخص)</option>
                  {lookups.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              ) : (
                <select value={rule.handlerUserId} onChange={(e) => setRule({ ...rule, handlerUserId: e.target.value })} className={INPUT}>
                  <option value="">انتخاب کاربر…</option>
                  {lookups.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
            </div>
            <label className="flex items-center gap-2 text-[13px] font-bold cursor-pointer"><input type="checkbox" checked={rule.isActive} onChange={(e) => setRule({ ...rule, isActive: e.target.checked })} className="w-4 h-4" />قانون فعال باشد</label>
            <div className="flex gap-2">
              <button onClick={saveRule} disabled={rule.name.trim().length < 2 || rule.docTypeCodes.length === 0} className={`${BTN_PRIMARY} flex-1`}>ذخیره</button>
              <button onClick={() => setRule(null)} className={BTN_SOFT}>انصراف</button>
              {rule.id ? <button onClick={() => deleteDocRule(rule.id!).then(() => { setRule(null); return fetchDocRules().then(setRules); })} className={BTN_DANGER}>حذف</button> : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
