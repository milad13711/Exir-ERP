"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { fileToDataUri, SMALL_IMAGE, uploadErrorMessage } from "@/lib/upload";
import {
  AGENT_LEVEL_LABELS, agentsCreateProduct, agentsDeleteProduct, agentsListAgreements, agentsPublishAgreement, agentsRestoreProduct, agentsSaveAgreementDraft,
  agentsUpdateProduct, type AgentAgreementRow, type AgentLevel, type AgentProduct,
} from "@/lib/api";
import { btnDanger, btnGhost, btnPrimary, errMsg, Field, fa, fmtDate, fmtMoney, inputClass, Loading, TabBar } from "./agent-ui";
import { useWorkspace } from "@/lib/workspace-context";
import { PlanRulesEditor } from "./CommissionPanel";

export function ProductsPanel({ products, onChanged, canCreate, canEdit, canDelete }: { products: AgentProduct[]; onChanged: () => void; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const [edit, setEdit] = useState<AgentProduct | "new" | null>(null);
  const [agr, setAgr] = useState<AgentProduct | null>(null);
  const [rules, setRules] = useState<AgentProduct | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function remove(p: AgentProduct) {
    if (!window.confirm(`«${p.name}» حذف شود؟ اگر به نماینده/مشتری/کلید وصل باشد فقط بایگانی (غیرفعال) می‌شود.`)) return;
    try { const r = await agentsDeleteProduct(p.id); setMsg(r.archived ? "محصول به‌دلیل داشتن سوابق بایگانی شد." : "محصول حذف شد."); onChanged(); } catch (e) { setMsg(errMsg(e)); }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between"><div className="text-[12.5px] text-muted">{msg}</div>{canCreate ? <button className={btnPrimary} onClick={() => setEdit("new")}>محصول جدید</button> : null}</div>
      {!products.length ? <Loading rows={products} /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {products.map((p) => (
            <Card key={p.id} className="p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center font-extrabold text-primary shrink-0">{p.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.logoUrl} alt="" className="w-full h-full object-cover" /> : p.code.slice(0, 2)}</div>
                <div className="min-w-0 flex-1"><div className="font-bold text-[13.5px] truncate">{p.name}</div><div className="text-[11.5px] text-muted font-mono" dir="ltr">{p.code}</div></div>
                <Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? "فعال" : "غیرفعال"}</Badge>
              </div>
              <div className="text-[12px] text-ink-soft">{fa(p._count?.memberships ?? 0)} نماینده · {fa(p._count?.customers ?? 0)} مشتری · نگهداری کمیسیون {fa(p.holdDays)} روز · حداقل تسویه {fmtMoney(p.minSettlementAmount)}</div>
              <div className="flex flex-wrap gap-2">
                {canEdit ? <button className={btnGhost} onClick={() => setEdit(p)}>ویرایش</button> : null}
                <button className={btnGhost} onClick={() => setAgr(p)}>تفاهم‌نامه</button>
                <button className={btnGhost} onClick={() => setRules(p)}>قوانین پورسانت</button>
                {canDelete ? <button className={btnDanger} onClick={() => remove(p)}>حذف/بایگانی</button> : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      <ArchivedList canEdit={canEdit} onChanged={onChanged} />
      {edit ? <ProductForm initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} /> : null}
      {agr ? <AgreementEditor product={agr} canEdit={canEdit} onClose={() => setAgr(null)} /> : null}
      {rules ? <PlanRulesEditor product={rules} canEdit={canEdit} onClose={() => setRules(null)} /> : null}
    </div>
  );
}

function ArchivedList({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<AgentProduct[]>([]);
  useEffect(() => { import("@/lib/api").then((m) => m.agentsListProducts(true)).then((r) => setRows(r.filter((p) => p.isArchived))).catch(() => setRows([])); }, []);
  if (!rows.length) return null;
  return (
    <details className="text-[12.5px]"><summary className="cursor-pointer text-muted">محصولات بایگانی‌شده ({fa(rows.length)})</summary>
      <div className="flex flex-col gap-2 mt-2">{rows.map((p) => (<div key={p.id} className="flex items-center justify-between border border-border rounded-xl p-2.5"><span>{p.name} <span className="text-muted font-mono" dir="ltr">{p.code}</span></span>{canEdit ? <button className={btnGhost} onClick={async () => { await agentsRestoreProduct(p.id); onChanged(); setRows((r) => r.filter((x) => x.id !== p.id)); }}>بازگردانی</button> : null}</div>))}</div>
    </details>
  );
}

function ProductForm({ initial, onClose, onSaved }: { initial: AgentProduct | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useWorkspace();
  const [code, setCode] = useState(initial?.code ?? ""); const [name, setName] = useState(initial?.name ?? ""); const [website, setWebsite] = useState(initial?.websiteUrl ?? ""); const [refTpl, setRefTpl] = useState(initial?.referralUrlTemplate ?? "");
  const [desc, setDesc] = useState(initial?.description ?? ""); const [logo, setLogo] = useState(initial?.logoUrl ?? ""); const [active, setActive] = useState(initial?.isActive ?? true);
  const [hold, setHold] = useState(String(initial?.holdDays ?? 7)); const [min, setMin] = useState(initial ? String(initial.minSettlementAmount) : "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const common = { name: name.trim(), description: desc.trim() || undefined, websiteUrl: website.trim() || undefined, referralUrlTemplate: refTpl.trim(), logoUrl: logo || undefined, holdDays: Number(hold), ...(min.trim() ? { minSettlementAmount: Number(min) } : {}) };
      if (initial) await agentsUpdateProduct(initial.id, { ...common, isActive: active }); else await agentsCreateProduct({ code: code.trim().toUpperCase(), ...common });
      onSaved();
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial ? "ویرایش محصول" : "محصول جدید"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        {!initial ? <Field label="کد محصول (لاتین بزرگ، یکتا)"><input className={`${inputClass} font-mono`} dir="ltr" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ERP" /></Field> : null}
        <Field label="نام"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="نشانی وب‌سایت"><input className={inputClass} dir="ltr" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></Field>
        <Field label="قالب لینک معرفی (کارت ویزیت)" hint="مثلاً https://amlak.example/signup?ref={code} — خالی = نشانی وب‌سایت با ?ref=کد"><input className={inputClass} dir="ltr" value={refTpl} onChange={(e) => setRefTpl(e.target.value)} placeholder="https://.../signup?ref={code}" /></Field>
        <Field label="توضیح"><input className={inputClass} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="لوگو"><input type="file" accept="image/*" className="text-[12px]" onChange={async (e) => { const f = e.target.files?.[0]; if (f) try { setLogo(await fileToDataUri(f, "image", SMALL_IMAGE)); } catch (x) { setErr(uploadErrorMessage(x)); } }} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="مهلت نگهداری کمیسیون (روز)"><input className={inputClass} inputMode="numeric" dir="ltr" value={hold} onChange={(e) => setHold(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label={`حداقل مبلغ تسویه (${me?.baseCurrency?.label ?? "تومان"})`} hint="خالی = ۵۰۰٬۰۰۰ تومان به واحد ارز پایه"><input className={inputClass} inputMode="numeric" dir="ltr" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} /></Field>
        </div>
        <Field label="کد معرف"><div className="text-[12px] text-ink-soft min-h-[40px] flex items-center">دستی — ادمین در عضویت هر نماینده ثبت می‌کند</div></Field>
        {initial ? <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="w-4 h-4" checked={active} onChange={(e) => setActive(e.target.checked)} />محصول فعال (دریافت رویداد و عضویت جدید)</label> : null}
        {err ? <div className="text-[12px] text-danger">{err}</div> : null}
        <div className="flex justify-end gap-2"><button type="button" className={btnGhost} onClick={onClose}>انصراف</button><button className={btnPrimary} disabled={busy || name.trim().length < 2 || (!initial && code.trim().length < 2)}>{busy ? "..." : "ذخیره"}</button></div>
      </form>
    </Modal>
  );
}

function AgreementEditor({ product, canEdit, onClose }: { product: AgentProduct; canEdit: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<AgentAgreementRow[] | null>(null);
  const [title, setTitle] = useState("تفاهم‌نامه‌ی همکاری"); const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    agentsListAgreements(product.id).then((r) => { setRows(r); const d = r.find((x) => x.status === "DRAFT") ?? r[0]; if (d) { setTitle(d.title); setBody(d.body); } }).catch(() => setRows([]));
  }, [product.id]);
  useEffect(load, [load]);
  const draft = rows?.find((r) => r.status === "DRAFT");
  const published = rows?.find((r) => r.status === "PUBLISHED");
  async function saveDraft() { setBusy(true); setMsg(null); try { await agentsSaveAgreementDraft(product.id, { title: title.trim(), body }); setMsg("پیش‌نویس ذخیره شد"); load(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); } }
  async function publish() {
    if (!window.confirm("با انتشار، همه‌ی نمایندگان این محصول باید نسخه‌ی جدید را دوباره امضا کنند. ادامه می‌دهید؟")) return;
    setBusy(true); setMsg(null);
    try { const d = (await agentsSaveAgreementDraft(product.id, { title: title.trim(), body })); await agentsPublishAgreement(product.id, d.id); setMsg("منتشر شد"); load(); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`تفاهم‌نامه — ${product.name}`} onClose={onClose} width="max-w-[720px]">
      <div className="flex flex-col gap-3">
        <div className="text-[12.5px] text-ink-soft">نسخه‌ی منتشرشده: {published ? <b>{fa(published.version)} ({fmtDate(published.publishedAt)}) · {fa(published._count?.acceptances ?? 0)} امضا</b> : "هنوز منتشر نشده"}{draft ? ` · پیش‌نویس نسخه‌ی ${fa(draft.version)}` : ""}</div>
        <Field label="عنوان"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} /></Field>
        <Field label="متن (ویرایش و انتشار، نسخه‌ی تازه می‌سازد)"><textarea className={inputClass} rows={12} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} /></Field>
        {canEdit ? <div className="flex flex-wrap gap-2 items-center"><button className={btnGhost} disabled={busy || body.trim().length < 10} onClick={saveDraft}>ذخیره‌ی پیش‌نویس</button><button className={btnPrimary} disabled={busy || body.trim().length < 10 || title.trim().length < 2} onClick={publish}>انتشار نسخه‌ی جدید</button>{msg ? <span className="text-[12px] text-ink-soft">{msg}</span> : null}</div> : null}
        {rows?.length ? (<details className="text-[12px] text-muted"><summary className="cursor-pointer">نسخه‌ها</summary><ul className="mt-1">{rows.map((r) => <li key={r.id}>نسخه {fa(r.version)} · {r.status === "PUBLISHED" ? `منتشر ${fmtDate(r.publishedAt)}` : "پیش‌نویس"} · {fa(r._count?.acceptances ?? 0)} امضا</li>)}</ul></details>) : null}
      </div>
    </Modal>
  );
}

